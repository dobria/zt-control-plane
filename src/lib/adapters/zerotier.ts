import { randomBytes } from "node:crypto";
import { Agent, fetch as undiciFetch } from "undici";
import {
  capabilitiesForNodeType,
  capabilitiesForType,
} from "@/lib/controller-capabilities";
import type { ZeroTierCredentials } from "@/lib/controller-registry";
import type {
  ClientNetwork,
  ControllerRecord,
  ControllerStatus,
  ManagedNodeRecord,
  ManagedNetwork,
  Moon,
  NetworkMember,
  PeerPath,
  ZeroTierPeer,
} from "@/lib/types";
import {
  AdapterError,
  type ControllerAdapter,
  type Fetcher,
} from "@/lib/adapters/types";
import { createAdapterAgent, parseAdapterResponse } from "@/lib/adapters/http";

const allowedNetworkKeys = [
  "name",
  "private",
  "enableBroadcast",
  "mtu",
  "multicastLimit",
  "dns",
  "routes",
  "ipAssignmentPools",
  "v4AssignMode",
  "v6AssignMode",
  "rules",
  "capabilities",
  "tags",
  "ssoEnabled",
  "authorizationEndpoint",
  "clientId",
  "remoteTraceLevel",
  "remoteTraceTarget",
];
const allowedMemberKeys = [
  "name",
  "authorized",
  "activeBridge",
  "ipAssignments",
  "noAutoAssignIps",
  "ssoExempt",
  "capabilities",
  "tags",
  "authenticationExpiryTime",
  "remoteTraceLevel",
  "remoteTraceTarget",
];
const joinVerificationDelaysMs = [0, 100, 250];

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function pick(input: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(
    keys
      .filter((key) => input[key] !== undefined)
      .map((key) => [key, input[key]]),
  );
}
function normalizeNetwork(
  input: Record<string, unknown>,
  fallbackId = "",
): ManagedNetwork {
  const id = String(input.id || input.nwid || fallbackId);
  return {
    ...input,
    id,
    name: String(input.name || "Unnamed network"),
    private: input.private !== false,
    raw: input,
  } as ManagedNetwork;
}
function normalizeMember(
  input: Record<string, unknown>,
  fallbackId = "",
): NetworkMember {
  const id = String(input.id || input.address || fallbackId);
  const version =
    input.vMajor === undefined
      ? null
      : `${input.vMajor}.${input.vMinor}.${input.vRev}`;
  return {
    ...input,
    id,
    name: String(input.name || ""),
    authorized: Boolean(input.authorized),
    version,
    raw: input,
  } as NetworkMember;
}
function normalizeClientNetwork(input: Record<string, unknown>): ClientNetwork {
  return {
    id: String(input.id || input.nwid || ""),
    name: String(input.name || input.id || "Unnamed network"),
    status: String(input.status || "UNKNOWN"),
    type: String(input.type || "PRIVATE"),
    mac: input.mac ? String(input.mac) : undefined,
    assignedAddresses: Array.isArray(input.assignedAddresses)
      ? input.assignedAddresses.map(String)
      : [],
    allowManaged: input.allowManaged !== false,
    allowDefault: Boolean(input.allowDefault),
    allowGlobal: Boolean(input.allowGlobal),
    allowDNS: Boolean(input.allowDNS),
    raw: input,
  };
}

function normalizeMoon(input: Record<string, unknown>): Moon {
  return {
    ...input,
    id: String(input.id || ""),
    waiting: Boolean(input.waiting),
    roots: Array.isArray(input.roots) ? (input.roots as Moon["roots"]) : [],
    raw: input,
  };
}

function normalizePeerPath(input: Record<string, unknown>): PeerPath {
  return {
    address: String(input.address || ""),
    active: Boolean(input.active),
    preferred: Boolean(input.preferred),
    expired: Boolean(input.expired),
    lastReceive:
      typeof input.lastReceive === "number" ? input.lastReceive : null,
    lastSend: typeof input.lastSend === "number" ? input.lastSend : null,
  };
}

function normalizePeer(input: Record<string, unknown>): ZeroTierPeer {
  const version = String(input.version || "");
  return {
    address: String(input.address || ""),
    role: String(input.role || "LEAF").toUpperCase(),
    version: version && !version.startsWith("-1.") ? version : null,
    latency:
      typeof input.latency === "number" && input.latency >= 0
        ? input.latency
        : null,
    tunneled: Boolean(input.tunneled),
    paths: Array.isArray(input.paths)
      ? input.paths
          .filter(
            (path): path is Record<string, unknown> =>
              Boolean(path) && typeof path === "object" && !Array.isArray(path),
          )
          .map(normalizePeerPath)
      : [],
    raw: input,
  };
}

export class ZeroTierAdapter implements ControllerAdapter {
  readonly capabilities;
  private agent: Agent;

  constructor(
    private record: ControllerRecord | ManagedNodeRecord,
    private credentials: ZeroTierCredentials,
    private fetcher: Fetcher = undiciFetch as unknown as Fetcher,
    private mode: "controller" | "node" = "controller",
  ) {
    this.capabilities =
      mode === "controller"
        ? capabilitiesForType(
            record.type === "embedded" ? "embedded" : "zerotier",
          )
        : capabilitiesForNodeType(
            record.type === "local" ? "local" : "zerotier",
          );
    this.agent = createAdapterAgent(record.tlsVerify);
  }

  private async request<T = unknown>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const url = `${this.record.baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
    const response = await this.fetcher(url, {
      ...init,
      redirect: "error",
      headers: {
        "X-ZT1-Auth": this.credentials.apiToken,
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      signal: init.signal || AbortSignal.timeout(12_000),
      ...({ dispatcher: this.agent } as Record<string, unknown>),
    });
    const body = await parseAdapterResponse(response, "ZeroTier API");
    if (!response.ok) {
      const message =
        typeof body === "object" && body && "error" in body
          ? String((body as { error: unknown }).error)
          : `ZeroTier API returned ${response.status}.`;
      throw new AdapterError(message, response.status, body);
    }
    return body as T;
  }

  async getStatus(): Promise<ControllerStatus> {
    const status = await this.request<Record<string, unknown>>("/status");
    const controller =
      this.mode === "controller"
        ? await this.request<Record<string, unknown>>("/controller")
        : null;
    if (
      controller &&
      (controller.controller !== true || controller.databaseReady === false)
    )
      throw new AdapterError(
        "The ZeroTier controller database is not ready.",
        503,
        controller,
      );
    return {
      online: status.online !== false,
      address: status.address ? String(status.address) : null,
      version: status.version ? String(status.version) : null,
      platform:
        this.record.type === "embedded"
          ? "Embedded ZeroTier One"
          : this.record.type === "local"
            ? "Local ZeroTier One node"
            : "Remote ZeroTier One",
      details: controller
        ? { ...status, controllerStatus: controller }
        : status,
    };
  }
  async getDiagnostics() {
    const [status, controller, peers, clientNetworks] = await Promise.all([
      this.request<Record<string, unknown>>("/status"),
      this.mode === "controller"
        ? this.request<Record<string, unknown>>("/controller")
        : Promise.resolve(null),
      this.request<unknown[]>("/peer"),
      this.request<unknown[]>("/network"),
    ]);
    return {
      status,
      controller,
      peers,
      clientNetworks,
      checkedAt: new Date().toISOString(),
    };
  }
  async listNetworks() {
    const ids = await this.request<string[]>("/controller/network");
    return Promise.all(ids.map((id) => this.getNetwork(id)));
  }
  async getNetwork(networkId: string) {
    const network = await this.request<Record<string, unknown>>(
      `/controller/network/${networkId}`,
    );
    const memberIndex = await this.request<Record<string, number>>(
      `/controller/network/${networkId}/member`,
    );
    return {
      ...normalizeNetwork(network, networkId),
      memberCount: Object.keys(memberIndex || {}).length,
    };
  }
  async createNetwork(input: Partial<ManagedNetwork>) {
    const status = await this.getStatus();
    if (!status.address)
      throw new AdapterError("Controller identity is not available.", 503);
    const requested =
      typeof input.id === "string" && /^[0-9a-f]{16}$/i.test(input.id)
        ? input.id.toLowerCase()
        : `${status.address}${randomBytes(3).toString("hex")}`;
    const defaults = {
      name: "New network",
      private: true,
      enableBroadcast: true,
      mtu: 2800,
      multicastLimit: 32,
      dns: [],
      routes: [],
      ipAssignmentPools: [],
      v4AssignMode: {},
      v6AssignMode: {},
      rules: [{ type: "ACTION_ACCEPT" }],
      capabilities: [],
      tags: [],
    };
    const body = {
      ...defaults,
      ...pick(input as Record<string, unknown>, allowedNetworkKeys),
    };
    return normalizeNetwork(
      await this.request<Record<string, unknown>>(
        `/controller/network/${requested}`,
        { method: "POST", body: JSON.stringify(body) },
      ),
      requested,
    );
  }
  async updateNetwork(networkId: string, input: Partial<ManagedNetwork>) {
    const body = pick(input as Record<string, unknown>, allowedNetworkKeys);
    return normalizeNetwork(
      await this.request<Record<string, unknown>>(
        `/controller/network/${networkId}`,
        { method: "POST", body: JSON.stringify(body) },
      ),
      networkId,
    );
  }
  async deleteNetwork(networkId: string) {
    await this.request(`/controller/network/${networkId}`, {
      method: "DELETE",
    });
  }
  async listMembers(networkId: string) {
    const index = await this.request<Record<string, number>>(
      `/controller/network/${networkId}/member`,
    );
    return Promise.all(
      Object.keys(index || {}).map((id) => this.getMember(networkId, id)),
    );
  }
  async getMember(networkId: string, memberId: string) {
    return normalizeMember(
      await this.request<Record<string, unknown>>(
        `/controller/network/${networkId}/member/${memberId}`,
      ),
      memberId,
    );
  }
  async createMember(
    networkId: string,
    memberId: string,
    input: Partial<NetworkMember>,
  ) {
    return this.updateMember(networkId, memberId, input);
  }
  async updateMember(
    networkId: string,
    memberId: string,
    input: Partial<NetworkMember>,
  ) {
    const body = pick(input as Record<string, unknown>, allowedMemberKeys);
    return normalizeMember(
      await this.request<Record<string, unknown>>(
        `/controller/network/${networkId}/member/${memberId}`,
        { method: "POST", body: JSON.stringify(body) },
      ),
      memberId,
    );
  }
  async deleteMember(networkId: string, memberId: string) {
    await this.request(`/controller/network/${networkId}/member/${memberId}`, {
      method: "DELETE",
    });
  }
  async listClientNetworks() {
    return (await this.request<Record<string, unknown>[]>("/network")).map(
      normalizeClientNetwork,
    );
  }
  async joinClientNetwork(
    networkId: string,
    input: Partial<ClientNetwork> = {},
  ) {
    const body = {
      allowManaged: input.allowManaged ?? true,
      allowDefault: input.allowDefault ?? false,
      allowGlobal: input.allowGlobal ?? false,
      allowDNS: input.allowDNS ?? false,
    };
    await this.request<Record<string, unknown>>(`/network/${networkId}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    for (const delay of joinVerificationDelaysMs) {
      if (delay) await wait(delay);
      const joined = (await this.listClientNetworks()).find(
        (network) => network.id.toLowerCase() === networkId.toLowerCase(),
      );
      if (joined) return joined;
    }
    throw new AdapterError(
      "ZeroTier accepted the join request, but the network did not appear on the node. Verify that /dev/net/tun is mounted and the container has NET_ADMIN and SYS_ADMIN capabilities.",
      502,
      { networkId },
    );
  }
  async updateClientNetwork(networkId: string, input: Partial<ClientNetwork>) {
    return this.joinClientNetwork(networkId, input);
  }
  async leaveClientNetwork(networkId: string) {
    await this.request(`/network/${networkId}`, { method: "DELETE" });
  }
  async listPeers() {
    return (await this.request<Record<string, unknown>[]>("/peer")).map(
      normalizePeer,
    );
  }
  async listMoons() {
    return (await this.request<Record<string, unknown>[]>("/moon")).map(
      normalizeMoon,
    );
  }
  async orbitMoon(worldId: string, seed: string) {
    return normalizeMoon(
      await this.request<Record<string, unknown>>(`/moon/${worldId}`, {
        method: "POST",
        body: JSON.stringify({ seed }),
      }),
    );
  }
  async deorbitMoon(worldId: string) {
    await this.request(`/moon/${worldId}`, { method: "DELETE" });
  }
}
