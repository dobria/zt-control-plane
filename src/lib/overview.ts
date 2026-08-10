import type { NetworkControllerAdapter } from "@/lib/adapters/types";
import type {
  ControllerStatus,
  ManagedNetwork,
  OverviewControllerSnapshot,
  OverviewNetworkSnapshot,
  OverviewSnapshot,
  PublicController,
  PublicManagedNode,
} from "@/lib/types";

interface OverviewDependencies {
  adapterFor(controllerId: string): NetworkControllerAdapter;
  onStatus?(
    controllerId: string,
    status: ControllerStatus | null,
    error?: string,
  ): void;
  now?: () => number;
  timeoutMs?: number;
}

const aggregateReadTimeoutMs = 6_000;
const offlineProbeTimeoutMs = 3_000;

function errorMessage(reason: unknown) {
  return reason instanceof Error
    ? reason.message
    : "Controller request failed.";
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

function networkSnapshot(network: ManagedNetwork): OverviewNetworkSnapshot {
  return {
    id: network.id,
    name: network.name || "Unnamed network",
    private: network.private !== false,
    memberCount: Math.max(0, Number(network.memberCount || 0)),
    routeCount: Array.isArray(network.routes) ? network.routes.length : 0,
  };
}

async function listNetworks(adapter: NetworkControllerAdapter) {
  const networks = await adapter.listNetworks();
  return Promise.all(
    networks.map(async (network) => {
      if (network.memberCount !== undefined || !adapter.capabilities.memberCrud)
        return networkSnapshot(network);
      try {
        const members = await adapter.listMembers(network.id);
        return networkSnapshot({ ...network, memberCount: members.length });
      } catch {
        return networkSnapshot(network);
      }
    }),
  );
}

async function controllerSnapshot(
  controller: PublicController,
  managedNodeCount: number,
  previous: OverviewControllerSnapshot | undefined,
  dependencies: OverviewDependencies,
): Promise<OverviewControllerSnapshot> {
  if (!controller.enabled)
    return {
      id: controller.id,
      name: controller.name,
      type: controller.type,
      embedded: controller.embedded,
      enabled: false,
      health: "disabled",
      address: controller.lastAddress,
      version: controller.lastVersion,
      platform: controller.type,
      checkedAt: controller.lastCheckedAt,
      managedNodeCount,
      networks: previous?.networks || [],
      stale: Boolean(previous?.networks.length),
      error: null,
    };

  let adapter: NetworkControllerAdapter;
  try {
    adapter = dependencies.adapterFor(controller.id);
  } catch (reason) {
    const message = errorMessage(reason);
    dependencies.onStatus?.(controller.id, null, message);
    return {
      id: controller.id,
      name: controller.name,
      type: controller.type,
      embedded: controller.embedded,
      enabled: true,
      health: "offline",
      address: controller.lastAddress,
      version: controller.lastVersion,
      platform: controller.type,
      checkedAt: controller.lastCheckedAt,
      managedNodeCount,
      networks: previous?.networks || [],
      stale: Boolean(previous?.networks.length),
      error: message,
    };
  }
  const timeoutMs = dependencies.timeoutMs ?? aggregateReadTimeoutMs;
  if (controller.lastOnline === false) {
    try {
      const status = await withTimeout(
        adapter.getStatus(),
        Math.min(timeoutMs, offlineProbeTimeoutMs),
        `${controller.name} status`,
      );
      dependencies.onStatus?.(controller.id, status);
      return {
        id: controller.id,
        name: controller.name,
        type: controller.type,
        embedded: controller.embedded,
        enabled: true,
        health: status.online ? "degraded" : "offline",
        address: status.address || controller.lastAddress,
        version: status.version || controller.lastVersion,
        platform: status.platform || controller.type,
        checkedAt: dependencies.now?.() || Date.now(),
        managedNodeCount,
        networks: previous?.networks || [],
        stale: Boolean(previous?.networks.length),
        error: status.online ? null : controller.lastError,
      };
    } catch (reason) {
      const error = errorMessage(reason);
      dependencies.onStatus?.(controller.id, null, error);
      return {
        id: controller.id,
        name: controller.name,
        type: controller.type,
        embedded: controller.embedded,
        enabled: true,
        health: "offline",
        address: controller.lastAddress,
        version: controller.lastVersion,
        platform: controller.type,
        checkedAt: controller.lastCheckedAt,
        managedNodeCount,
        networks: previous?.networks || [],
        stale: Boolean(previous?.networks.length),
        error,
      };
    }
  }
  const [statusResult, networkResult] = await Promise.allSettled([
    withTimeout(adapter.getStatus(), timeoutMs, `${controller.name} status`),
    withTimeout(
      listNetworks(adapter),
      timeoutMs,
      `${controller.name} networks`,
    ),
  ]);
  const status =
    statusResult.status === "fulfilled" ? statusResult.value : null;
  const statusError =
    statusResult.status === "rejected"
      ? errorMessage(statusResult.reason)
      : null;
  const networkError =
    networkResult.status === "rejected"
      ? errorMessage(networkResult.reason)
      : null;
  dependencies.onStatus?.(controller.id, status, statusError || undefined);
  const networks =
    networkResult.status === "fulfilled"
      ? networkResult.value
      : previous?.networks || [];
  const stale =
    networkResult.status === "rejected" && Boolean(previous?.networks.length);
  const successfulRequests =
    Number(statusResult.status === "fulfilled") +
    Number(networkResult.status === "fulfilled");
  const health =
    successfulRequests === 2 && status?.online
      ? "online"
      : successfulRequests > 0
        ? "degraded"
        : "offline";

  return {
    id: controller.id,
    name: controller.name,
    type: controller.type,
    embedded: controller.embedded,
    enabled: true,
    health,
    address: status?.address || controller.lastAddress,
    version: status?.version || controller.lastVersion,
    platform: status?.platform || controller.type,
    checkedAt:
      statusResult.status === "fulfilled"
        ? dependencies.now?.() || Date.now()
        : controller.lastCheckedAt,
    managedNodeCount,
    networks,
    stale,
    error: [statusError, networkError].filter(Boolean).join(" · ") || null,
  };
}

export async function buildOverviewSnapshot(
  controllers: PublicController[],
  nodes: PublicManagedNode[],
  dependencies: OverviewDependencies,
  previous?: OverviewSnapshot | null,
): Promise<OverviewSnapshot> {
  const previousById = new Map(
    (previous?.controllers || []).map((controller) => [
      controller.id,
      controller,
    ]),
  );
  const snapshots = await Promise.all(
    controllers.map((controller) =>
      controllerSnapshot(
        controller,
        nodes.filter((node) => node.controllerId === controller.id).length,
        previousById.get(controller.id),
        dependencies,
      ),
    ),
  );
  const enabled = snapshots.filter((controller) => controller.enabled);
  return {
    generatedAt: dependencies.now?.() || Date.now(),
    controllers: snapshots,
    totals: {
      controllers: snapshots.length,
      enabledControllers: enabled.length,
      onlineControllers: enabled.filter(
        (controller) => controller.health === "online",
      ).length,
      networks: snapshots.reduce(
        (sum, controller) => sum + controller.networks.length,
        0,
      ),
      members: snapshots.reduce(
        (sum, controller) =>
          sum +
          controller.networks.reduce(
            (networkSum, network) => networkSum + network.memberCount,
            0,
          ),
        0,
      ),
      managedNodes: nodes.length,
      issues: enabled.filter((controller) => controller.health !== "online")
        .length,
    },
  };
}
