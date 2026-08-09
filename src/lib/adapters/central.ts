import { Agent, fetch as undiciFetch } from "undici";
import { capabilitiesForType } from "@/lib/controller-capabilities";
import type { CentralCredentials } from "@/lib/controller-registry";
import type {
  ControllerRecord,
  ControllerStatus,
  ManagedNetwork,
  NetworkGroup,
  NetworkMember,
} from "@/lib/types";
import {
  AdapterError,
  type Fetcher,
  type NetworkControllerAdapter,
} from "@/lib/adapters/types";
import { createAdapterAgent, parseAdapterResponse } from "@/lib/adapters/http";

const networkKeys = [
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
];
const memberKeys = [
  "authorized",
  "activeBridge",
  "ipAssignments",
  "noAutoAssignIps",
  "ssoExempt",
  "capabilities",
  "tags",
  "authenticationExpiryTime",
];

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pick(input: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(
    keys
      .filter((key) => input[key] !== undefined)
      .map((key) => [key, input[key]]),
  );
}

function resource(value: unknown, ...keys: string[]) {
  const root = object(value);
  for (const key of keys) {
    const nested = root[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested))
      return nested as Record<string, unknown>;
  }
  const data = root.data;
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : root;
}

function resources(value: unknown, ...keys: string[]) {
  if (Array.isArray(value)) return value.map(object);
  const root = object(value);
  for (const key of [...keys, "data", "items", "results"]) {
    if (Array.isArray(root[key])) return (root[key] as unknown[]).map(object);
  }
  return [];
}

function normalizeNetwork(input: Record<string, unknown>): ManagedNetwork {
  const config = object(input.config);
  const source = Object.keys(config).length ? config : input;
  return {
    ...source,
    id: String(input.id || source.id || input.networkId || input.nwid || ""),
    name: String(source.name || input.name || "Unnamed network"),
    description: String(input.description || source.description || ""),
    private: source.private !== false,
    memberCount: Number(
      input.totalMemberCount ||
        input.memberCount ||
        input.authorizedMemberCount ||
        0,
    ),
    rulesSource:
      typeof input.rulesSource === "string" ? input.rulesSource : undefined,
    raw: input,
  } as ManagedNetwork;
}

function normalizeNetworkGroup(input: Record<string, unknown>): NetworkGroup {
  return {
    id: String(
      input.id || input.networkGroupId || input["network-group-id"] || "",
    ),
    name: String(input.name || "Unnamed group"),
    description: String(input.description || ""),
    networkCount:
      input.networkCount === undefined ? undefined : Number(input.networkCount),
    raw: input,
  };
}

function normalizeMember(input: Record<string, unknown>): NetworkMember {
  const config = object(input.config);
  const source = Object.keys(config).length ? config : input;
  const rawId = String(
    input.nodeId ||
      input.deviceId ||
      input["device-id"] ||
      source.id ||
      input.id ||
      "",
  );
  const nodeId = rawId.match(/([0-9a-f]{10})$/i)?.[1] || rawId;
  const version =
    input.version ||
    source.version ||
    (source.vMajor !== undefined
      ? `${source.vMajor}.${source.vMinor}.${source.vRev}`
      : null);
  return {
    ...source,
    id: nodeId.toLowerCase(),
    name: String(input.name || source.name || ""),
    description: String(input.description || source.description || ""),
    authorized: Boolean(source.authorized ?? input.authorized),
    ipAssignments: Array.isArray(source.ipAssignments)
      ? source.ipAssignments.map(String)
      : [],
    version: version ? String(version) : null,
    creationTime:
      typeof source.creationTime === "number" ? source.creationTime : undefined,
    lastAuthorizedTime:
      typeof source.lastAuthorizedTime === "number"
        ? source.lastAuthorizedTime
        : typeof input.lastSeen === "number"
          ? input.lastSeen
          : undefined,
    raw: input,
  } as NetworkMember;
}

export class CentralAdapter implements NetworkControllerAdapter {
  readonly capabilities;
  private agent: Agent;
  private version: "v1" | "v2";

  constructor(
    private record: ControllerRecord,
    private credentials: CentralCredentials,
    private fetcher: Fetcher = undiciFetch as unknown as Fetcher,
  ) {
    this.version = record.type === "central_v2" ? "v2" : "v1";
    this.capabilities = capabilitiesForType(record.type);
    this.agent = createAdapterAgent(record.tlsVerify);
  }

  private root() {
    let root = this.record.baseUrl.replace(/\/+$/, "");
    if (this.version === "v1" && !/\/api\/v1$/i.test(root)) root += "/api/v1";
    if (this.version === "v2") root = root.replace(/\/api\/v2$/i, "");
    return root;
  }

  private async request<T = unknown>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const url = `${this.root()}/${path.replace(/^\/+/, "")}`;
    const response = await this.fetcher(url, {
      ...init,
      redirect: "error",
      headers: {
        authorization:
          this.version === "v2"
            ? `Bearer ${this.credentials.apiToken}`
            : `token ${this.credentials.apiToken}`,
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      signal: init.signal || AbortSignal.timeout(15_000),
      ...({ dispatcher: this.agent } as Record<string, unknown>),
    });
    const body = await parseAdapterResponse(response, "ZeroTier Central API");
    if (!response.ok) {
      const details = object(body);
      const message = String(
        details.message ||
          details.error ||
          details.detail ||
          `ZeroTier Central API returned ${response.status}.`,
      );
      throw new AdapterError(message, response.status, body);
    }
    return body as T;
  }

  private organizationId() {
    return String(this.record.configuration.organizationId || "");
  }

  private networkGroupId() {
    return String(this.record.configuration.networkGroupId || "");
  }

  private requireNetworkGroup() {
    const id = this.networkGroupId();
    if (!id)
      throw new AdapterError(
        "A New Central network group ID is required to create networks.",
        400,
      );
    return id;
  }

  private requireV2() {
    if (this.version !== "v2")
      throw new AdapterError(
        "Network groups are available only for New ZeroTier Central.",
        409,
      );
  }

  private requireOrganization() {
    this.requireV2();
    const id = this.organizationId();
    if (!id)
      throw new AdapterError("A New Central organization ID is required.", 400);
    return id;
  }

  async listNetworkGroups() {
    const organizationId = this.requireOrganization();
    return resources(
      await this.request(
        `api/v2/org/${encodeURIComponent(organizationId)}/network-group`,
      ),
      "networkGroups",
      "network-groups",
    ).map(normalizeNetworkGroup);
  }

  async getNetworkGroup(groupId: string) {
    this.requireV2();
    return normalizeNetworkGroup(
      resource(
        await this.request(
          `api/v2/network-group/${encodeURIComponent(groupId)}`,
        ),
        "networkGroup",
        "network-group",
      ),
    );
  }

  async createNetworkGroup(input: Partial<NetworkGroup>) {
    const organizationId = this.requireOrganization();
    const created = normalizeNetworkGroup(
      resource(
        await this.request(
          `api/v2/org/${encodeURIComponent(organizationId)}/network-group`,
          {
            method: "POST",
            body: JSON.stringify({
              name: input.name,
              description: input.description || "",
            }),
          },
        ),
        "networkGroup",
        "network-group",
      ),
    );
    if (!created.id)
      throw new AdapterError(
        "New Central did not return the created network group ID.",
        502,
      );
    return this.getNetworkGroup(created.id);
  }

  async updateNetworkGroup(groupId: string, input: Partial<NetworkGroup>) {
    this.requireV2();
    await this.request(`api/v2/network-group/${encodeURIComponent(groupId)}`, {
      method: "POST",
      body: JSON.stringify({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
      }),
    });
    return this.getNetworkGroup(groupId);
  }

  async deleteNetworkGroup(groupId: string) {
    this.requireV2();
    await this.request(`api/v2/network-group/${encodeURIComponent(groupId)}`, {
      method: "DELETE",
    });
  }

  async getStatus(): Promise<ControllerStatus> {
    if (this.version === "v1") {
      const status = await this.request<Record<string, unknown>>("status");
      return {
        online: true,
        address: status.id ? String(status.id) : null,
        version: "v1",
        platform: "ZeroTier Legacy Central",
        details: status,
      };
    }
    const orgId = this.organizationId();
    const response = await this.request(
      orgId ? `api/v2/org/${encodeURIComponent(orgId)}` : "api/v2/org",
    );
    const org = orgId
      ? resource(response, "organization", "org")
      : resources(response, "organizations", "orgs")[0] || object(response);
    return {
      online: true,
      address: String(org.id || orgId || "") || null,
      version: "v2",
      platform: "ZeroTier New Central",
      details: org,
    };
  }

  async getDiagnostics() {
    const status = await this.getStatus();
    const networks = await this.listNetworks();
    let networkGroups: unknown[] = [];
    if (this.version === "v2" && this.organizationId()) {
      const response = await this.request(
        `api/v2/org/${encodeURIComponent(this.organizationId())}/network-group`,
      );
      networkGroups = resources(response, "networkGroups", "network-groups");
    }
    return {
      status,
      organization: status.details || {},
      networkGroups,
      networks,
      checkedAt: new Date().toISOString(),
    };
  }

  async listNetworks() {
    if (this.version === "v1")
      return resources(await this.request("network"), "networks").map(
        normalizeNetwork,
      );
    const groupId = this.networkGroupId();
    const orgId = this.organizationId();
    const path = groupId
      ? `api/v2/network-group/${encodeURIComponent(groupId)}/network`
      : `api/v2/network${orgId ? `?org-id=${encodeURIComponent(orgId)}` : ""}`;
    return resources(await this.request(path), "networks").map(
      normalizeNetwork,
    );
  }

  async getNetwork(networkId: string) {
    const path =
      this.version === "v1"
        ? `network/${networkId}`
        : `api/v2/network/${networkId}`;
    return normalizeNetwork(resource(await this.request(path), "network"));
  }

  private updateBody(input: Partial<ManagedNetwork>) {
    const record = input as Record<string, unknown>;
    const config = pick(record, networkKeys);
    delete config.description;
    return {
      config,
      ...(input.description !== undefined
        ? { description: String(input.description || "") }
        : {}),
    };
  }

  async createNetwork(input: Partial<ManagedNetwork>) {
    if (this.version === "v1") {
      const created = normalizeNetwork(
        resource(
          await this.request("network", {
            method: "POST",
            body: "{}",
          }),
          "network",
        ),
      );
      if (!created.id)
        throw new AdapterError(
          "Legacy Central did not return the created network ID.",
          502,
        );
      return this.updateNetwork(created.id, input);
    }
    const groupId = this.requireNetworkGroup();
    const created = normalizeNetwork(
      resource(
        await this.request(
          `api/v2/network-group/${encodeURIComponent(groupId)}/network`,
          { method: "POST", body: JSON.stringify(this.updateBody(input)) },
        ),
        "network",
      ),
    );
    if (!created.id)
      throw new AdapterError(
        "New Central did not return the created network ID.",
        502,
      );
    return this.getNetwork(created.id);
  }

  async updateNetwork(networkId: string, input: Partial<ManagedNetwork>) {
    if (this.version === "v1") {
      const current = await this.getNetwork(networkId);
      const raw = object(current.raw);
      const currentConfig = object(raw.config);
      const body = {
        ...raw,
        ...this.updateBody(input),
        config: {
          ...currentConfig,
          ...this.updateBody(input).config,
        },
      };
      return normalizeNetwork(
        resource(
          await this.request(`network/${networkId}`, {
            method: "POST",
            body: JSON.stringify(body),
          }),
          "network",
        ),
      );
    }
    return normalizeNetwork(
      resource(
        await this.request(`api/v2/network/${networkId}`, {
          method: "POST",
          body: JSON.stringify(this.updateBody(input)),
        }),
        "network",
      ),
    );
  }

  async deleteNetwork(networkId: string) {
    await this.request(
      this.version === "v1"
        ? `network/${networkId}`
        : `api/v2/network/${networkId}`,
      { method: "DELETE" },
    );
  }

  async listMembers(networkId: string) {
    const path =
      this.version === "v1"
        ? `network/${networkId}/member`
        : `api/v2/network/${networkId}/member`;
    return resources(await this.request(path), "members", "devices").map(
      normalizeMember,
    );
  }

  async getMember(networkId: string, memberId: string) {
    const path =
      this.version === "v1"
        ? `network/${networkId}/member/${memberId}`
        : `api/v2/network/${networkId}/member/${memberId}`;
    return normalizeMember(
      resource(await this.request(path), "member", "device"),
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
    const record = input as Record<string, unknown>;
    const config = pick(record, memberKeys);
    const body = {
      config,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
    };
    const path =
      this.version === "v1"
        ? `network/${networkId}/member/${memberId}`
        : `api/v2/network/${networkId}/member/${memberId}`;
    const updated = normalizeMember(
      resource(
        await this.request(path, {
          method: "POST",
          body: JSON.stringify(body),
        }),
        "member",
        "device",
      ),
    );
    if (this.version === "v2" && input.authorized !== undefined) {
      await this.request(
        `${path}/${input.authorized ? "authorize" : "de-authorize"}`,
        { method: "POST", body: "{}" },
      );
      return this.getMember(networkId, memberId);
    }
    return updated;
  }

  async deleteMember(networkId: string, memberId: string) {
    if (this.version === "v1") {
      await this.request(`network/${networkId}/member/${memberId}`, {
        method: "DELETE",
      });
      return;
    }
    const path = `api/v2/network/${networkId}/member/${memberId}`;
    try {
      await this.request(path, { method: "DELETE" });
    } catch (error) {
      if (
        !(error instanceof AdapterError) ||
        ![404, 405].includes(error.status)
      )
        throw error;
      await this.request(`${path}/reject`, { method: "POST", body: "{}" });
    }
  }

  async updateFlowRules(
    networkId: string,
    source: string,
    compiled: Partial<ManagedNetwork>,
  ) {
    if (this.version === "v1") {
      const current = await this.getNetwork(networkId);
      const raw = object(current.raw);
      await this.request(`network/${networkId}`, {
        method: "POST",
        body: JSON.stringify({ ...raw, rulesSource: source }),
      });
      return;
    }
    await this.request(`api/v2beta/network/${networkId}/flow-rule`, {
      method: "POST",
      body: JSON.stringify({ source, config: compiled }),
    });
  }
}
