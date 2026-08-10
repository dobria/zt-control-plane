import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasPermission, permissionsFor } from "@/lib/rbac";
import { networkTab } from "@/lib/network-tabs";
import {
  baseUrl,
  controllerType,
  email,
  managedNodeType,
  memberId,
  moonId,
  networkId,
  routerOsRecordId,
  role,
  ValidationError,
  jsonBody,
} from "@/lib/validation";
import {
  clientNetworkPayload,
  flowPolicyPayload,
  memberPayload,
  networkPayload,
} from "@/lib/payloads";
import { routerOsInstancePayload } from "@/lib/routeros-instance";

describe("input validation", () => {
  it("accepts supported external controller types only", () => {
    assert.equal(controllerType("zerotier"), "zerotier");
    assert.equal(controllerType("mikrotik"), "mikrotik");
    assert.equal(controllerType("central_v2"), "central_v2");
    assert.equal(controllerType("central_v1"), "central_v1");
    assert.throws(() => controllerType("embedded"), ValidationError);
    assert.equal(managedNodeType("zerotier"), "zerotier");
    assert.equal(managedNodeType("mikrotik"), "mikrotik");
    assert.throws(() => managedNodeType("local"), ValidationError);
  });

  it("normalizes URLs, identities and email addresses", () => {
    assert.equal(
      baseUrl("https://router.example/rest/"),
      "https://router.example/rest",
    );
    assert.equal(networkId("A09ACFE1B2C3D4E5"), "a09acfe1b2c3d4e5");
    assert.equal(memberId("ABCDEF0123"), "abcdef0123");
    assert.equal(moonId("ABCDEF0123"), "abcdef0123");
    assert.equal(routerOsRecordId("*A1"), "*A1");
    assert.equal(email(" Admin@Example.COM "), "admin@example.com");
  });

  it("rejects invalid protocols, identifiers and roles", () => {
    assert.throws(() => baseUrl("file:///etc/passwd"), ValidationError);
    assert.throws(
      () => baseUrl("https://user:pass@example.com"),
      ValidationError,
    );
    assert.throws(() => networkId("1234"), ValidationError);
    assert.throws(() => memberId("not-a-node"), ValidationError);
    assert.throws(() => moonId("1234"), ValidationError);
    assert.throws(() => routerOsRecordId("zt1"), ValidationError);
    assert.throws(() => role("owner"), ValidationError);
  });

  it("blocks cloud metadata and link-local endpoints while allowing private controllers", () => {
    assert.equal(
      baseUrl("http://controller.internal:9993"),
      "http://controller.internal:9993",
    );
    assert.equal(baseUrl("http://10.147.20.5:9993"), "http://10.147.20.5:9993");
    assert.equal(
      baseUrl("https://192.168.88.1/rest"),
      "https://192.168.88.1/rest",
    );
    assert.equal(
      baseUrl("http://[fd00:1234::5]:9993"),
      "http://[fd00:1234::5]:9993",
    );
    assert.throws(() => baseUrl("http://169.254.169.254"), ValidationError);
    assert.throws(
      () => baseUrl("http://metadata.google.internal"),
      ValidationError,
    );
    assert.throws(() => baseUrl("http://[fe80::1]"), ValidationError);
  });

  it("enforces the streamed JSON size even when Content-Length lies", async () => {
    const request = new Request("http://localhost/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "2",
      },
      body: JSON.stringify({ value: "x".repeat(512) }),
    });
    await assert.rejects(() => jsonBody(request, 64), ValidationError);
  });

  it("accepts JSON objects and rejects arrays", async () => {
    assert.deepEqual(
      await jsonBody(
        new Request("http://localhost/test", {
          method: "POST",
          body: JSON.stringify({ enabled: true }),
        }),
      ),
      { enabled: true },
    );
    await assert.rejects(
      () =>
        jsonBody(
          new Request("http://localhost/test", {
            method: "POST",
            body: "[]",
          }),
        ),
      ValidationError,
    );
  });

  it("builds allowlisted controller payloads and rejects invalid field types", () => {
    assert.deepEqual(
      networkPayload({
        name: " Lab ",
        comment: " RouterOS network ",
        private: true,
        disabled: false,
        ignoredReadOnlyField: "discarded",
        dns: { domain: "lab.example", servers: ["10.0.0.53"] },
        routes: [{ target: "10.80.0.0/16", via: "10.0.0.10" }],
        remoteTraceLevel: 0,
      }),
      {
        name: "Lab",
        comment: "RouterOS network",
        private: true,
        disabled: false,
        dns: { domain: "lab.example", servers: ["10.0.0.53"] },
        routes: [{ target: "10.80.0.0/16", via: "10.0.0.10" }],
        remoteTraceLevel: 0,
      },
    );
    assert.deepEqual(
      memberPayload({
        name: " Branch router ",
        comment: " Warehouse ",
        authorized: true,
        disabled: false,
        activeBridge: true,
        ipAssignments: ["10.20.30.40"],
      }),
      {
        name: "Branch router",
        comment: "Warehouse",
        authorized: true,
        disabled: false,
        activeBridge: true,
        ipAssignments: ["10.20.30.40"],
      },
    );
    assert.deepEqual(clientNetworkPayload({ allowDNS: false }), {
      allowDNS: false,
    });
    assert.deepEqual(
      clientNetworkPayload({
        comment: " Branch overlay ",
        enabled: false,
        vrf: "tenant-blue",
        arpTimeout: "30s",
        disableRunningCheck: true,
      }),
      {
        comment: "Branch overlay",
        disabled: true,
        vrf: "tenant-blue",
        arpTimeout: "30s",
        disableRunningCheck: true,
      },
    );
    assert.throws(
      () => networkPayload({ enableBroadcast: "yes" }),
      ValidationError,
    );
    assert.throws(
      () => networkPayload({ remoteTraceLevel: "0" }),
      /Remote trace level must be a number/,
    );
    assert.throws(
      () => clientNetworkPayload({ allowManaged: 1 }),
      ValidationError,
    );
    assert.throws(
      () => clientNetworkPayload({ arpTimeout: "whenever" }),
      ValidationError,
    );
    assert.deepEqual(
      networkPayload({
        rules: [{ type: "ACTION_ACCEPT" }],
        capabilities: [{ id: 1, default: true, rules: [] }],
        tags: [{ id: 2, default: null }],
      }),
      {
        rules: [{ type: "ACTION_ACCEPT" }],
        capabilities: [{ id: 1, default: true, rules: [] }],
        tags: [{ id: 2, default: null }],
      },
    );
    assert.throws(
      () => networkPayload({ capabilities: [{ rules: [] }] }),
      ValidationError,
    );
    assert.throws(
      () => networkPayload({ tags: [{ id: 1, default: "root" }] }),
      ValidationError,
    );
    assert.throws(
      () => networkPayload({ rules: ["accept everything"] }),
      ValidationError,
    );
    assert.deepEqual(
      flowPolicyPayload({
        layer2Only: true,
        restrict: true,
        services: ["dns", "ssh"],
        exemptMembers: ["abcdef0123"],
        custom: [{ name: "Admin", protocol: "tcp", port: "8443" }],
      }),
      {
        layer2Only: true,
        restrict: true,
        services: ["dns", "ssh"],
        exemptMembers: ["abcdef0123"],
        custom: [{ name: "Admin", protocol: "tcp", port: "8443" }],
      },
    );
    assert.throws(
      () =>
        flowPolicyPayload({
          layer2Only: false,
          restrict: true,
          services: [],
          exemptMembers: [],
          custom: [{ name: "Bad", protocol: "tcp", port: "70000" }],
        }),
      ValidationError,
    );
  });

  it("validates RouterOS ZeroTier instance configuration", () => {
    assert.deepEqual(
      routerOsInstancePayload({
        name: " edge-west ",
        comment: "Secondary",
        port: 10001,
        interfaces: ["bridge", "ether1"],
        routeDistance: 5,
        enabled: false,
      }),
      {
        name: "edge-west",
        comment: "Secondary",
        port: 10001,
        interfaces: ["bridge", "ether1"],
        routeDistance: 5,
        enabled: false,
      },
    );
    assert.throws(
      () => routerOsInstancePayload({ name: "zt2", port: 70000 }),
      ValidationError,
    );
    assert.throws(
      () => routerOsInstancePayload({ name: "zt2", interfaces: "all" }),
      ValidationError,
    );
    assert.throws(
      () => routerOsInstancePayload({ name: "zt2", interfaces: [] }),
      ValidationError,
    );
  });
});

describe("role-based access control", () => {
  it("keeps controller and user administration limited to administrators", () => {
    assert.equal(hasPermission("admin", "controllers:write"), true);
    assert.equal(hasPermission("operator", "controllers:write"), false);
    assert.equal(hasPermission("admin", "users:write"), true);
    assert.equal(hasPermission("operator", "users:write"), false);
  });

  it("allows operators to mutate networks and clients but keeps viewers read-only", () => {
    assert.equal(hasPermission("operator", "networks:write"), true);
    assert.equal(hasPermission("operator", "devices:write"), true);
    assert.equal(hasPermission("viewer", "networks:write"), false);
    assert.equal(permissionsFor("auditor").canViewAudit, true);
    assert.equal(permissionsFor("viewer").canViewAudit, false);
    assert.equal(permissionsFor("admin").canExportAudit, true);
    assert.equal(permissionsFor("auditor").canExportAudit, false);
  });
});

describe("network detail navigation", () => {
  it("keeps supported tabs in the URL and safely falls back to members", () => {
    assert.equal(networkTab("rules"), "rules");
    assert.equal(networkTab(["routes"]), "routes");
    assert.equal(networkTab("unknown"), "members");
    assert.equal(networkTab(undefined), "members");
  });
});
