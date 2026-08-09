import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { after, before, describe, it } from "node:test";
import type {
  ManagedNodeAdapter,
  NetworkControllerAdapter,
} from "@/lib/adapters/types";
import { capabilitiesForType } from "@/lib/controller-capabilities";
import { listPublicControllers } from "@/lib/controller-registry";
import { closeDatabaseForTests, db } from "@/lib/database";
import { buildNetworkInventory, buildNodeInventory } from "@/lib/inventory";
import { listPublicNodes } from "@/lib/node-registry";

const databaseFile = path.join(
  tmpdir(),
  `ztcp-inventory-${randomUUID()}.sqlite`,
);

before(() => {
  process.env.DATABASE_PATH = databaseFile;
  process.env.EMBEDDED_ZEROTIER = "1";
  process.env.APP_SECRET = "inventory-test-secret-that-is-long-enough";
});

after(() => closeDatabaseForTests());

function controllerAdapter(options: { failNetworks?: boolean } = {}) {
  return {
    capabilities: capabilitiesForType("embedded"),
    getStatus: async () => ({
      online: true,
      address: "aabbccdd01",
      version: "1.16.0",
      platform: "linux",
    }),
    listNetworks: async () => {
      if (options.failNetworks) throw new Error("controller unavailable");
      return [
        {
          id: "aabbccdd01000001",
          name: "Production",
          private: true,
          routes: [{ target: "10.20.0.0/24" }],
        },
      ];
    },
    listMembers: async () => [
      {
        id: "aabbccdd01",
        name: "Edge gateway",
        authorized: true,
        raw: { online: true },
      },
      {
        id: "aabbccdd02",
        name: "Awaiting laptop",
        authorized: false,
      },
    ],
  } as unknown as NetworkControllerAdapter;
}

function nodeAdapter() {
  return {
    capabilities: capabilitiesForType("zerotier"),
    getStatus: async () => ({
      online: true,
      address: "aabbccdd01",
      version: "1.16.0",
      platform: "linux",
    }),
    listClientNetworks: async () => [
      {
        id: "aabbccdd01000001",
        name: "Production",
        status: "OK",
        type: "PRIVATE",
        assignedAddresses: ["10.20.0.1/24"],
      },
    ],
  } as unknown as ManagedNodeAdapter;
}

describe("global controller inventory", () => {
  it("uses a controller-scoped cache when a provider becomes unavailable", async () => {
    const controllers = listPublicControllers();
    const fresh = await buildNetworkInventory(controllers, {
      controllerAdapterFor: () => controllerAdapter(),
      nodeAdapterFor: () => nodeAdapter(),
      now: () => 1000,
      timeoutMs: 100,
    });

    assert.equal(fresh.items.length, 1);
    assert.equal(fresh.items[0].stale, false);
    assert.equal(fresh.items[0].network.name, "Production");
    const storedNetwork = db()
      .prepare("SELECT payload_json FROM network_inventory LIMIT 1")
      .get() as { payload_json: string };
    assert.equal("raw" in JSON.parse(storedNetwork.payload_json), false);

    const cached = await buildNetworkInventory(controllers, {
      controllerAdapterFor: () => controllerAdapter({ failNetworks: true }),
      nodeAdapterFor: () => nodeAdapter(),
      now: () => 2000,
      timeoutMs: 100,
    });

    assert.equal(cached.items.length, 1);
    assert.equal(cached.items[0].stale, true);
    assert.equal(cached.items[0].lastSyncedAt, 1000);
    assert.match(cached.controllers[0].error || "", /unavailable/);
  });

  it("merges a managed endpoint with its memberships by ZeroTier identity", async () => {
    const snapshot = await buildNodeInventory(
      listPublicControllers(),
      listPublicNodes(),
      {
        controllerAdapterFor: () => controllerAdapter(),
        nodeAdapterFor: () => nodeAdapter(),
        now: () => 3000,
        timeoutMs: 100,
      },
    );

    const managed = snapshot.identities.find(
      (identity) => identity.address === "aabbccdd01",
    );
    assert.ok(managed);
    assert.equal(managed.name, "Local node");
    assert.equal(managed.managed, true);
    assert.equal(managed.online, true);
    assert.equal(managed.controllerCount, 1);
    assert.equal(managed.networkCount, 1);
    assert.equal(managed.authorizedMemberships, 1);

    const pending = snapshot.identities.find(
      (identity) => identity.address === "aabbccdd02",
    );
    assert.ok(pending);
    assert.equal(pending.managed, false);
    assert.equal(pending.pendingMemberships, 1);
    assert.equal(snapshot.endpoints[0].joinedNetworks.length, 1);
    const storedMember = db()
      .prepare("SELECT payload_json FROM member_inventory WHERE member_id=?")
      .get("aabbccdd01") as { payload_json: string };
    assert.equal("raw" in JSON.parse(storedMember.payload_json), false);
  });
});
