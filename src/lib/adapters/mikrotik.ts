import { Agent, fetch as undiciFetch } from "undici";
import {
  capabilitiesForNodeType,
  capabilitiesForType,
} from "@/lib/controller-capabilities";
import type { MikroTikCredentials } from "@/lib/controller-registry";
import type {
  ClientNetwork,
  ControllerRecord,
  ControllerStatus,
  ManagedNodeRecord,
  ManagedNetwork,
  Moon,
  NetworkMember,
  RouterOsZeroTierInstance,
  RouterOsZeroTierInstanceInput,
  ZeroTierPeer,
} from "@/lib/types";
import {
  AdapterError,
  type ControllerAdapter,
  type Fetcher,
} from "@/lib/adapters/types";
import { createAdapterAgent, parseAdapterResponse } from "@/lib/adapters/http";

function yes(value: unknown) {
  return value === true || value === "true" || value === "yes";
}
function records(value: Record<string, unknown> | Record<string, unknown>[]) {
  return Array.isArray(value) ? value : value ? [value] : [];
}
function routerErrorMessage(body: unknown, status: number) {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const error = body as Record<string, unknown>;
    const detail = String(error.detail || "").trim();
    const message = String(error.message || "").trim();
    if (detail) return `RouterOS: ${detail}`;
    if (message) return `RouterOS: ${message}`;
  }
  return `RouterOS API returned ${status}.`;
}
function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function rowId(row: Record<string, unknown>) {
  return String(row[".id"] || "");
}
function networkIdOf(row: Record<string, unknown>) {
  return String(row.network || row["network-id"] || "").toLowerCase();
}
function parseRange(value: unknown) {
  const [start, end] = String(value || "").split("-");
  return start && end ? [{ ipRangeStart: start, ipRangeEnd: end }] : [];
}
function parseRoutes(value: unknown) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [target, via] = item.split("@");
      return { target, via: via || null };
    });
}
function stringList(value: unknown) {
  return (Array.isArray(value) ? value : String(value || "").split(","))
    .map((item) => String(item).trim())
    .filter(Boolean);
}
function normalizeControllerNetwork(
  row: Record<string, unknown>,
): ManagedNetwork {
  return {
    id: networkIdOf(row),
    name: String(row.name || row.network || "Unnamed network"),
    comment: String(row.comment || ""),
    instance: String(row.instance || ""),
    private: yes(row.private),
    disabled: yes(row.disabled),
    enableBroadcast: yes(row.broadcast),
    mtu: numberValue(row.mtu),
    multicastLimit: numberValue(row["multicast-limit"]),
    routes: parseRoutes(row.routes),
    ipAssignmentPools: parseRange(row["ip-range"]),
    v6AssignMode: {
      rfc4193: yes(row["ip6-rfc4193"]),
      "6plane": yes(row["ip6-6plane"]),
    },
    raw: row,
  };
}
function normalizeMember(row: Record<string, unknown>): NetworkMember {
  return {
    id: String(row["zt-address"] || row.address || row.id || "").toLowerCase(),
    name: String(row.name || ""),
    comment: String(row.comment || ""),
    authorized: yes(row.authorized),
    disabled: yes(row.disabled),
    activeBridge: yes(row.bridge),
    ipAssignments: stringList(row["ip-address"]),
    lastSeen: String(row["last-seen"] || ""),
    raw: row,
  };
}
function normalizeInterface(row: Record<string, unknown>): ClientNetwork {
  const disabled = yes(row.disabled);
  const running = yes(row.running);
  return {
    id: networkIdOf(row),
    name: String(row.name || row.network || "ZeroTier interface"),
    instance: String(row.instance || ""),
    comment: String(row.comment || ""),
    disabled,
    running,
    status: disabled
      ? "DISABLED"
      : String(row.status || (running ? "OK" : "UNKNOWN")),
    type: String(row.type || "ZeroTier"),
    mac: row["mac-address"] ? String(row["mac-address"]) : undefined,
    mtu: numberValue(row.mtu),
    actualMtu: numberValue(row["actual-mtu"]),
    vrf: String(row.vrf || "main"),
    arpTimeout: String(row["arp-timeout"] || "auto"),
    disableRunningCheck: yes(row["disable-running-check"]),
    allowManaged: yes(row["allow-managed"]),
    allowDefault: yes(row["allow-default"]),
    allowGlobal: yes(row["allow-global"]),
    raw: row,
  };
}

function publicInstanceRow(row: Record<string, unknown>) {
  const result = { ...row };
  const publicIdentity = String(
    result["identity.public"] || result["identity-public"] || "",
  );
  if (!result["identity.address"] && publicIdentity)
    result["identity.address"] = publicIdentity.split(":")[0];
  delete result.identity;
  return result;
}

function normalizeInstance(
  source: Record<string, unknown>,
): RouterOsZeroTierInstance {
  const row = publicInstanceRow(source);
  const publicIdentity = String(
    row["identity.public"] || row["identity-public"] || "",
  );
  const interfaces = stringList(row.interfaces || row.interface);
  const port = numberValue(row.port);
  const routeDistance = numberValue(row["route-distance"]);
  const disabled = yes(row.disabled);
  const state = String(row.state || (disabled ? "disabled" : "unknown"));
  return {
    id: rowId(row),
    name: String(row.name || ""),
    comment: String(row.comment || ""),
    port: port === undefined ? null : port,
    interfaces,
    routeDistance: routeDistance === undefined ? null : routeDistance,
    disabled,
    online: yes(row.online) || (!disabled && state.toLowerCase() === "running"),
    state,
    address:
      String(
        row["identity.address"] ||
          row["identity-address"] ||
          publicIdentity.split(":")[0] ||
          "",
      ) || null,
    identityPublic: publicIdentity || null,
    moons: stringList(row.moons),
  };
}

function instanceBody(input: RouterOsZeroTierInstanceInput) {
  const body: Record<string, unknown> = { name: input.name };
  if (input.comment !== undefined) body.comment = input.comment;
  if (input.port !== undefined) body.port = input.port;
  if (input.interfaces !== undefined)
    body.interfaces = input.interfaces.join(",");
  if (input.routeDistance !== undefined)
    body["route-distance"] = input.routeDistance;
  if (input.enabled !== undefined) body.disabled = input.enabled ? "no" : "yes";
  return body;
}

function memberBody(input: Partial<NetworkMember>) {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.comment !== undefined) body.comment = input.comment;
  if (input.authorized !== undefined)
    body.authorized = input.authorized ? "yes" : "no";
  if (input.disabled !== undefined)
    body.disabled = input.disabled ? "yes" : "no";
  if (input.activeBridge !== undefined)
    body.bridge = input.activeBridge ? "yes" : "no";
  if (input.ipAssignments !== undefined) {
    if (input.ipAssignments.length > 1)
      throw new AdapterError(
        "RouterOS accepts one managed IP address per controller member.",
        400,
      );
    body["ip-address"] = input.ipAssignments[0] || "";
  }
  return body;
}

function normalizePeer(row: Record<string, unknown>): ZeroTierPeer {
  const paths = [
    ...String(row.path || "").matchAll(
      /(?:^|,)active(,preferred)?,([^,]+\/\d+)(?=,|$)/g,
    ),
  ].map((match) => ({
    address: match[2],
    active: true,
    preferred: Boolean(match[1]),
    expired: false,
    lastReceive: null,
    lastSend: null,
  }));
  const latencyMatch = String(row.latency || "").match(/^([\d.]+)ms$/i);
  return {
    address: String(row["zt-address"] || row.address || ""),
    instance: String(row.instance || ""),
    role: String(row.role || "LEAF").toUpperCase(),
    version: null,
    latency: latencyMatch ? Number(latencyMatch[1]) : null,
    tunneled: false,
    paths,
    raw: row,
  };
}

export class MikroTikAdapter implements ControllerAdapter {
  readonly capabilities;
  private agent: Agent;
  constructor(
    private record: ControllerRecord | ManagedNodeRecord,
    private credentials: MikroTikCredentials,
    private fetcher: Fetcher = undiciFetch as unknown as Fetcher,
    mode: "controller" | "node" = "controller",
  ) {
    this.capabilities =
      mode === "controller"
        ? capabilitiesForType("mikrotik")
        : capabilitiesForNodeType("mikrotik");
    this.agent = createAdapterAgent(record.tlsVerify);
  }

  private async request<T = unknown>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const root = this.record.baseUrl
      .replace(/\/+$/, "")
      .replace(/\/rest$/i, "");
    const url = `${root}/rest/${path.replace(/^\/+/, "")}`;
    const auth = Buffer.from(
      `${this.credentials.username}:${this.credentials.password}`,
    ).toString("base64");
    const response = await this.fetcher(url, {
      ...init,
      redirect: "error",
      headers: {
        authorization: `Basic ${auth}`,
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      signal: init.signal || AbortSignal.timeout(12_000),
      ...({ dispatcher: this.agent } as Record<string, unknown>),
    });
    const body = await parseAdapterResponse(response, "RouterOS API");
    if (!response.ok) {
      throw new AdapterError(
        routerErrorMessage(body, response.status),
        response.status,
        body,
      );
    }
    return body as T;
  }

  private async activeInstanceName(requested?: string) {
    const response = await this.request<
      Record<string, unknown> | Record<string, unknown>[]
    >("zerotier");
    const instances = records(response);
    const enabled = instances.filter((instance) => !yes(instance.disabled));
    if (requested) {
      const match = enabled.find(
        (instance) => String(instance.name || "") === requested,
      );
      if (!match)
        throw new AdapterError(
          `RouterOS ZeroTier instance ${requested} is not available or is disabled.`,
          409,
        );
      return requested;
    }
    const selected =
      enabled.find(
        (instance) =>
          String(instance.name || "") === "zt1" &&
          String(instance.state || "").toLowerCase() === "running",
      ) ||
      enabled.find(
        (instance) => String(instance.state || "").toLowerCase() === "running",
      ) ||
      enabled[0];
    const name = String(selected?.name || "").trim();
    if (!name)
      throw new AdapterError(
        "RouterOS has no enabled ZeroTier instance available for this operation.",
        409,
      );
    return name;
  }

  async getStatus(): Promise<ControllerStatus> {
    const [resourceResponse, instanceResponse] = await Promise.all([
      this.request<Record<string, unknown> | Record<string, unknown>[]>(
        "system/resource",
      ),
      this.request<Record<string, unknown> | Record<string, unknown>[]>(
        "zerotier",
      ),
    ]);
    const system = records(resourceResponse)[0] || {};
    const instances = records(instanceResponse);
    const instance = instances[0] || {};
    const identity = String(
      instance["identity.public"] ||
        instance["identity-public"] ||
        instance.identity ||
        "",
    );
    return {
      online: true,
      address:
        String(
          instance["identity.address"] ||
            instance["identity-address"] ||
            identity.split(":")[0] ||
            "",
        ) || null,
      version: system.version ? String(system.version) : null,
      platform:
        `MikroTik RouterOS ${String(system["architecture-name"] || "")}`.trim(),
      details: {
        resource: system,
        zerotier: instances.map(publicInstanceRow),
      },
    };
  }
  async getDiagnostics() {
    const [status, instances, interfaces, controllers, members, peers] =
      await Promise.all([
        this.getStatus(),
        this.request<Record<string, unknown>[]>("zerotier"),
        this.request<unknown[]>("zerotier/interface"),
        this.request<unknown[]>("zerotier/controller"),
        this.request<unknown[]>("zerotier/controller/member"),
        this.request<unknown[]>("zerotier/peer"),
      ]);
    return {
      status,
      instances: instances.map(publicInstanceRow),
      interfaces,
      controllers,
      members,
      peers,
      checkedAt: new Date().toISOString(),
    };
  }

  async listInstances() {
    return (await this.request<Record<string, unknown>[]>("zerotier")).map(
      normalizeInstance,
    );
  }

  async listHostInterfaces() {
    const names = (await this.request<Record<string, unknown>[]>("interface"))
      .map((row) => String(row.name || "").trim())
      .filter(Boolean);
    return [...new Set(names)].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    );
  }

  async createInstance(input: RouterOsZeroTierInstanceInput) {
    const created = await this.request<Record<string, unknown>>("zerotier", {
      method: "PUT",
      body: JSON.stringify(instanceBody(input)),
    });
    const createdId = rowId(created) || String(created.ret || "");
    const instances = await this.listInstances();
    const instance =
      instances.find((item) => createdId && item.id === createdId) ||
      instances.find((item) => item.name === input.name);
    if (!instance)
      throw new AdapterError(
        "RouterOS created the ZeroTier instance but did not return a readable record.",
        502,
        created,
      );
    return instance;
  }

  async updateInstance(
    instanceId: string,
    input: RouterOsZeroTierInstanceInput,
  ) {
    const current = (await this.listInstances()).find(
      (instance) => instance.id === instanceId,
    );
    if (!current)
      throw new AdapterError("RouterOS ZeroTier instance not found.", 404);
    const updated = await this.request<Record<string, unknown>>(
      `zerotier/${encodeURIComponent(instanceId)}`,
      { method: "PATCH", body: JSON.stringify(instanceBody(input)) },
    );
    return normalizeInstance({
      ".id": instanceId,
      name: current.name,
      comment: current.comment,
      port: current.port,
      interfaces: current.interfaces.join(","),
      "route-distance": current.routeDistance,
      disabled: current.disabled ? "true" : "false",
      "identity.address": current.address,
      "identity.public": current.identityPublic,
      state: current.state,
      online: current.online ? "true" : "false",
      moons: current.moons.join(","),
      ...updated,
    });
  }

  async deleteInstance(instanceId: string) {
    const current = (await this.listInstances()).find(
      (instance) => instance.id === instanceId,
    );
    if (!current)
      throw new AdapterError("RouterOS ZeroTier instance not found.", 404);
    await this.request(`zerotier/${encodeURIComponent(instanceId)}`, {
      method: "DELETE",
    });
  }
  async listNetworks() {
    return (
      await this.request<Record<string, unknown>[]>("zerotier/controller")
    ).map(normalizeControllerNetwork);
  }
  async getNetwork(networkId: string) {
    const network = (await this.listNetworks()).find(
      (item) => item.id === networkId,
    );
    if (!network)
      throw new AdapterError("RouterOS controller network not found.", 404);
    const members = await this.listMembers(networkId);
    return { ...network, memberCount: members.length };
  }
  async createNetwork(input: Partial<ManagedNetwork>) {
    const pool = input.ipAssignmentPools?.[0];
    const body: Record<string, unknown> = {
      name: input.name || "New network",
      instance: await this.activeInstanceName(input.instance),
      private: input.private === false ? "no" : "yes",
    };
    if (input.comment !== undefined) body.comment = input.comment;
    if (input.disabled !== undefined)
      body.disabled = input.disabled ? "yes" : "no";
    if (input.enableBroadcast !== undefined)
      body.broadcast = input.enableBroadcast ? "yes" : "no";
    if (input.mtu !== undefined) body.mtu = input.mtu;
    if (input.multicastLimit !== undefined)
      body["multicast-limit"] = input.multicastLimit;
    if (input.v6AssignMode?.rfc4193 !== undefined)
      body["ip6-rfc4193"] = input.v6AssignMode.rfc4193 ? "yes" : "no";
    if (input.v6AssignMode?.["6plane"] !== undefined)
      body["ip6-6plane"] = input.v6AssignMode["6plane"] ? "yes" : "no";
    if (pool) body["ip-range"] = `${pool.ipRangeStart}-${pool.ipRangeEnd}`;
    if (input.routes?.length)
      body.routes = input.routes
        .map((route) => `${route.target}${route.via ? `@${route.via}` : ""}`)
        .join(",");
    const created = await this.request<Record<string, unknown>>(
      "zerotier/controller",
      { method: "PUT", body: JSON.stringify(body) },
    );
    const createdId = rowId(created) || String(created.ret || "");
    const records = await this.request<Record<string, unknown>[]>(
      "zerotier/controller",
    );
    const record =
      records.find((item) => createdId && rowId(item) === createdId) ||
      records.find(
        (item) =>
          String(item.name || "") === String(body.name) &&
          String(item.instance || "") === String(body.instance),
      );
    if (!record)
      throw new AdapterError(
        "RouterOS created the network but did not return a readable record.",
        502,
        created,
      );
    return normalizeControllerNetwork(record);
  }
  async updateNetwork(networkId: string, input: Partial<ManagedNetwork>) {
    const current = await this.getNetwork(networkId);
    const id = rowId(current.raw || {});
    if (!id) throw new AdapterError("RouterOS record ID is missing.", 502);
    const pool = input.ipAssignmentPools?.[0];
    const body: Record<string, unknown> = {};
    if (input.name !== undefined) body.name = input.name;
    if (input.comment !== undefined) body.comment = input.comment;
    if (input.disabled !== undefined)
      body.disabled = input.disabled ? "yes" : "no";
    if (input.private !== undefined)
      body.private = input.private ? "yes" : "no";
    if (input.enableBroadcast !== undefined)
      body.broadcast = input.enableBroadcast ? "yes" : "no";
    if (input.mtu !== undefined) body.mtu = input.mtu;
    if (input.multicastLimit !== undefined)
      body["multicast-limit"] = input.multicastLimit;
    if (input.v6AssignMode?.rfc4193 !== undefined)
      body["ip6-rfc4193"] = input.v6AssignMode.rfc4193 ? "yes" : "no";
    if (input.v6AssignMode?.["6plane"] !== undefined)
      body["ip6-6plane"] = input.v6AssignMode["6plane"] ? "yes" : "no";
    if (pool) body["ip-range"] = `${pool.ipRangeStart}-${pool.ipRangeEnd}`;
    if (input.routes)
      body.routes = input.routes
        .map((route) => `${route.target}${route.via ? `@${route.via}` : ""}`)
        .join(",");
    const updated = await this.request<Record<string, unknown>>(
      `zerotier/controller/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
    return normalizeControllerNetwork({ ...(current.raw || {}), ...updated });
  }
  async deleteNetwork(networkId: string) {
    const current = await this.getNetwork(networkId);
    const id = rowId(current.raw || {});
    if (!id) throw new AdapterError("RouterOS record ID is missing.", 502);
    await this.request(`zerotier/controller/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
  async listMembers(networkId: string) {
    const [members, networks] = await Promise.all([
      this.request<Record<string, unknown>[]>("zerotier/controller/member"),
      this.listNetworks(),
    ]);
    const network = networks.find((item) => item.id === networkId);
    const references = new Set(
      [networkId, network?.name]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLowerCase()),
    );
    return members
      .filter((row) => references.has(networkIdOf(row)))
      .map(normalizeMember);
  }
  async getMember(networkId: string, memberId: string) {
    const member = (await this.listMembers(networkId)).find(
      (item) => item.id === memberId,
    );
    if (!member)
      throw new AdapterError("RouterOS controller member not found.", 404);
    return member;
  }
  async createMember(
    networkId: string,
    memberId: string,
    input: Partial<NetworkMember>,
  ) {
    const network = (await this.listNetworks()).find(
      (item) => item.id === networkId,
    );
    if (!network)
      throw new AdapterError("RouterOS controller network not found.", 404);
    const created = await this.request<Record<string, unknown>>(
      "zerotier/controller/member",
      {
        method: "PUT",
        body: JSON.stringify({
          network: network.name,
          "zt-address": memberId,
          ...memberBody(input),
        }),
      },
    );
    return normalizeMember({
      network: network.name,
      "zt-address": memberId,
      ...created,
    });
  }
  async updateMember(
    networkId: string,
    memberId: string,
    input: Partial<NetworkMember>,
  ) {
    const supportedFields = new Set([
      "name",
      "comment",
      "authorized",
      "disabled",
      "activeBridge",
      "ipAssignments",
    ]);
    const unsupportedFields = Object.keys(input).filter(
      (key) => !supportedFields.has(key),
    );
    if (unsupportedFields.length)
      throw new AdapterError(
        `RouterOS does not support these member fields: ${unsupportedFields.join(", ")}.`,
        400,
        { unsupportedFields },
      );
    const current = await this.getMember(networkId, memberId);
    const id = rowId(current.raw || {});
    if (!id)
      throw new AdapterError("RouterOS member record ID is missing.", 502);
    const updated = await this.request<Record<string, unknown>>(
      `zerotier/controller/member/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(memberBody(input)) },
    );
    return normalizeMember({ ...(current.raw || {}), ...updated });
  }
  async deleteMember(networkId: string, memberId: string) {
    const current = await this.getMember(networkId, memberId);
    const id = rowId(current.raw || {});
    if (!id)
      throw new AdapterError("RouterOS member record ID is missing.", 502);
    await this.request(`zerotier/controller/member/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
  async listClientNetworks() {
    return (
      await this.request<Record<string, unknown>[]>("zerotier/interface")
    ).map(normalizeInterface);
  }
  async listVrfs() {
    const names = (await this.request<Record<string, unknown>[]>("ip/vrf"))
      .map((row) => String(row.name || "").trim())
      .filter(Boolean);
    return [...new Set(["main", ...names])];
  }
  async joinClientNetwork(
    networkId: string,
    input: Partial<ClientNetwork> = {},
  ) {
    const body: Record<string, unknown> = {
      network: networkId,
      name: input.name || `zt-${networkId.slice(-6)}`,
      instance: await this.activeInstanceName(input.instance),
      "allow-managed": input.allowManaged === false ? "no" : "yes",
      "allow-default": input.allowDefault ? "yes" : "no",
      "allow-global": input.allowGlobal ? "yes" : "no",
    };
    if (input.comment !== undefined) body.comment = input.comment;
    if (input.disabled !== undefined)
      body.disabled = input.disabled ? "yes" : "no";
    if (input.vrf !== undefined) body.vrf = input.vrf;
    if (input.arpTimeout !== undefined) body["arp-timeout"] = input.arpTimeout;
    if (input.disableRunningCheck !== undefined)
      body["disable-running-check"] = input.disableRunningCheck ? "yes" : "no";
    const created = await this.request<Record<string, unknown>>(
      "zerotier/interface",
      { method: "PUT", body: JSON.stringify(body) },
    );
    const createdId = rowId(created) || String(created.ret || "");
    const records =
      await this.request<Record<string, unknown>[]>("zerotier/interface");
    const record =
      records.find((item) => createdId && rowId(item) === createdId) ||
      records.find(
        (item) =>
          networkIdOf(item) === networkId &&
          String(item.instance || "") === body.instance,
      );
    if (!record)
      throw new AdapterError(
        "RouterOS created the interface but did not return a readable record.",
        502,
        created,
      );
    return normalizeInterface(record);
  }
  async updateClientNetwork(networkId: string, input: Partial<ClientNetwork>) {
    const current = (await this.listClientNetworks()).find(
      (item) =>
        item.id === networkId &&
        (!input.instance || item.instance === input.instance),
    );
    if (!current)
      throw new AdapterError("RouterOS ZeroTier interface not found.", 404);
    const id = rowId(current.raw || {});
    if (!id)
      throw new AdapterError("RouterOS interface record ID is missing.", 502);
    const body: Record<string, unknown> = {};
    if (input.name !== undefined) body.name = input.name;
    if (input.comment !== undefined) body.comment = input.comment;
    if (input.disabled !== undefined)
      body.disabled = input.disabled ? "yes" : "no";
    if (input.vrf !== undefined) body.vrf = input.vrf;
    if (input.arpTimeout !== undefined) body["arp-timeout"] = input.arpTimeout;
    if (input.disableRunningCheck !== undefined)
      body["disable-running-check"] = input.disableRunningCheck ? "yes" : "no";
    if (input.allowManaged !== undefined)
      body["allow-managed"] = input.allowManaged ? "yes" : "no";
    if (input.allowDefault !== undefined)
      body["allow-default"] = input.allowDefault ? "yes" : "no";
    if (input.allowGlobal !== undefined)
      body["allow-global"] = input.allowGlobal ? "yes" : "no";
    return normalizeInterface({
      ...(current.raw || {}),
      ...(await this.request<Record<string, unknown>>(
        `zerotier/interface/${encodeURIComponent(id)}`,
        { method: "PATCH", body: JSON.stringify(body) },
      )),
    });
  }
  async leaveClientNetwork(networkId: string, instance?: string) {
    const current = (await this.listClientNetworks()).find(
      (item) =>
        item.id === networkId && (!instance || item.instance === instance),
    );
    if (!current)
      throw new AdapterError("RouterOS ZeroTier interface not found.", 404);
    const id = rowId(current.raw || {});
    if (!id)
      throw new AdapterError("RouterOS interface record ID is missing.", 502);
    await this.request(`zerotier/interface/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
  async listPeers() {
    return (await this.request<Record<string, unknown>[]>("zerotier/peer")).map(
      normalizePeer,
    );
  }
  async listMoons() {
    return [];
  }
  async orbitMoon(): Promise<Moon> {
    throw new AdapterError(
      "Moon management is not exposed by the RouterOS ZeroTier API.",
      501,
    );
  }
  async deorbitMoon() {
    throw new AdapterError(
      "Moon management is not exposed by the RouterOS ZeroTier API.",
      501,
    );
  }
}
