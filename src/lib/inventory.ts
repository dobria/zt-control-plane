import type {
  ManagedNodeAdapter,
  NetworkControllerAdapter,
} from "@/lib/adapters/types";
import {
  cachedClientNetworks,
  cachedMembers,
  cachedNetworks,
  saveClientNetworkInventory,
  saveMemberInventory,
  saveNetworkInventory,
} from "@/lib/inventory-store";
import { getNetworkMetadata } from "@/lib/metadata";
import type {
  ControllerStatus,
  InventoryControllerState,
  ManagedEndpointInventoryItem,
  ManagedNetwork,
  NetworkInventoryItem,
  NetworkInventorySnapshot,
  NodeInventoryIdentity,
  NodeInventoryMembership,
  NodeInventorySnapshot,
  PublicController,
  PublicManagedNode,
  RouterOsZeroTierInstance,
} from "@/lib/types";

export interface InventoryDependencies {
  controllerAdapterFor(controllerId: string): NetworkControllerAdapter;
  nodeAdapterFor(nodeId: string): ManagedNodeAdapter;
  onNodeStatus?(
    nodeId: string,
    status: ControllerStatus | null,
    error?: string,
  ): void;
  now?: () => number;
  timeoutMs?: number;
}

function message(reason: unknown) {
  return reason instanceof Error ? reason.message : "Provider request failed.";
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  task: (value: T) => Promise<R>,
) {
  const result = new Array<R>(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next++;
      result[index] = await task(values[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );
  return result;
}

function enrichedNetwork(
  controllerId: string,
  network: ManagedNetwork,
): ManagedNetwork {
  const metadata = getNetworkMetadata(controllerId, network.id);
  const cachedMemberCount = cachedMembers(controllerId, network.id).length;
  return {
    ...network,
    description: metadata.description || String(network.description || ""),
    memberCount:
      network.memberCount === undefined
        ? cachedMemberCount
        : Math.max(0, Number(network.memberCount || 0)),
  };
}

function controllerItems(
  controller: PublicController,
  networks: Array<{ network: ManagedNetwork; syncedAt: number }>,
  stale: boolean,
  error: string | null,
): NetworkInventoryItem[] {
  return networks.map(({ network, syncedAt }) => ({
    controllerId: controller.id,
    controllerName: controller.name,
    controllerType: controller.type,
    controllerEnabled: controller.enabled,
    controllerOnline: stale ? controller.lastOnline : true,
    network,
    lastSyncedAt: syncedAt,
    stale,
    error,
  }));
}

export async function buildNetworkInventory(
  controllers: PublicController[],
  dependencies: InventoryDependencies,
): Promise<NetworkInventorySnapshot> {
  const now = dependencies.now?.() || Date.now();
  const timeoutMs = dependencies.timeoutMs ?? 18_000;
  const controllerResults = await mapLimit(
    controllers,
    5,
    async (controller) => {
      const cached = cachedNetworks(controller.id);
      if (!controller.enabled)
        return {
          controller,
          items: controllerItems(
            controller,
            cached,
            Boolean(cached.length),
            "Controller is disabled.",
          ),
          stale: Boolean(cached.length),
          error: "Controller is disabled.",
          syncedAt: cached[0]?.syncedAt || null,
        };
      try {
        const adapter = dependencies.controllerAdapterFor(controller.id);
        const networks = (
          await withTimeout(
            adapter.listNetworks(),
            timeoutMs,
            `${controller.name} networks`,
          )
        ).map((network) => enrichedNetwork(controller.id, network));
        saveNetworkInventory(controller.id, networks, now);
        return {
          controller,
          items: controllerItems(
            controller,
            networks.map((network) => ({ network, syncedAt: now })),
            false,
            null,
          ),
          stale: false,
          error: null,
          syncedAt: now,
        };
      } catch (reason) {
        const error = message(reason);
        return {
          controller,
          items: controllerItems(controller, cached, true, error),
          stale: Boolean(cached.length),
          error,
          syncedAt: cached[0]?.syncedAt || null,
        };
      }
    },
  );
  return {
    generatedAt: now,
    items: controllerResults.flatMap((result) => result.items),
    controllers: controllerResults.map((result): InventoryControllerState => ({
      id: result.controller.id,
      name: result.controller.name,
      type: result.controller.type,
      enabled: result.controller.enabled,
      online: result.error ? result.controller.lastOnline : true,
      networkCount: result.items.length,
      stale: result.stale,
      error: result.error,
      lastSyncedAt: result.syncedAt,
    })),
  };
}

async function endpointInventory(
  node: PublicManagedNode,
  controller: PublicController | undefined,
  dependencies: InventoryDependencies,
): Promise<ManagedEndpointInventoryItem> {
  const cached = cachedClientNetworks(node.id);
  const cachedAt = cached.reduce(
    (latest, item) => Math.max(latest, item.syncedAt),
    0,
  );
  if (!node.enabled)
    return {
      id: node.id,
      controllerId: node.controllerId,
      controllerName: controller?.name || null,
      type: node.type,
      name: node.name,
      enabled: false,
      online: false,
      address: node.lastAddress,
      version: node.lastVersion,
      instances: [],
      joinedNetworks: cached.map((item) => item.network),
      lastSyncedAt: cachedAt || node.lastCheckedAt,
      stale: Boolean(cached.length),
      error: "Managed endpoint is disabled.",
    };
  const timeoutMs = dependencies.timeoutMs ?? 18_000;
  try {
    const adapter = dependencies.nodeAdapterFor(node.id);
    const [statusResult, networksResult, instancesResult] =
      await Promise.allSettled([
        withTimeout(adapter.getStatus(), timeoutMs, `${node.name} status`),
        withTimeout(
          adapter.listClientNetworks(),
          timeoutMs,
          `${node.name} joined networks`,
        ),
        adapter.listInstances
          ? withTimeout(
              adapter.listInstances(),
              timeoutMs,
              `${node.name} instances`,
            )
          : Promise.resolve([] as RouterOsZeroTierInstance[]),
      ]);
    const status =
      statusResult.status === "fulfilled" ? statusResult.value : null;
    const joinedNetworks =
      networksResult.status === "fulfilled"
        ? networksResult.value
        : cached.map((item) => item.network);
    const syncedAt = dependencies.now?.() || Date.now();
    if (networksResult.status === "fulfilled")
      saveClientNetworkInventory(node.id, joinedNetworks, syncedAt);
    const errors = [statusResult, networksResult, instancesResult]
      .filter((result) => result.status === "rejected")
      .map((result) => message((result as PromiseRejectedResult).reason));
    const endpointError = errors.join(" · ");
    dependencies.onNodeStatus?.(node.id, status, endpointError || undefined);
    return {
      id: node.id,
      controllerId: node.controllerId,
      controllerName: controller?.name || null,
      type: node.type,
      name: node.name,
      enabled: true,
      online: status?.online ?? node.lastOnline,
      address: status?.address || node.lastAddress,
      version: status?.version || node.lastVersion,
      instances:
        instancesResult.status === "fulfilled" ? instancesResult.value : [],
      joinedNetworks,
      lastSyncedAt:
        status || networksResult.status === "fulfilled"
          ? syncedAt
          : cachedAt || node.lastCheckedAt,
      stale: errors.length > 0,
      error: endpointError || null,
    };
  } catch (reason) {
    const error = message(reason);
    dependencies.onNodeStatus?.(node.id, null, error);
    return {
      id: node.id,
      controllerId: node.controllerId,
      controllerName: controller?.name || null,
      type: node.type,
      name: node.name,
      enabled: true,
      online: false,
      address: node.lastAddress,
      version: node.lastVersion,
      instances: [],
      joinedNetworks: cached.map((item) => item.network),
      lastSyncedAt: cachedAt || node.lastCheckedAt,
      stale: true,
      error,
    };
  }
}

function memberOnline(member: NodeInventoryMembership) {
  const raw = member.member.raw || {};
  return typeof raw.online === "boolean" ? raw.online : null;
}

function aggregateIdentities(
  memberships: NodeInventoryMembership[],
  endpoints: ManagedEndpointInventoryItem[],
) {
  const identities = new Map<
    string,
    NodeInventoryIdentity & { names: string[] }
  >();
  function ensure(id: string, address: string | null) {
    const key = id.toLowerCase();
    let identity = identities.get(key);
    if (!identity) {
      identity = {
        id: key,
        address,
        name: address || "Managed endpoint",
        names: [],
        managed: false,
        online: null,
        endpointIds: [],
        memberships: [],
        authorizedMemberships: 0,
        pendingMemberships: 0,
        controllerCount: 0,
        networkCount: 0,
        stale: false,
      };
      identities.set(key, identity);
    }
    return identity;
  }
  for (const membership of memberships) {
    const identity = ensure(membership.member.id, membership.member.id);
    identity.memberships.push(membership);
    if (membership.member.name) identity.names.push(membership.member.name);
    identity.stale ||= membership.stale;
    const online = memberOnline(membership);
    if (online === true) identity.online = true;
    else if (identity.online === null && online === false)
      identity.online = false;
  }
  for (const endpoint of endpoints) {
    const addresses = endpoint.instances.length
      ? endpoint.instances
          .map((instance) => instance.address)
          .filter((value): value is string => Boolean(value))
      : endpoint.address
        ? [endpoint.address]
        : [];
    const keys = addresses.length ? addresses : [`endpoint:${endpoint.id}`];
    for (const address of keys) {
      const identity = ensure(
        address,
        address.startsWith("endpoint:") ? null : address,
      );
      identity.managed = true;
      identity.endpointIds.push(endpoint.id);
      identity.names.unshift(endpoint.name);
      identity.stale ||= endpoint.stale;
      if (endpoint.online === true) identity.online = true;
      else if (identity.online === null && endpoint.online === false)
        identity.online = false;
    }
  }
  return [...identities.values()].map((identity) => {
    const controllers = new Set(
      identity.memberships.map((membership) => membership.controllerId),
    );
    const networks = new Set(
      identity.memberships.map(
        (membership) => `${membership.controllerId}:${membership.networkId}`,
      ),
    );
    return {
      id: identity.id,
      address: identity.address,
      name:
        identity.names.find((name) => name && name !== identity.address) ||
        identity.address ||
        "Managed endpoint",
      managed: identity.managed,
      online: identity.online,
      endpointIds: [...new Set(identity.endpointIds)],
      memberships: identity.memberships,
      authorizedMemberships: identity.memberships.filter(
        (membership) => membership.member.authorized,
      ).length,
      pendingMemberships: identity.memberships.filter(
        (membership) => !membership.member.authorized,
      ).length,
      controllerCount: controllers.size,
      networkCount: networks.size,
      stale: identity.stale,
    } satisfies NodeInventoryIdentity;
  });
}

export async function buildNodeInventory(
  controllers: PublicController[],
  nodes: PublicManagedNode[],
  dependencies: InventoryDependencies,
): Promise<NodeInventorySnapshot> {
  const networks = await buildNetworkInventory(controllers, dependencies);
  const adapters = new Map<string, NetworkControllerAdapter>();
  const membershipGroups = await mapLimit(networks.items, 5, async (item) => {
    const cached = cachedMembers(item.controllerId, item.network.id);
    if (!item.controllerEnabled || item.stale)
      return cached.map(({ member, syncedAt }): NodeInventoryMembership => ({
        controllerId: item.controllerId,
        controllerName: item.controllerName,
        controllerType: item.controllerType,
        networkId: item.network.id,
        networkName: item.network.name,
        member,
        lastSyncedAt: syncedAt,
        stale: true,
      }));
    try {
      let adapter = adapters.get(item.controllerId);
      if (!adapter) {
        adapter = dependencies.controllerAdapterFor(item.controllerId);
        adapters.set(item.controllerId, adapter);
      }
      const syncedAt = dependencies.now?.() || Date.now();
      const members = await withTimeout(
        adapter.listMembers(item.network.id),
        dependencies.timeoutMs ?? 18_000,
        `${item.network.name} members`,
      );
      saveMemberInventory(
        item.controllerId,
        item.network.id,
        members,
        syncedAt,
      );
      return members.map((member): NodeInventoryMembership => ({
        controllerId: item.controllerId,
        controllerName: item.controllerName,
        controllerType: item.controllerType,
        networkId: item.network.id,
        networkName: item.network.name,
        member,
        lastSyncedAt: syncedAt,
        stale: false,
      }));
    } catch {
      return cached.map(({ member, syncedAt }): NodeInventoryMembership => ({
        controllerId: item.controllerId,
        controllerName: item.controllerName,
        controllerType: item.controllerType,
        networkId: item.network.id,
        networkName: item.network.name,
        member,
        lastSyncedAt: syncedAt,
        stale: true,
      }));
    }
  });
  const controllerById = new Map(controllers.map((item) => [item.id, item]));
  const endpoints = await mapLimit(nodes, 5, (node) =>
    endpointInventory(
      node,
      node.controllerId ? controllerById.get(node.controllerId) : undefined,
      dependencies,
    ),
  );
  const memberships = membershipGroups.flat();
  return {
    generatedAt: dependencies.now?.() || Date.now(),
    identities: aggregateIdentities(memberships, endpoints),
    endpoints,
    controllers: networks.controllers,
  };
}
