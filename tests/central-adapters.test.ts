import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CentralAdapter } from "@/lib/adapters/central";
import type { Fetcher } from "@/lib/adapters/types";
import type { ControllerRecord, ControllerType } from "@/lib/types";

function record(
  type: Extract<ControllerType, "central_v1" | "central_v2">,
  configuration: ControllerRecord["configuration"] = {},
): ControllerRecord {
  return {
    id: `test-${type}`,
    type,
    name: "Central test",
    baseUrl:
      type === "central_v2"
        ? "https://central.zerotier.com"
        : "https://api.zerotier.com",
    encryptedCredentials: null,
    configuration,
    enabled: true,
    tlsVerify: true,
    embedded: false,
    lastCheckedAt: null,
    lastOnline: null,
    lastAddress: null,
    lastVersion: null,
    lastError: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Legacy Central adapter", () => {
  it("uses token authentication and the v1 network/member CRUD endpoints", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: Fetcher = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/status")) return json({ id: "account-1" });
      if (path.endsWith("/member/a09acf0234")) {
        return json({
          id: "8056c2e21c000001-a09acf0234",
          nodeId: "a09acf0234",
          name: "Branch gateway",
          config: {
            authorized: true,
            id: "a09acf0234",
            ipAssignments: ["10.10.0.5"],
            vMajor: 1,
            vMinor: 16,
            vRev: 2,
          },
        });
      }
      return json([
        {
          id: "8056c2e21c000001",
          config: { name: "Legacy network", private: true },
        },
      ]);
    };
    const adapter = new CentralAdapter(
      record("central_v1"),
      { apiToken: "legacy-token" },
      fetcher,
    );

    const status = await adapter.getStatus();
    const networks = await adapter.listNetworks();
    const member = await adapter.updateMember(
      "8056c2e21c000001",
      "a09acf0234",
      { authorized: true, name: "Branch gateway" },
    );
    await adapter.deleteMember("8056c2e21c000001", "a09acf0234");

    assert.equal(status.platform, "ZeroTier Legacy Central");
    assert.equal(networks[0].name, "Legacy network");
    assert.equal(member.authorized, true);
    assert.equal(member.id, "a09acf0234");
    assert.equal(member.version, "1.16.2");
    assert.ok(
      calls.every(
        ({ init }) =>
          (init.headers as Record<string, string>).authorization ===
          "token legacy-token",
      ),
    );
    assert.ok(calls.every(({ init }) => init.redirect === "error"));
    assert.ok(
      calls.some(
        ({ url, init }) =>
          init.method === "POST" &&
          url.endsWith("/api/v1/network/8056c2e21c000001/member/a09acf0234"),
      ),
    );
    assert.ok(
      calls.some(
        ({ url, init }) =>
          init.method === "DELETE" &&
          url.endsWith("/api/v1/network/8056c2e21c000001/member/a09acf0234"),
      ),
    );
  });
});

describe("New Central adapter", () => {
  it("scopes networks to a group and handles member authorization and flow rules", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: Fetcher = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      const path = new URL(String(url)).pathname;
      const method = init.method || "GET";
      if (path === "/api/v2/org/org-1")
        return json({ organization: { id: "org-1", name: "Operations" } });
      if (path === "/api/v2/org/org-1/network-group") {
        if (method === "POST") return json({ networkGroup: { id: "group-2" } });
        return json({
          networkGroups: [
            { id: "group-1", name: "Production", description: "Live" },
          ],
        });
      }
      if (path === "/api/v2/network-group/group-2")
        return json({
          networkGroup: {
            id: "group-2",
            name: "Development",
            description: "Non-production",
          },
        });
      if (path === "/api/v2/network-group/group-1")
        return json({
          networkGroup: {
            id: "group-1",
            name: "Production sites",
            description: "Live",
          },
        });
      if (path === "/api/v2/network-group/group-1/network") {
        if (method === "POST")
          return json({ network: { id: "8056c2e21c000002" } });
        return json({
          networks: [
            {
              id: "8056c2e21c000002",
              config: { name: "New Central network", private: true },
            },
          ],
        });
      }
      if (path === "/api/v2/network/8056c2e21c000002")
        return json({
          network: {
            id: "8056c2e21c000002",
            config: { name: "New Central network", private: true },
          },
        });
      if (path.endsWith("/authorize")) return json({});
      if (path.endsWith("/member/a09acf0234"))
        return json({
          member: {
            deviceId: "a09acf0234",
            name: "Site router",
            config: { authorized: true },
          },
        });
      if (path.endsWith("/flow-rule")) return json({});
      throw new Error(`Unexpected request: ${method} ${path}`);
    };
    const adapter = new CentralAdapter(
      record("central_v2", {
        organizationId: "org-1",
        networkGroupId: "group-1",
      }),
      { apiToken: "service-account-token" },
      fetcher,
    );

    const status = await adapter.getStatus();
    const groups = await adapter.listNetworkGroups();
    const createdGroup = await adapter.createNetworkGroup({
      name: "Development",
      description: "Non-production",
    });
    const updatedGroup = await adapter.updateNetworkGroup("group-1", {
      name: "Production sites",
    });
    const networks = await adapter.listNetworks();
    const created = await adapter.createNetwork({ name: "New network" });
    const member = await adapter.updateMember(
      "8056c2e21c000002",
      "a09acf0234",
      { authorized: true, name: "Site router" },
    );
    await adapter.updateFlowRules("8056c2e21c000002", "accept;", {
      rules: [{ type: "ACTION_ACCEPT" }],
    });
    await adapter.deleteNetworkGroup("group-2");

    assert.equal(status.address, "org-1");
    assert.equal(groups[0].name, "Production");
    assert.equal(createdGroup.id, "group-2");
    assert.equal(updatedGroup.name, "Production sites");
    assert.equal(networks[0].name, "New Central network");
    assert.equal(created.id, "8056c2e21c000002");
    assert.equal(member.id, "a09acf0234");
    assert.ok(
      calls.every(
        ({ init }) =>
          (init.headers as Record<string, string>).authorization ===
          "Bearer service-account-token",
      ),
    );
    assert.ok(calls.every(({ init }) => init.redirect === "error"));
    assert.ok(
      calls.some(
        ({ url, init }) =>
          init.method === "POST" &&
          url.endsWith("/api/v2/network-group/group-1/network"),
      ),
    );
    assert.ok(
      calls.some(
        ({ url, init }) =>
          init.method === "DELETE" &&
          url.endsWith("/api/v2/network-group/group-2"),
      ),
    );
    assert.ok(
      calls.some(
        ({ url, init }) =>
          init.method === "POST" &&
          url.endsWith(
            "/api/v2/network/8056c2e21c000002/member/a09acf0234/authorize",
          ),
      ),
    );
    assert.ok(
      calls.some(
        ({ url, init }) =>
          init.method === "POST" &&
          url.endsWith("/api/v2beta/network/8056c2e21c000002/flow-rule"),
      ),
    );
  });
});
