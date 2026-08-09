import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AppRole,
  ControllerRecord,
  ControllerType,
  ManagedNodeRecord,
  ManagedNodeType,
  PublicUser,
} from "@/lib/types";
import { embeddedZeroTierEnabled } from "@/lib/runtime-mode";

const globalDatabase = globalThis as typeof globalThis & {
  __ztcpDatabase?: DatabaseSync;
};

function databasePath() {
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;
  const directory =
    process.env.APP_DATA_DIR || path.join(process.cwd(), ".data");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(directory, 0o700);
  return path.join(directory, "control-plane.sqlite");
}

function protectDatabaseFiles(filename: string) {
  if (process.platform === "win32") return;
  for (const candidate of [filename, `${filename}-wal`, `${filename}-shm`]) {
    if (existsSync(/* turbopackIgnore: true */ candidate))
      chmodSync(candidate, 0o600);
  }
}

function columns(database: DatabaseSync, table: string) {
  return new Set(
    database
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => String((row as { name: unknown }).name)),
  );
}

function migrateControllerTable(database: DatabaseSync) {
  const currentColumns = columns(database, "controllers");
  const row = database
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='controllers'",
    )
    .get() as { sql?: string } | undefined;
  const sql = row?.sql || "";
  if (sql.includes("central_v2") && currentColumns.has("configuration_json")) {
    database
      .prepare(
        "INSERT OR IGNORE INTO schema_migrations (version,applied_at) VALUES (1,?)",
      )
      .run(Date.now());
    return;
  }
  let began = false;
  database.exec("PRAGMA foreign_keys = OFF");
  try {
    database.exec("BEGIN IMMEDIATE");
    began = true;
    database.exec(`CREATE TABLE controllers_next (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('embedded','zerotier','mikrotik','central_v2','central_v1')),
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
    )`);
    const configurationExpression = currentColumns.has("configuration_json")
      ? "configuration_json"
      : "'{}'";
    database.exec(`INSERT INTO controllers_next (
      id,type,name,base_url,encrypted_credentials,configuration_json,enabled,
      tls_verify,embedded,last_checked_at,last_online,last_address,last_version,
      last_error,created_at,updated_at
    )
    SELECT id,type,name,base_url,encrypted_credentials,${configurationExpression},enabled,tls_verify,
      embedded,last_checked_at,last_online,last_address,last_version,last_error,
      created_at,updated_at FROM controllers;
    `);
    database.exec("DROP TABLE controllers");
    database.exec("ALTER TABLE controllers_next RENAME TO controllers");
    database
      .prepare(
        "INSERT OR IGNORE INTO schema_migrations (version,applied_at) VALUES (1,?)",
      )
      .run(Date.now());
    database.exec("COMMIT");
    began = false;
  } catch (error) {
    if (began) database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
  const violations = database.prepare("PRAGMA foreign_key_check").all();
  if (violations.length)
    throw new Error("Controller migration failed its foreign-key check.");
}

function migrateColumns(database: DatabaseSync) {
  database.exec("BEGIN IMMEDIATE");
  try {
    if (!columns(database, "managed_nodes").has("controller_id"))
      database.exec(
        "ALTER TABLE managed_nodes ADD COLUMN controller_id TEXT REFERENCES controllers(id) ON DELETE CASCADE",
      );
    if (!columns(database, "user_preferences").has("active_node_id"))
      database.exec(
        "ALTER TABLE user_preferences ADD COLUMN active_node_id TEXT REFERENCES managed_nodes(id) ON DELETE SET NULL",
      );
    if (!columns(database, "user_preferences").has("landing_page"))
      database.exec(
        "ALTER TABLE user_preferences ADD COLUMN landing_page TEXT NOT NULL DEFAULT '/'",
      );
    if (!columns(database, "user_preferences").has("reduced_motion"))
      database.exec(
        "ALTER TABLE user_preferences ADD COLUMN reduced_motion INTEGER NOT NULL DEFAULT 0",
      );
    if (!columns(database, "audit_log").has("node_id"))
      database.exec(
        "ALTER TABLE audit_log ADD COLUMN node_id TEXT REFERENCES managed_nodes(id) ON DELETE SET NULL",
      );
    database
      .prepare(
        "INSERT OR IGNORE INTO schema_migrations (version,applied_at) VALUES (2,?)",
      )
      .run(Date.now());
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function initialize(database: DatabaseSync) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','operator','auditor','viewer')),
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_login_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS user_mfa (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      encrypted_secret TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      pending_expires_at INTEGER,
      last_used_step INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, code_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_mfa_recovery_user
      ON mfa_recovery_codes(user_id, used_at);
    CREATE TABLE IF NOT EXISTS mfa_login_challenges (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_mfa_challenge_expires
      ON mfa_login_challenges(expires_at);

    CREATE TABLE IF NOT EXISTS login_attempts (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_login_attempts_reset_at ON login_attempts(reset_at);

    CREATE TABLE IF NOT EXISTS controllers (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('embedded','zerotier','mikrotik','central_v2','central_v1')),
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
    CREATE INDEX IF NOT EXISTS idx_controllers_type_enabled ON controllers(type, enabled);

    CREATE TABLE IF NOT EXISTS managed_nodes (
      id TEXT PRIMARY KEY,
      controller_id TEXT REFERENCES controllers(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('local','zerotier','mikrotik')),
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      encrypted_credentials TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      tls_verify INTEGER NOT NULL DEFAULT 1,
      local INTEGER NOT NULL DEFAULT 0,
      last_checked_at INTEGER,
      last_online INTEGER,
      last_address TEXT,
      last_version TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_managed_nodes_type_enabled ON managed_nodes(type, enabled);

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      active_controller_id TEXT REFERENCES controllers(id) ON DELETE SET NULL,
      active_node_id TEXT REFERENCES managed_nodes(id) ON DELETE SET NULL,
      landing_page TEXT NOT NULL DEFAULT '/',
      reduced_motion INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS network_metadata (
      controller_id TEXT NOT NULL REFERENCES controllers(id) ON DELETE CASCADE,
      network_id TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      rules_source TEXT NOT NULL DEFAULT '',
      template_policy_json TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(controller_id, network_id)
    );
    CREATE TABLE IF NOT EXISTS member_metadata (
      controller_id TEXT NOT NULL,
      network_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(controller_id, network_id, member_id),
      FOREIGN KEY(controller_id, network_id) REFERENCES network_metadata(controller_id, network_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      controller_id TEXT REFERENCES controllers(id) ON DELETE SET NULL,
      node_id TEXT REFERENCES managed_nodes(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      method TEXT NOT NULL,
      target TEXT NOT NULL,
      status INTEGER NOT NULL,
      ok INTEGER NOT NULL,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_controller_timestamp ON audit_log(controller_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_user_timestamp ON audit_log(user_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_node_timestamp ON audit_log(node_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_action_timestamp ON audit_log(action, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_result_timestamp ON audit_log(ok, timestamp DESC);

    CREATE TABLE IF NOT EXISTS restore_mappings (
      controller_id TEXT NOT NULL REFERENCES controllers(id) ON DELETE CASCADE,
      source_network_id TEXT NOT NULL,
      restored_network_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(controller_id, source_network_id)
    );

    CREATE TABLE IF NOT EXISTS network_inventory (
      controller_id TEXT NOT NULL REFERENCES controllers(id) ON DELETE CASCADE,
      network_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      synced_at INTEGER NOT NULL,
      PRIMARY KEY(controller_id, network_id)
    );
    CREATE INDEX IF NOT EXISTS idx_network_inventory_synced
      ON network_inventory(synced_at DESC);

    CREATE TABLE IF NOT EXISTS member_inventory (
      controller_id TEXT NOT NULL,
      network_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      synced_at INTEGER NOT NULL,
      PRIMARY KEY(controller_id, network_id, member_id),
      FOREIGN KEY(controller_id, network_id)
        REFERENCES network_inventory(controller_id, network_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_member_inventory_member
      ON member_inventory(member_id);

    CREATE TABLE IF NOT EXISTS client_network_inventory (
      node_id TEXT NOT NULL REFERENCES managed_nodes(id) ON DELETE CASCADE,
      instance_key TEXT NOT NULL DEFAULT '',
      network_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      synced_at INTEGER NOT NULL,
      PRIMARY KEY(node_id, instance_key, network_id)
    );
  `);

  migrateControllerTable(database);
  migrateColumns(database);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_controllers_type_enabled ON controllers(type, enabled);
    CREATE INDEX IF NOT EXISTS idx_managed_nodes_type_enabled ON managed_nodes(type, enabled);
    CREATE INDEX IF NOT EXISTS idx_managed_nodes_controller ON managed_nodes(controller_id);
  `);
  database
    .prepare(
      "INSERT OR IGNORE INTO schema_migrations (version,applied_at) VALUES (3,?)",
    )
    .run(Date.now());
  database
    .prepare(
      "INSERT OR IGNORE INTO schema_migrations (version,applied_at) VALUES (4,?)",
    )
    .run(Date.now());
  database
    .prepare(
      "INSERT OR IGNORE INTO schema_migrations (version,applied_at) VALUES (5,?)",
    )
    .run(Date.now());
  database
    .prepare(
      "INSERT OR IGNORE INTO schema_migrations (version,applied_at) VALUES (6,?)",
    )
    .run(Date.now());
  database
    .prepare(
      "INSERT OR IGNORE INTO schema_migrations (version,applied_at) VALUES (7,?)",
    )
    .run(Date.now());

  const now = Date.now();
  if (embeddedZeroTierEnabled()) {
    database
      .prepare(
        `
    INSERT INTO controllers (id, type, name, base_url, configuration_json, enabled, tls_verify, embedded, created_at, updated_at)
    VALUES ('embedded-local', 'embedded', 'Local controller', ?, '{}', 1, 1, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET base_url=excluded.base_url, updated_at=excluded.updated_at
  `,
      )
      .run(process.env.ZT_LOCAL_API_URL || "http://127.0.0.1:9993", now, now);
    database
      .prepare(
        `
    INSERT INTO managed_nodes (id, controller_id, type, name, base_url, enabled, tls_verify, local, created_at, updated_at)
    VALUES ('embedded-local-node', 'embedded-local', 'local', 'Local node', ?, 1, 1, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET controller_id='embedded-local',base_url=excluded.base_url,updated_at=excluded.updated_at
  `,
      )
      .run(process.env.ZT_LOCAL_API_URL || "http://127.0.0.1:9993", now, now);
  }
  database
    .prepare(
      `
    INSERT OR IGNORE INTO managed_nodes (
      id,controller_id,type,name,base_url,encrypted_credentials,enabled,tls_verify,local,
      last_checked_at,last_online,last_address,last_version,last_error,created_at,updated_at
    )
    SELECT 'node-' || id,id,type,name || ' node',base_url,encrypted_credentials,
      enabled,tls_verify,0,last_checked_at,last_online,last_address,last_version,
      last_error,created_at,updated_at
    FROM controllers WHERE type IN ('zerotier','mikrotik')
  `,
    )
    .run();
  database.exec(`
    UPDATE managed_nodes SET controller_id='embedded-local'
    WHERE id='embedded-local-node' AND controller_id IS NULL;
    UPDATE managed_nodes
    SET controller_id=substr(id, 6)
    WHERE controller_id IS NULL
      AND id LIKE 'node-%'
      AND EXISTS (SELECT 1 FROM controllers WHERE controllers.id=substr(managed_nodes.id, 6));
  `);
  database.exec("PRAGMA optimize;");
}

export function db() {
  if (!globalDatabase.__ztcpDatabase) {
    const filename = databasePath();
    if (process.platform !== "win32") process.umask(0o077);
    const database = new DatabaseSync(filename);
    try {
      initialize(database);
      protectDatabaseFiles(filename);
      globalDatabase.__ztcpDatabase = database;
    } catch (error) {
      database.close();
      throw error;
    }
  }
  return globalDatabase.__ztcpDatabase;
}

export function closeDatabaseForTests() {
  globalDatabase.__ztcpDatabase?.close();
  delete globalDatabase.__ztcpDatabase;
}

export function queryOne<T>(sql: string, ...values: SQLInputValue[]) {
  return db()
    .prepare(sql)
    .get(...values) as T | undefined;
}
export function queryAll<T>(sql: string, ...values: SQLInputValue[]) {
  return db()
    .prepare(sql)
    .all(...values) as T[];
}

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  role: AppRole;
  disabled: number;
  last_login_at: number | null;
  active_controller_id?: string | null;
  active_node_id?: string | null;
  landing_page?: string | null;
  reduced_motion?: number | null;
  mfa_enabled?: number | null;
}
export function publicUser(row: UserRow): PublicUser {
  const landingPages = new Set([
    "/",
    "/controllers",
    "/nodes",
    "/networks",
    "/diagnostics",
  ]);
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    disabled: Boolean(row.disabled),
    lastLoginAt: row.last_login_at,
    activeControllerId: row.active_controller_id ?? null,
    activeNodeId: row.active_node_id ?? null,
    landingPage: landingPages.has(row.landing_page || "")
      ? (row.landing_page as PublicUser["landingPage"])
      : "/",
    reducedMotion: Boolean(row.reduced_motion),
    mfaEnabled: Boolean(row.mfa_enabled),
  };
}

interface ControllerRow {
  id: string;
  type: ControllerType;
  name: string;
  base_url: string;
  encrypted_credentials: string | null;
  configuration_json: string;
  enabled: number;
  tls_verify: number;
  embedded: number;
  last_checked_at: number | null;
  last_online: number | null;
  last_address: string | null;
  last_version: string | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}
export function controllerRecord(row: ControllerRow): ControllerRecord {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    baseUrl: row.base_url,
    encryptedCredentials: row.encrypted_credentials,
    configuration: (() => {
      try {
        return JSON.parse(row.configuration_json || "{}") as Record<
          string,
          unknown
        >;
      } catch {
        return {};
      }
    })(),
    enabled: Boolean(row.enabled),
    tlsVerify: Boolean(row.tls_verify),
    embedded: Boolean(row.embedded),
    lastCheckedAt: row.last_checked_at,
    lastOnline: row.last_online === null ? null : Boolean(row.last_online),
    lastAddress: row.last_address,
    lastVersion: row.last_version,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ManagedNodeRow {
  id: string;
  controller_id: string | null;
  type: ManagedNodeType;
  name: string;
  base_url: string;
  encrypted_credentials: string | null;
  enabled: number;
  tls_verify: number;
  local: number;
  last_checked_at: number | null;
  last_online: number | null;
  last_address: string | null;
  last_version: string | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export function managedNodeRecord(row: ManagedNodeRow): ManagedNodeRecord {
  return {
    id: row.id,
    controllerId: row.controller_id,
    type: row.type,
    name: row.name,
    baseUrl: row.base_url,
    encryptedCredentials: row.encrypted_credentials,
    enabled: Boolean(row.enabled),
    tlsVerify: Boolean(row.tls_verify),
    local: Boolean(row.local),
    lastCheckedAt: row.last_checked_at,
    lastOnline: row.last_online === null ? null : Boolean(row.last_online),
    lastAddress: row.last_address,
    lastVersion: row.last_version,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createId() {
  return randomUUID();
}
