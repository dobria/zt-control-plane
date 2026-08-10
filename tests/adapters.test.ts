import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import { MikroTikAdapter } from "@/lib/adapters/mikrotik";
import { ZeroTierAdapter } from "@/lib/adapters/zerotier";
import type { Fetcher } from "@/lib/adapters/types";
import type { ControllerRecord } from "@/lib/types";
import {
  MAX_ADAPTER_RESPONSE_BYTES,
  parseAdapterResponse,
} from "@/lib/adapters/http";
import { AdapterError } from "@/lib/adapters/types";

function record(type: "zerotier" | "mikrotik"): ControllerRecord {
  return {
    id: "test",
    type,
    name: "Test",
    baseUrl: "https://controller.example",
    encryptedCredentials: null,
    configuration: {},
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

describe("adapter HTTP boundary", () => {
  it("rejects declared oversized responses before parsing them", async () => {
    const response = new Response("{}", {
      headers: {
        "content-type": "application/json",
        "content-length": String(MAX_ADAPTER_RESPONSE_BYTES + 1),
      },
    });
    await assert.rejects(
      () => parseAdapterResponse(response, "Test API"),
      (error: unknown) =>
        error instanceof AdapterError && /larger than/.test(error.message),
    );
  });

  it("rejects malformed JSON from a provider", async () => {
    const response = new Response("{not-json", {
      headers: { "content-type": "application/json" },
    });
    await assert.rejects(
      () => parseAdapterResponse(response, "Test API"),
      (error: unknown) =>
        error instanceof AdapterError && /invalid JSON/.test(error.message),
    );
  });

  it("stops streamed responses that omit a truthful content length", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(MAX_ADAPTER_RESPONSE_BYTES / 2));
          controller.enqueue(
            new Uint8Array(MAX_ADAPTER_RESPONSE_BYTES / 2 + 1),
          );
          controller.close();
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
    await assert.rejects(
      () => parseAdapterResponse(response, "Test API"),
      (error: unknown) =>
        error instanceof AdapterError && /larger than/.test(error.message),
    );
  });
});

describe("ZeroTier One Service API adapter", () => {
  it("uses a dispatcher compatible with its real HTTP client", async () => {
    const server = createServer((request, response) => {
      assert.equal(request.headers["x-zt1-auth"], "local-token");
      response.writeHead(200, { "content-type": "application/json" });
      if (request.url === "/controller") {
        response.end(
          JSON.stringify({
            controller: true,
            apiVersion: 4,
            databaseReady: true,
          }),
        );
      } else {
        assert.equal(request.url, "/status");
        response.end(
          JSON.stringify({
            online: true,
            address: "a09acf0234",
            version: "1.16.2",
          }),
        );
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    try {
      const adapter = new ZeroTierAdapter(
        {
          ...record("zerotier"),
          baseUrl: `http://127.0.0.1:${address.port}`,
        },
        { apiToken: "local-token" },
      );
      const status = await adapter.getStatus();
      assert.equal(status.online, true);
      assert.equal(status.address, "a09acf0234");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("creates networks with controller-derived IDs and filters read-only input", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: Fetcher = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/status"))
        return json({ online: true, address: "a09acf0234", version: "1.16.2" });
      if (String(url).endsWith("/controller"))
        return json({ controller: true, apiVersion: 4, databaseReady: true });
      return json({
        id: "a09acf0234abcdef",
        name: "Production",
        private: true,
      });
    };
    const adapter = new ZeroTierAdapter(
      record("zerotier"),
      { apiToken: "token" },
      fetcher,
    );
    const created = await adapter.createNetwork({
      name: "Production",
      raw: { revision: 99 },
    });
    assert.equal(created.id.slice(0, 10), "a09acf0234");
    const mutation = calls.find((call) => call.init.method === "POST")!;
    assert.equal(mutation.init.redirect, "error");
    assert.match(mutation.url, /\/controller\/network\/a09acf0234[0-9a-f]{6}$/);
    assert.equal(
      (mutation.init.headers as Record<string, string>)["X-ZT1-Auth"],
      "token",
    );
    assert.equal("raw" in JSON.parse(String(mutation.init.body)), false);
  });

  it("uses the documented member and client CRUD endpoints", async () => {
    const calls: string[] = [];
    const fetcher: Fetcher = async (url, init = {}) => {
      calls.push(`${init.method || "GET"} ${String(url)}`);
      if ((init.method || "GET") === "GET" && String(url).endsWith("/network"))
        return json([{ id: "a09acf0234abcdef", status: "OK" }]);
      return json({
        id: String(url).includes("/member/")
          ? "abcdef0123"
          : "a09acf0234abcdef",
        authorized: true,
        status: "OK",
      });
    };
    const adapter = new ZeroTierAdapter(
      record("zerotier"),
      { apiToken: "token" },
      fetcher,
    );
    await adapter.updateMember("a09acf0234abcdef", "abcdef0123", {
      authorized: true,
    });
    await adapter.deleteMember("a09acf0234abcdef", "abcdef0123");
    await adapter.joinClientNetwork("a09acf0234abcdef", {
      allowDefault: true,
      allowDNS: true,
    });
    await adapter.leaveClientNetwork("a09acf0234abcdef");
    assert.ok(
      calls.some(
        (call) =>
          call.startsWith("POST ") &&
          call.includes(
            "/controller/network/a09acf0234abcdef/member/abcdef0123",
          ),
      ),
    );
    assert.ok(
      calls.some(
        (call) =>
          call.startsWith("DELETE ") &&
          call.includes(
            "/controller/network/a09acf0234abcdef/member/abcdef0123",
          ),
      ),
    );
    assert.ok(
      calls.some(
        (call) =>
          call.startsWith("POST ") &&
          call.endsWith("/network/a09acf0234abcdef"),
      ),
    );
    assert.ok(
      calls.some(
        (call) =>
          call.startsWith("DELETE ") &&
          call.endsWith("/network/a09acf0234abcdef"),
      ),
    );
    const clientMutation = calls.find(
      (call) =>
        call.startsWith("POST ") && call.endsWith("/network/a09acf0234abcdef"),
    );
    assert.ok(clientMutation);
  });

  it("lists, orbits and deorbits federated moon roots", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: Fetcher = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/peer"))
        return json([
          {
            address: "778cde7190",
            role: "PLANET",
            latency: 42,
            version: "-1.-1.-1",
            paths: [
              {
                active: true,
                preferred: true,
                expired: false,
                address: "203.0.113.10/9993",
                lastReceive: 1_700_000_000_000,
                lastSend: 1_700_000_000_100,
              },
            ],
          },
        ]);
      if ((init.method || "GET") === "GET")
        return json([{ id: "abcdef0123", waiting: false, roots: [] }]);
      return json({ id: "abcdef0123", waiting: true, roots: [] });
    };
    const adapter = new ZeroTierAdapter(
      record("zerotier"),
      { apiToken: "token" },
      fetcher,
    );
    const moons = await adapter.listMoons();
    const peers = await adapter.listPeers();
    const orbiting = await adapter.orbitMoon("abcdef0123", "0123456789");
    await adapter.deorbitMoon("abcdef0123");
    assert.equal(moons[0].id, "abcdef0123");
    assert.equal(peers[0].address, "778cde7190");
    assert.equal(peers[0].role, "PLANET");
    assert.equal(peers[0].version, null);
    assert.equal(peers[0].latency, 42);
    assert.equal(peers[0].paths[0].address, "203.0.113.10/9993");
    assert.equal(peers[0].paths[0].preferred, true);
    assert.equal(orbiting.waiting, true);
    const orbit = calls.find((call) => call.init.method === "POST");
    assert.deepEqual(JSON.parse(String(orbit?.init.body)), {
      seed: "0123456789",
    });
    assert.ok(
      calls.some(
        (call) =>
          call.init.method === "DELETE" &&
          call.url.endsWith("/moon/abcdef0123"),
      ),
    );
  });

  it("sends every supported client-side network policy", async () => {
    let submitted: Record<string, unknown> = {};
    const fetcher: Fetcher = async (_url, init = {}) => {
      if ((init.method || "GET") === "POST") {
        submitted = JSON.parse(String(init.body));
        return json({});
      }
      return json([{ id: "a09acf0234abcdef", status: "OK" }]);
    };
    const adapter = new ZeroTierAdapter(
      record("zerotier"),
      { apiToken: "token" },
      fetcher,
    );
    await adapter.joinClientNetwork("a09acf0234abcdef", {
      allowManaged: false,
      allowDefault: true,
      allowGlobal: true,
      allowDNS: true,
    });
    assert.deepEqual(submitted, {
      allowManaged: false,
      allowDefault: true,
      allowGlobal: true,
      allowDNS: true,
    });
  });

  it("rejects an acknowledged join that never appears on the node", async () => {
    const fetcher: Fetcher = async (_url, init = {}) =>
      (init.method || "GET") === "POST" ? json({}) : json([]);
    const adapter = new ZeroTierAdapter(
      record("zerotier"),
      { apiToken: "token" },
      fetcher,
    );
    await assert.rejects(
      () => adapter.joinClientNetwork("a09acf0234abcdef"),
      (error: unknown) =>
        error instanceof AdapterError &&
        error.status === 502 &&
        /dev\/net\/tun/.test(error.message) &&
        /NET_ADMIN/.test(error.message),
    );
  });
});

describe("MikroTik RouterOS REST adapter", () => {
  it("normalizes the object-shaped resource status returned by current RouterOS", async () => {
    const fetcher: Fetcher = async (url) => {
      if (String(url).endsWith("/rest/system/resource"))
        return json({
          version: "7.23.3 (stable)",
          "architecture-name": "arm64",
        });
      return json([
        {
          ".id": "*1",
          name: "zt1",
          state: "running",
          online: "true",
          identity: "f00dbabe01:0:private-secret-material",
          "identity.public": "f00dbabe01:public-key",
        },
      ]);
    };
    const adapter = new MikroTikAdapter(
      record("mikrotik"),
      { username: "admin", password: "secret" },
      fetcher,
    );

    const status = await adapter.getStatus();
    assert.equal(status.version, "7.23.3 (stable)");
    assert.equal(status.platform, "MikroTik RouterOS arm64");
    assert.equal(status.address, "f00dbabe01");
    assert.equal(
      JSON.stringify(status).includes("private-secret-material"),
      false,
    );
  });

  it("lists and manages multiple arbitrarily named ZeroTier instances", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const rows = [
      {
        ".id": "*1",
        name: "zt1",
        comment: "Default",
        port: "9993",
        interfaces: "all",
        "route-distance": "1",
        disabled: "false",
        online: "true",
        state: "running",
        identity: "f00dbabe01:0:private-secret",
        "identity.public": "f00dbabe01:0:public-key",
      },
      {
        ".id": "*a",
        name: "edge-west",
        comment: "Secondary instance",
        port: "10001",
        interfaces: "bridge,ether1",
        "route-distance": "5",
        disabled: "false",
        state: "running",
        identity: "abcdef0123:0:another-private-secret",
        "identity.public": "abcdef0123:0:another-public-key",
        moons: "778cde7190,cafe04eba9",
      },
    ];
    const fetcher: Fetcher = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/rest/interface"))
        return json([
          { name: "ether10" },
          { name: "bridge" },
          { name: "ether1" },
          { name: "bridge" },
        ]);
      if (init.method === "PUT") return json({ ret: "*a" });
      if (init.method === "PATCH")
        return json({ name: "edge-west", state: "running" });
      if (init.method === "DELETE") return json({});
      return json(rows);
    };
    const adapter = new MikroTikAdapter(
      record("mikrotik"),
      { username: "admin", password: "secret" },
      fetcher,
    );

    const listed = await adapter.listInstances();
    assert.deepEqual(
      listed.map((instance) => instance.name),
      ["zt1", "edge-west"],
    );
    assert.equal(listed[1].address, "abcdef0123");
    assert.equal(listed[1].online, true);
    assert.deepEqual(listed[1].interfaces, ["bridge", "ether1"]);
    assert.deepEqual(listed[1].moons, ["778cde7190", "cafe04eba9"]);
    assert.equal(JSON.stringify(listed).includes("private-secret"), false);
    assert.deepEqual(await adapter.listHostInterfaces(), [
      "bridge",
      "ether1",
      "ether10",
    ]);

    await adapter.createInstance({
      name: "edge-west",
      comment: "Secondary instance",
      port: 10001,
      interfaces: ["bridge", "ether1"],
      routeDistance: 5,
      enabled: true,
    });
    await adapter.updateInstance("*a", {
      name: "edge-west",
      comment: "Updated",
      port: 10001,
      interfaces: ["bridge"],
      routeDistance: 5,
      enabled: false,
    });
    await adapter.deleteInstance("*a");

    const create = calls.find((call) => call.init.method === "PUT");
    assert.deepEqual(JSON.parse(String(create?.init.body)), {
      name: "edge-west",
      comment: "Secondary instance",
      port: 10001,
      interfaces: "bridge,ether1",
      "route-distance": 5,
      disabled: "no",
    });
    const update = calls.find((call) => call.init.method === "PATCH");
    assert.ok(update?.url.endsWith("/rest/zerotier/*a"));
    assert.equal(JSON.parse(String(update?.init.body)).disabled, "yes");
    assert.ok(
      calls.some(
        (call) =>
          call.init.method === "DELETE" &&
          call.url.endsWith("/rest/zerotier/*a"),
      ),
    );
  });

  it("keeps controller networks, client interfaces and peers instance-scoped", async () => {
    const fetcher: Fetcher = async (url) => {
      const path = String(url);
      if (path.endsWith("/rest/zerotier/controller"))
        return json([
          {
            ".id": "*2",
            instance: "edge-west",
            network: "a09acf0234abcdef",
            name: "West network",
            private: "yes",
          },
        ]);
      if (path.endsWith("/rest/zerotier/interface"))
        return json([
          {
            ".id": "*3",
            instance: "edge-west",
            network: "a09acf0234abcdef",
            name: "west-client",
            status: "OK",
          },
        ]);
      return json([
        {
          instance: "edge-west",
          "zt-address": "778cde7190",
          latency: "139ms",
          role: "PLANET",
          path: "active,preferred,103.195.103.66/9993,recvd:1s",
        },
      ]);
    };
    const adapter = new MikroTikAdapter(
      record("mikrotik"),
      { username: "admin", password: "secret" },
      fetcher,
    );

    const [networks, interfaces, peers] = await Promise.all([
      adapter.listNetworks(),
      adapter.listClientNetworks(),
      adapter.listPeers(),
    ]);
    assert.equal(networks[0].instance, "edge-west");
    assert.equal(interfaces[0].instance, "edge-west");
    assert.equal(peers[0].instance, "edge-west");
    assert.equal(peers[0].latency, 139);
    assert.equal(peers[0].paths[0].address, "103.195.103.66/9993");
    assert.equal(peers[0].paths[0].preferred, true);
  });

  it("normalizes full controller settings and follows RouterOS creation references", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const controllerRow = {
      ".id": "*3",
      network: "a09acf0234abcdef",
      instance: "zt1",
      name: "Branch",
      comment: "Warehouse overlay",
      private: "yes",
      disabled: "no",
      broadcast: "yes",
      mtu: "2800",
      "multicast-limit": "64",
      "ip-range": "10.55.0.1-10.55.0.254",
      routes: "10.55.0.0/24,10.80.0.0/16@10.55.0.10",
      "ip6-rfc4193": "yes",
      "ip6-6plane": "no",
    };
    const fetcher: Fetcher = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (init.method === "PUT") return json({ ret: "*3" });
      if (String(url).endsWith("/rest/zerotier"))
        return json([
          { name: "branch-zt", state: "running", disabled: "false" },
        ]);
      if (String(url).endsWith("/rest/zerotier/controller"))
        return json([controllerRow]);
      if (String(url).endsWith("/rest/zerotier/controller/member"))
        return json([]);
      return json({});
    };
    const adapter = new MikroTikAdapter(
      record("mikrotik"),
      { username: "admin", password: "secret" },
      fetcher,
    );
    const created = await adapter.createNetwork({
      name: "Branch",
      comment: "Warehouse overlay",
      private: true,
      disabled: false,
      enableBroadcast: true,
      mtu: 2800,
      multicastLimit: 64,
      ipAssignmentPools: [
        { ipRangeStart: "10.55.0.1", ipRangeEnd: "10.55.0.254" },
      ],
      routes: [{ target: "10.80.0.0/16", via: "10.55.0.10" }],
      v6AssignMode: { rfc4193: true, "6plane": false },
    });
    assert.equal(created.id, "a09acf0234abcdef");
    assert.equal(created.mtu, 2800);
    assert.equal(created.comment, "Warehouse overlay");
    assert.equal(created.disabled, false);
    assert.equal(created.multicastLimit, 64);
    assert.deepEqual(created.routes?.[1], {
      target: "10.80.0.0/16",
      via: "10.55.0.10",
    });
    const mutation = calls.find((call) => call.init.method === "PUT")!;
    const body = JSON.parse(String(mutation.init.body));
    assert.equal(body.instance, "branch-zt");
    assert.equal(body.comment, "Warehouse overlay");
    assert.equal(body.disabled, "no");
    assert.equal(body.routes, "10.80.0.0/16@10.55.0.10");
    assert.equal(body["ip6-rfc4193"], "yes");
    assert.match(
      String((mutation.init.headers as Record<string, string>).authorization),
      /^Basic /,
    );
    assert.equal(mutation.init.redirect, "error");
  });

  it("manages controller members by RouterOS network name and record ID", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: Fetcher = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (
        String(url).endsWith("/rest/zerotier/controller/member") &&
        init.method === "PUT"
      )
        return json({
          ".id": "*8",
          network: "RoSTest",
          "zt-address": "1234567890",
          name: "New member",
          authorized: "yes",
        });
      if (String(url).endsWith("/rest/zerotier/controller/member"))
        return json([
          {
            ".id": "*7",
            network: "RoSTest",
            "zt-address": "abcdef0123",
            name: "Branch router",
            comment: "Warehouse",
            authorized: "no",
            disabled: "false",
            bridge: "yes",
            "ip-address": "10.20.30.40",
            "last-seen": "3s348ms",
          },
        ]);
      if (String(url).endsWith("/rest/zerotier/controller"))
        return json([
          {
            ".id": "*3",
            instance: "zt1",
            name: "RoSTest",
            network: "a09acf0234abcdef",
            private: "yes",
          },
        ]);
      if (String(url).endsWith("/rest/zerotier/interface"))
        return json([
          {
            ".id": "*9",
            network: "a09acf0234abcdef",
            name: "zt-branch",
            status: "OK",
          },
        ]);
      return json({
        authorized: "yes",
        name: "Branch router updated",
        comment: "Updated warehouse",
        bridge: "no",
        disabled: "yes",
        "ip-address": "10.20.30.41",
      });
    };
    const adapter = new MikroTikAdapter(
      record("mikrotik"),
      { username: "admin", password: "secret" },
      fetcher,
    );
    const listed = await adapter.listMembers("a09acf0234abcdef");
    const created = await adapter.createMember(
      "a09acf0234abcdef",
      "1234567890",
      {
        name: "New member",
        authorized: true,
        activeBridge: false,
        disabled: false,
        ipAssignments: ["10.20.30.50"],
      },
    );
    const updated = await adapter.updateMember(
      "a09acf0234abcdef",
      "abcdef0123",
      {
        name: "Branch router updated",
        comment: "Updated warehouse",
        authorized: true,
        activeBridge: false,
        disabled: true,
        ipAssignments: ["10.20.30.41"],
      },
    );
    await adapter.leaveClientNetwork("a09acf0234abcdef");

    assert.equal(listed[0].name, "Branch router");
    assert.equal(listed[0].comment, "Warehouse");
    assert.equal(listed[0].activeBridge, true);
    assert.equal(listed[0].lastSeen, "3s348ms");
    assert.deepEqual(listed[0].ipAssignments, ["10.20.30.40"]);
    assert.equal(created.id, "1234567890");
    assert.equal(updated.disabled, true);
    const createCall = calls.find(
      (call) =>
        call.init.method === "PUT" &&
        call.url.endsWith("/rest/zerotier/controller/member"),
    );
    assert.deepEqual(JSON.parse(String(createCall?.init.body)), {
      network: "RoSTest",
      "zt-address": "1234567890",
      name: "New member",
      authorized: "yes",
      disabled: "no",
      bridge: "no",
      "ip-address": "10.20.30.50",
    });
    const updateCall = calls.find((call) => call.init.method === "PATCH");
    assert.ok(updateCall?.url.endsWith("/rest/zerotier/controller/member/*7"));
    assert.deepEqual(JSON.parse(String(updateCall?.init.body)), {
      name: "Branch router updated",
      comment: "Updated warehouse",
      authorized: "yes",
      disabled: "yes",
      bridge: "no",
      "ip-address": "10.20.30.41",
    });
    assert.ok(
      calls.some(
        (call) =>
          call.init.method === "DELETE" &&
          call.url.endsWith("/rest/zerotier/interface/*9"),
      ),
    );
  });

  it("rejects unsupported RouterOS member fields instead of silently dropping them", async () => {
    const adapter = new MikroTikAdapter(
      record("mikrotik"),
      { username: "admin", password: "secret" },
      async () => json([]),
    );
    await assert.rejects(
      () =>
        adapter.updateMember("a09acf0234abcdef", "abcdef0123", {
          authorized: true,
          ssoExempt: true,
        }),
      /does not support these member fields: ssoExempt/,
    );
  });

  it("lists, joins and edits RouterOS client interfaces", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const interfaceRow = {
      ".id": "*9",
      instance: "zt1",
      network: "a09acf0234abcdef",
      name: "zt-branch",
      comment: "Branch overlay",
      disabled: "no",
      running: "yes",
      type: "ZeroTier",
      status: "OK",
      mtu: "2800",
      "actual-mtu": "2800",
      vrf: "main",
      "arp-timeout": "auto",
      "disable-running-check": "no",
      "mac-address": "aa:bb:cc:dd:ee:ff",
      "allow-managed": "yes",
      "allow-default": "no",
      "allow-global": "no",
    };
    const fetcher: Fetcher = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (init.method === "PUT") return json({ ret: "*9" });
      if (init.method === "PATCH")
        return json({ name: "zt-office", "allow-default": "yes" });
      if (init.method === "DELETE") return json({});
      if (String(url).endsWith("/rest/ip/vrf"))
        return json([{ name: "tenant-blue" }, { name: "main" }]);
      if (String(url).endsWith("/rest/zerotier"))
        return json([{ name: "zt1", state: "running", disabled: "false" }]);
      return json([interfaceRow]);
    };
    const adapter = new MikroTikAdapter(
      record("mikrotik"),
      { username: "admin", password: "secret" },
      fetcher,
    );

    const listed = await adapter.listClientNetworks();
    const joined = await adapter.joinClientNetwork("a09acf0234abcdef", {
      name: "zt-branch",
      allowManaged: true,
      allowDefault: false,
      allowGlobal: false,
    });
    const updated = await adapter.updateClientNetwork("a09acf0234abcdef", {
      name: "zt-office",
      comment: "Office overlay",
      disabled: true,
      vrf: "tenant-blue",
      arpTimeout: "30s",
      disableRunningCheck: true,
      allowDefault: true,
    });
    const vrfs = await adapter.listVrfs();

    assert.equal(listed[0].status, "OK");
    assert.equal(listed[0].instance, "zt1");
    assert.equal(listed[0].mac, "aa:bb:cc:dd:ee:ff");
    assert.equal(listed[0].comment, "Branch overlay");
    assert.equal(listed[0].disabled, false);
    assert.equal(listed[0].running, true);
    assert.equal(listed[0].mtu, 2800);
    assert.equal(listed[0].actualMtu, 2800);
    assert.equal(listed[0].vrf, "main");
    assert.equal(listed[0].arpTimeout, "auto");
    assert.deepEqual(vrfs, ["main", "tenant-blue"]);
    assert.equal(joined.id, "a09acf0234abcdef");
    assert.equal(updated.name, "zt-office");
    const joinCall = calls.find((call) => call.init.method === "PUT");
    assert.deepEqual(JSON.parse(String(joinCall?.init.body)), {
      network: "a09acf0234abcdef",
      name: "zt-branch",
      instance: "zt1",
      "allow-managed": "yes",
      "allow-default": "no",
      "allow-global": "no",
    });
    assert.ok(
      calls.some(
        (call) =>
          call.init.method === "PATCH" &&
          call.url.endsWith("/rest/zerotier/interface/*9"),
      ),
    );
    const updateCall = calls.find((call) => call.init.method === "PATCH");
    assert.deepEqual(JSON.parse(String(updateCall?.init.body)), {
      name: "zt-office",
      comment: "Office overlay",
      disabled: "yes",
      vrf: "tenant-blue",
      "arp-timeout": "30s",
      "disable-running-check": "yes",
      "allow-default": "yes",
    });
  });

  it("surfaces RouterOS error details instead of a generic Bad Request", async () => {
    const adapter = new MikroTikAdapter(
      record("mikrotik"),
      { username: "admin", password: "secret" },
      async () =>
        json(
          {
            error: 400,
            message: "Bad Request",
            detail: "input does not match any value of instance",
          },
          400,
        ),
    );
    await assert.rejects(
      () => adapter.createNetwork({ name: "Branch" }),
      /RouterOS: input does not match any value of instance/,
    );
  });
});
