import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capabilitiesForType } from "@/lib/controller-capabilities";
import { buildOverviewSnapshot } from "@/lib/overview";
import type { NetworkControllerAdapter } from "@/lib/adapters/types";
import type {
  OverviewSnapshot,
  PublicController,
  PublicManagedNode,
} from "@/lib/types";

function controller(
  id: string,
  enabled = true,
  type: PublicController["type"] = "zerotier",
): PublicController {
  return {
    id,
    type,
    name: `Controller ${id}`,
    baseUrl: `https://${id}.example.test`,
    enabled,
    tlsVerify: true,
    embedded: type === "embedded",
    configuration: {},
    lastCheckedAt: null,
    lastOnline: null,
    lastAddress: null,
    lastVersion: null,
    lastError: null,
    createdAt: 1,
    updatedAt: 1,
    capabilities: capabilitiesForType(type),
  };
}

function node(controllerId: string): PublicManagedNode {
  return {
    id: `node-${controllerId}`,
    controllerId,
    type: "zerotier",
    name: `Node ${controllerId}`,
    baseUrl: "https://node.example.test",
    enabled: true,
    tlsVerify: true,
    local: false,
    lastCheckedAt: null,
    lastOnline: null,
    lastAddress: null,
    lastVersion: null,
    lastError: null,
    createdAt: 1,
    updatedAt: 1,
    capabilities: capabilitiesForType("zerotier"),
  };
}

function adapter(input: {
  status?: "online" | "error";
  networks?: "ok" | "error";
  members?: number;
}): NetworkControllerAdapter {
  return {
    capabilities: capabilitiesForType("zerotier"),
    getStatus: async () => {
      if (input.status === "error") throw new Error("status unavailable");
      return {
        online: true,
        address: "1234567890",
        version: "1.2.3",
        platform: "linux",
      };
    },
    listNetworks: async () => {
      if (input.networks === "error") throw new Error("networks unavailable");
      return [
        {
          id: "1234567890abcdef",
          name: "Production",
          private: true,
          routes: [{ target: "10.0.0.0/24" }],
        },
      ];
    },
    listMembers: async () =>
      Array.from({ length: input.members || 0 }, (_, index) => ({
        id: String(index),
        name: `Member ${index}`,
        authorized: true,
      })),
  } as unknown as NetworkControllerAdapter;
}

describe("control-plane overview aggregation", () => {
  it("aggregates every controller and enriches missing member counts", async () => {
    let disabledAdapterCalls = 0;
    const snapshot = await buildOverviewSnapshot(
      [controller("online"), controller("disabled", false)],
      [node("online")],
      {
        adapterFor(id) {
          if (id === "disabled") disabledAdapterCalls += 1;
          return adapter({ members: 3 });
        },
        now: () => 1234,
        timeoutMs: 100,
      },
    );

    assert.equal(disabledAdapterCalls, 0);
    assert.equal(snapshot.generatedAt, 1234);
    assert.deepEqual(snapshot.totals, {
      controllers: 2,
      enabledControllers: 1,
      onlineControllers: 1,
      networks: 1,
      members: 3,
      managedNodes: 1,
      issues: 0,
    });
    assert.equal(snapshot.controllers[0].networks[0].routeCount, 1);
    assert.equal(snapshot.controllers[0].managedNodeCount, 1);
    assert.equal(snapshot.controllers[1].health, "disabled");
  });

  it("keeps cached network totals when an endpoint becomes unavailable", async () => {
    const previous: OverviewSnapshot = {
      generatedAt: 100,
      totals: {
        controllers: 1,
        enabledControllers: 1,
        onlineControllers: 1,
        networks: 1,
        members: 7,
        managedNodes: 0,
        issues: 0,
      },
      controllers: [
        {
          id: "offline",
          name: "Controller offline",
          type: "zerotier",
          embedded: false,
          enabled: true,
          health: "online",
          address: "1234567890",
          version: "1.2.3",
          platform: "linux",
          checkedAt: 100,
          managedNodeCount: 0,
          networks: [
            {
              id: "1234567890abcdef",
              name: "Cached",
              private: true,
              memberCount: 7,
              routeCount: 0,
            },
          ],
          stale: false,
          error: null,
        },
      ],
    };
    const snapshot = await buildOverviewSnapshot(
      [controller("offline")],
      [],
      {
        adapterFor: () =>
          adapter({ status: "error", networks: "error", members: 0 }),
        now: () => 200,
        timeoutMs: 100,
      },
      previous,
    );

    assert.equal(snapshot.controllers[0].health, "offline");
    assert.equal(snapshot.controllers[0].stale, true);
    assert.equal(snapshot.controllers[0].networks[0].memberCount, 7);
    assert.equal(snapshot.totals.members, 7);
    assert.equal(snapshot.totals.issues, 1);
  });

  it("returns a degraded partial result instead of failing the overview", async () => {
    const snapshot = await buildOverviewSnapshot([controller("partial")], [], {
      adapterFor: () =>
        adapter({ status: "error", networks: "ok", members: 2 }),
      timeoutMs: 100,
    });

    assert.equal(snapshot.controllers[0].health, "degraded");
    assert.equal(snapshot.controllers[0].networks[0].memberCount, 2);
    assert.match(snapshot.controllers[0].error || "", /status unavailable/);
  });

  it("only probes status while a controller is known to be offline", async () => {
    let statusCalls = 0;
    let networkCalls = 0;
    let recovered = false;
    const offline = {
      ...controller("recovering"),
      lastOnline: false,
      lastError: "previous timeout",
    };
    const base = adapter({ members: 2 });
    const snapshot = await buildOverviewSnapshot([offline], [], {
      adapterFor: () => ({
        ...base,
        getStatus: async () => {
          statusCalls += 1;
          return base.getStatus();
        },
        listNetworks: async () => {
          networkCalls += 1;
          return base.listNetworks();
        },
      }),
      onStatus: (_id, status) => {
        recovered = status?.online === true;
      },
      timeoutMs: 100,
    });

    assert.equal(statusCalls, 1);
    assert.equal(networkCalls, 0);
    assert.equal(recovered, true);
    assert.equal(snapshot.controllers[0].health, "degraded");
    assert.equal(snapshot.controllers[0].networks.length, 0);
  });
});
