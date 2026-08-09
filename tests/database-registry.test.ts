import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import {
  closeDatabaseForTests,
  db,
  publicUser,
  queryOne,
  type UserRow,
} from "@/lib/database";
import {
  assertAdminContinuity,
  revokeUserSessions,
} from "@/lib/user-management";
import { AppError } from "@/lib/errors";
import {
  createController,
  credentialsFor,
  deleteController,
  getActiveControllerId,
  getController,
  listPublicControllers,
} from "@/lib/controller-registry";
import { resetSecretCacheForTests } from "@/lib/secrets";
import { writeAudit } from "@/lib/audit";
import { getAppSettings, saveAppSettings } from "@/lib/settings";
import { getNetworkMetadata, saveNetworkMetadata } from "@/lib/metadata";
import {
  createNode,
  deleteNode,
  getActiveNodeId,
  getNode,
  listPublicNodes,
  nodeCredentialsFor,
  setActiveNode,
} from "@/lib/node-registry";

const databaseFile = path.join(tmpdir(), `ztcp-test-${randomUUID()}.sqlite`);

before(() => {
  process.env.DATABASE_PATH = databaseFile;
  process.env.APP_SECRET = "database-test-secret-that-is-long-enough";
  process.env.EMBEDDED_ZEROTIER = "1";
  resetSecretCacheForTests();
  const legacy = new DatabaseSync(databaseFile);
  legacy.exec(`
    CREATE TABLE controllers (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('embedded','zerotier','mikrotik')),
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      encrypted_credentials TEXT,
      configuration_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      tls_verify INTEGER NOT NULL DEFAULT 1,
      embedded INTEGER NOT NULL DEFAULT 0,
      last_checked_at INTEGER,
      last_online INTEGER,
      last_address TEXT,
      last_version TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO controllers (
      id,type,name,base_url,enabled,tls_verify,embedded,created_at,updated_at
    ) VALUES (
      'pre-migration-remote','zerotier','Pre-migration remote',
      'https://old-node.example:9993',1,1,0,1,1
    );
    UPDATE controllers SET configuration_json='{"preserved":true}'
    WHERE id='pre-migration-remote';
  `);
  legacy.close();
});

after(() => closeDatabaseForTests());

describe("SQLite persistence and controller registry", () => {
  it("creates the embedded controller idempotently", () => {
    assert.equal(
      listPublicControllers().filter((item) => item.embedded).length,
      1,
    );
    assert.equal(
      getController("embedded-local")?.baseUrl,
      "http://127.0.0.1:9993",
    );
    assert.equal(getController("pre-migration-remote")?.type, "zerotier");
    assert.deepEqual(getController("pre-migration-remote")?.configuration, {
      preserved: true,
    });
    assert.equal(
      getNode("node-pre-migration-remote")?.baseUrl,
      "https://old-node.example:9993",
    );
    assert.equal(
      getNode("node-pre-migration-remote")?.controllerId,
      "pre-migration-remote",
    );
    assert.deepEqual(
      db()
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all()
        .map((row) => Number((row as { version: number }).version)),
      [1, 2, 3, 4, 5, 6, 7],
    );
    assert.ok(
      db()
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='restore_mappings'",
        )
        .get(),
    );
    for (const table of [
      "user_mfa",
      "mfa_recovery_codes",
      "mfa_login_challenges",
      "network_inventory",
      "member_inventory",
      "client_network_inventory",
    ])
      assert.ok(
        db()
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          )
          .get(table),
      );
    assert.ok(
      db()
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'",
        )
        .get(),
    );
    const preferenceColumns = new Set(
      db()
        .prepare("PRAGMA table_info(user_preferences)")
        .all()
        .map((row) => String((row as { name: string }).name)),
    );
    assert.equal(preferenceColumns.has("landing_page"), true);
    assert.equal(preferenceColumns.has("reduced_motion"), true);
  });

  it("protects the SQLite database from other local users", () => {
    if (process.platform !== "win32")
      assert.equal(statSync(databaseFile).mode & 0o777, 0o600);
  });

  it("can reopen an already migrated database without duplicating state", () => {
    closeDatabaseForTests();
    assert.equal(
      listPublicControllers().filter((item) => item.id === "embedded-local")
        .length,
      1,
    );
    assert.equal(getController("pre-migration-remote")?.type, "zerotier");
  });

  it("hides preserved embedded records when the embedded runtime is disabled", () => {
    const previousMode = process.env.EMBEDDED_ZEROTIER;
    process.env.EMBEDDED_ZEROTIER = "0";
    try {
      assert.equal(getController("embedded-local"), null);
      assert.equal(getNode("embedded-local-node"), null);
      assert.equal(
        listPublicControllers().some((item) => item.embedded),
        false,
      );
      assert.equal(
        listPublicNodes().some((item) => item.local),
        false,
      );
    } finally {
      process.env.EMBEDDED_ZEROTIER = previousMode;
    }

    assert.equal(getController("embedded-local")?.embedded, true);
    assert.equal(getNode("embedded-local-node")?.local, true);
  });

  it("can explicitly clear a saved visual flow-policy template", () => {
    const networkId = "f00dbabe01000001";
    saveNetworkMetadata("embedded-local", networkId, {
      templatePolicy: {
        layer2Only: false,
        restrict: false,
        services: [],
        exemptMembers: [],
        custom: [],
      },
    });
    assert.ok(getNetworkMetadata("embedded-local", networkId).templatePolicy);
    saveNetworkMetadata("embedded-local", networkId, {
      templatePolicy: null,
    });
    assert.equal(
      getNetworkMetadata("embedded-local", networkId).templatePolicy,
      null,
    );
  });

  it("stores external controller credentials encrypted and never exposes them publicly", () => {
    const created = createController({
      type: "zerotier",
      name: "Remote lab",
      baseUrl: "https://controller.example:9993",
      credentials: { apiToken: "token-not-plaintext" },
      enabled: true,
      tlsVerify: true,
    });
    assert.ok(created.encryptedCredentials);
    assert.equal(
      created.encryptedCredentials?.includes("token-not-plaintext"),
      false,
    );
    assert.deepEqual(credentialsFor(created), {
      apiToken: "token-not-plaintext",
    });
    assert.equal(
      "encryptedCredentials" in
        listPublicControllers().find((item) => item.id === created.id)!,
      false,
    );
    const linkedNode = getNode(`node-${created.id}`);
    assert.equal(linkedNode?.controllerId, created.id);
    assert.equal(linkedNode?.baseUrl, created.baseUrl);
    assert.deepEqual(nodeCredentialsFor(linkedNode!), {
      apiToken: "token-not-plaintext",
    });
  });

  it("does not create a managed node for Central connections", () => {
    const central = createController({
      type: "central_v1",
      name: "Legacy Central",
      baseUrl: "https://api.zerotier.com/api/v1",
      credentials: { apiToken: "central-token" },
      enabled: true,
      tlsVerify: true,
    });
    assert.equal(getNode(`node-${central.id}`), null);
  });

  it("deletes related records and records deletion without a stale controller foreign key", () => {
    const created = createController({
      type: "zerotier",
      name: "Temporary controller",
      baseUrl: "http://controller.internal:9993",
      credentials: { apiToken: "temporary-token" },
      enabled: true,
      tlsVerify: false,
    });
    const userId = randomUUID();
    const now = Date.now();
    db()
      .prepare(
        "INSERT INTO users (id,email,display_name,password_hash,role,disabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        userId,
        `${userId}@example.com`,
        "Deletion test",
        "test",
        "viewer",
        0,
        now,
        now,
      );
    db()
      .prepare(
        "INSERT INTO user_preferences (user_id,active_controller_id) VALUES (?,?)",
      )
      .run(userId, created.id);
    db()
      .prepare(
        "INSERT INTO network_metadata (controller_id,network_id,description,rules_source,updated_at) VALUES (?,?,?,?,?)",
      )
      .run(created.id, "test-network", "test", "", now);
    db()
      .prepare(
        "INSERT INTO member_metadata (controller_id,network_id,member_id,description,updated_at) VALUES (?,?,?,?,?)",
      )
      .run(created.id, "test-network", "test-member", "test", now);
    writeAudit({
      controllerId: created.id,
      action: "controller.test",
      method: "POST",
      target: created.name,
      status: 200,
      ok: true,
    });
    assert.equal(getNode(`node-${created.id}`)?.controllerId, created.id);

    deleteController(created.id);
    writeAudit({
      controllerId: null,
      action: "controller.delete",
      method: "DELETE",
      target: created.name,
      status: 200,
      ok: true,
      detail: `Deleted controller ID: ${created.id}`,
    });

    assert.equal(getController(created.id), null);
    assert.equal(getNode(`node-${created.id}`), null);
    assert.ok(getActiveControllerId(userId));
    assert.equal(
      queryOne<{ active_controller_id: string | null }>(
        "SELECT active_controller_id FROM user_preferences WHERE user_id=?",
        userId,
      )?.active_controller_id,
      null,
    );
    assert.equal(
      queryOne<{ count: number }>(
        "SELECT COUNT(*) AS count FROM network_metadata WHERE controller_id=?",
        created.id,
      )?.count,
      0,
    );
    assert.equal(
      queryOne<{ count: number }>(
        "SELECT COUNT(*) AS count FROM member_metadata WHERE controller_id=?",
        created.id,
      )?.count,
      0,
    );
    assert.equal(
      queryOne<{ controller_id: string | null }>(
        "SELECT controller_id FROM audit_log WHERE action='controller.test' AND target=? ORDER BY id DESC LIMIT 1",
        created.name,
      )?.controller_id,
      null,
    );
    const deletionAudit = queryOne<{
      controller_id: string | null;
      detail: string | null;
    }>(
      "SELECT controller_id,detail FROM audit_log WHERE action='controller.delete' AND target=? ORDER BY id DESC LIMIT 1",
      created.name,
    );
    assert.equal(deletionAudit?.controller_id, null);
    assert.equal(deletionAudit?.detail, `Deleted controller ID: ${created.id}`);
  });
});

describe("application and profile settings", () => {
  it("persists validated global settings and expires old audit entries", () => {
    saveAppSettings({
      workspaceName: "Operations lab",
      refreshSeconds: 60,
      sessionHours: 24,
      auditRetentionDays: 30,
      ipAllowlistEnabled: false,
      ipAllowlist: ["10.20.0.0/16", "2001:db8::/48"],
    });
    assert.deepEqual(getAppSettings(), {
      workspaceName: "Control Plane",
      refreshSeconds: 60,
      sessionHours: 24,
      auditRetentionDays: 30,
      ipAllowlistEnabled: false,
      ipAllowlist: ["10.20.0.0/16", "2001:db8::/48"],
    });

    const oldTimestamp = Date.now() - 31 * 24 * 60 * 60 * 1000;
    db()
      .prepare(
        `INSERT INTO audit_log
         (timestamp,action,method,target,status,ok)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(oldTimestamp, "test.old", "GET", "expired audit", 200, 1);
    writeAudit({
      action: "test.current",
      method: "GET",
      target: "retained audit",
      status: 200,
      ok: true,
    });
    assert.equal(
      queryOne<{ count: number }>(
        "SELECT COUNT(*) AS count FROM audit_log WHERE target='expired audit'",
      )?.count,
      0,
    );
    assert.equal(
      queryOne<{ count: number }>(
        "SELECT COUNT(*) AS count FROM audit_log WHERE target='retained audit'",
      )?.count,
      1,
    );

    saveAppSettings({
      workspaceName: "Control Plane",
      refreshSeconds: 30,
      sessionHours: 12,
      auditRetentionDays: 0,
      ipAllowlistEnabled: false,
      ipAllowlist: [],
    });
  });

  it("maps personal preferences and rejects unsupported stored landing pages", () => {
    const base: UserRow = {
      id: "preference-user",
      email: "preference@example.com",
      display_name: "Preference user",
      password_hash: "test",
      role: "viewer",
      disabled: 0,
      last_login_at: null,
      active_controller_id: null,
      active_node_id: null,
      landing_page: "/networks",
      reduced_motion: 1,
      mfa_enabled: 1,
    };
    assert.equal(publicUser(base).landingPage, "/networks");
    assert.equal(publicUser(base).reducedMotion, true);
    assert.equal(publicUser(base).mfaEnabled, true);
    assert.equal(
      publicUser({ ...base, landing_page: "https://example.com" }).landingPage,
      "/",
    );
  });
});

describe("SQLite managed-node registry", () => {
  it("creates exactly one immutable local node", () => {
    const localNodes = listPublicNodes().filter((item) => item.local);
    assert.equal(localNodes.length, 1);
    assert.equal(localNodes[0].id, "embedded-local-node");
    assert.equal(localNodes[0].capabilities.clientNetworks, true);
    assert.throws(() => deleteNode(localNodes[0].id), AppError);
  });

  it("encrypts remote credentials, persists selection and clears it on deletion", () => {
    const node = createNode({
      controllerId: "pre-migration-remote",
      type: "zerotier",
      name: "Remote node",
      baseUrl: "https://node.example:9993",
      credentials: { apiToken: "node-token-not-plaintext" },
      enabled: true,
      tlsVerify: true,
    });
    assert.ok(node.encryptedCredentials);
    assert.equal(node.controllerId, "pre-migration-remote");
    assert.equal(
      node.encryptedCredentials?.includes("node-token-not-plaintext"),
      false,
    );
    assert.deepEqual(nodeCredentialsFor(node), {
      apiToken: "node-token-not-plaintext",
    });
    assert.equal(
      "encryptedCredentials" in
        listPublicNodes().find((item) => item.id === node.id)!,
      false,
    );

    const userId = randomUUID();
    const now = Date.now();
    db()
      .prepare(
        "INSERT INTO users (id,email,display_name,password_hash,role,disabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        userId,
        `${userId}@example.com`,
        "Node preference test",
        "test",
        "viewer",
        0,
        now,
        now,
      );
    setActiveNode(userId, node.id);
    assert.equal(getActiveNodeId(userId), node.id);

    deleteNode(node.id);
    assert.equal(getNode(node.id), null);
    assert.ok(getActiveNodeId(userId));
    assert.equal(
      queryOne<{ active_node_id: string | null }>(
        "SELECT active_node_id FROM user_preferences WHERE user_id=?",
        userId,
      )?.active_node_id,
      null,
    );
  });
});

describe("administrator continuity", () => {
  function insertUser(id: string, role: "admin" | "viewer", disabled = 0) {
    const now = Date.now();
    db()
      .prepare(
        "INSERT INTO users (id,email,display_name,password_hash,role,disabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(id, `${id}@example.com`, id, "test", role, disabled, now, now);
    return queryOne<UserRow>("SELECT * FROM users WHERE id=?", id)!;
  }

  it("prevents disabling, demoting or deleting the final enabled administrator", () => {
    const admin = insertUser("admin-one", "admin");
    assert.throws(
      () => assertAdminContinuity(admin, { disabled: true }),
      (error: unknown) =>
        error instanceof AppError && error.code === "LAST_ADMIN",
    );
    assert.throws(
      () => assertAdminContinuity(admin, { role: "viewer" }),
      AppError,
    );
    assert.throws(
      () => assertAdminContinuity(admin, { deleting: true }),
      AppError,
    );
  });

  it("allows changes when another enabled administrator remains", () => {
    insertUser("admin-two", "admin");
    const first = queryOne<UserRow>(
      "SELECT * FROM users WHERE id='admin-one'",
    )!;
    assert.doesNotThrow(() => assertAdminContinuity(first, { role: "viewer" }));
  });
});

describe("session revocation", () => {
  it("revokes every session after a password or access change", () => {
    const userId = `session-user-${randomUUID()}`;
    const now = Date.now();
    db()
      .prepare(
        "INSERT INTO users (id,email,display_name,password_hash,role,disabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        userId,
        `${userId}@example.com`,
        "Session user",
        "test",
        "viewer",
        0,
        now,
        now,
      );
    db()
      .prepare(
        "INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?),(?,?,?,?)",
      )
      .run(
        "session-a",
        userId,
        1,
        Date.now() + 60_000,
        "session-b",
        userId,
        1,
        Date.now() + 60_000,
      );
    assert.equal(revokeUserSessions(userId), 2);
    assert.equal(
      queryOne<{ count: number }>(
        "SELECT COUNT(*) AS count FROM sessions WHERE user_id=?",
        userId,
      )?.count,
      0,
    );
  });
});
