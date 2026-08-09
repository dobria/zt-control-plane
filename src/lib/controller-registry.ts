import { readFileSync } from "node:fs";
import {
  createId,
  controllerRecord,
  db,
  queryAll,
  queryOne,
} from "@/lib/database";
import { capabilitiesForType } from "@/lib/controller-capabilities";
import { decryptJson, encryptJson } from "@/lib/secrets";
import type {
  ControllerRecord,
  ControllerConfiguration,
  ControllerStatus,
  ControllerType,
  PublicController,
} from "@/lib/types";
import { AppError } from "@/lib/errors";
import { embeddedZeroTierEnabled } from "@/lib/runtime-mode";

const selectController = `SELECT id,type,name,base_url,encrypted_credentials,configuration_json,enabled,tls_verify,embedded,last_checked_at,last_online,last_address,last_version,last_error,created_at,updated_at FROM controllers`;

function controllerIsAvailable(record: ControllerRecord) {
  return !record.embedded || embeddedZeroTierEnabled();
}

export type ZeroTierCredentials = { apiToken: string };
export type CentralCredentials = { apiToken: string };
export type MikroTikCredentials = { username: string; password: string };

export function listControllers(): ControllerRecord[] {
  return queryAll<Record<string, unknown>>(
    `${selectController} ORDER BY embedded DESC, name COLLATE NOCASE`,
  )
    .map((row) => controllerRecord(row as never))
    .filter(controllerIsAvailable);
}
export function getController(id: string) {
  const row = queryOne<Record<string, unknown>>(
    `${selectController} WHERE id=?`,
    id,
  );
  if (!row) return null;
  const record = controllerRecord(row as never);
  return controllerIsAvailable(record) ? record : null;
}
export function publicController(record: ControllerRecord): PublicController {
  const { encryptedCredentials: _, ...safe } = record;
  void _;
  return { ...safe, capabilities: capabilitiesForType(record.type) };
}
export function listPublicControllers() {
  return listControllers().map(publicController);
}

export function credentialsFor(
  record: ControllerRecord,
): ZeroTierCredentials | CentralCredentials | MikroTikCredentials {
  if (record.type === "embedded") {
    const tokenPath =
      process.env.ZT_LOCAL_TOKEN_PATH ||
      "/var/lib/zerotier-one/authtoken.secret";
    try {
      return {
        apiToken: readFileSync(
          /* turbopackIgnore: true */ tokenPath,
          "utf8",
        ).trim(),
      };
    } catch {
      throw new AppError(
        "The embedded ZeroTier API token is not available yet.",
        503,
        "LOCAL_TOKEN_UNAVAILABLE",
      );
    }
  }
  if (!record.encryptedCredentials)
    throw new AppError(
      "Controller credentials are missing.",
      500,
      "CREDENTIALS_MISSING",
    );
  return decryptJson(record.encryptedCredentials);
}

export function createController(input: {
  type: Exclude<ControllerType, "embedded">;
  name: string;
  baseUrl: string;
  credentials: ZeroTierCredentials | MikroTikCredentials;
  configuration?: ControllerConfiguration;
  enabled: boolean;
  tlsVerify: boolean;
}) {
  const id = createId();
  const now = Date.now();
  const encryptedCredentials = encryptJson(input.credentials);
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        `INSERT INTO controllers (id,type,name,base_url,encrypted_credentials,configuration_json,enabled,tls_verify,embedded,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.type,
        input.name,
        input.baseUrl,
        encryptedCredentials,
        JSON.stringify(input.configuration || {}),
        input.enabled ? 1 : 0,
        input.tlsVerify ? 1 : 0,
        0,
        now,
        now,
      );
    if (input.type === "zerotier" || input.type === "mikrotik")
      database
        .prepare(
          `INSERT INTO managed_nodes (id,controller_id,type,name,base_url,encrypted_credentials,enabled,tls_verify,local,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          `node-${id}`,
          id,
          input.type,
          `${input.name} node`,
          input.baseUrl,
          encryptedCredentials,
          input.enabled ? 1 : 0,
          input.tlsVerify ? 1 : 0,
          0,
          now,
          now,
        );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return getController(id)!;
}

export function updateController(
  id: string,
  input: {
    name: string;
    baseUrl: string;
    credentials?: ZeroTierCredentials | MikroTikCredentials;
    configuration?: ControllerConfiguration;
    enabled: boolean;
    tlsVerify: boolean;
  },
) {
  const current = getController(id);
  if (!current)
    throw new AppError("Controller not found.", 404, "CONTROLLER_NOT_FOUND");
  if (current.embedded)
    throw new AppError(
      "The embedded controller connection is managed automatically.",
      409,
      "EMBEDDED_CONTROLLER",
    );
  const encrypted = input.credentials
    ? encryptJson(input.credentials)
    : current.encryptedCredentials;
  const database = db();
  database
    .prepare(
      `UPDATE controllers SET name=?,base_url=?,encrypted_credentials=?,configuration_json=?,enabled=?,tls_verify=?,updated_at=? WHERE id=?`,
    )
    .run(
      input.name,
      input.baseUrl,
      encrypted,
      JSON.stringify(input.configuration ?? current.configuration),
      input.enabled ? 1 : 0,
      input.tlsVerify ? 1 : 0,
      Date.now(),
      id,
    );
  if (current.type === "zerotier" || current.type === "mikrotik")
    database
      .prepare(
        `UPDATE managed_nodes SET name=?,base_url=?,encrypted_credentials=?,enabled=?,tls_verify=?,updated_at=? WHERE id=? AND controller_id=?`,
      )
      .run(
        `${input.name} node`,
        input.baseUrl,
        encrypted,
        input.enabled ? 1 : 0,
        input.tlsVerify ? 1 : 0,
        Date.now(),
        `node-${id}`,
        id,
      );
  return getController(id)!;
}

export function deleteController(id: string) {
  const current = getController(id);
  if (!current)
    throw new AppError("Controller not found.", 404, "CONTROLLER_NOT_FOUND");
  if (current.embedded)
    throw new AppError(
      "The embedded controller cannot be removed.",
      409,
      "EMBEDDED_CONTROLLER",
    );
  db().prepare("DELETE FROM controllers WHERE id=?").run(id);
}

export function updateControllerStatus(
  id: string,
  status: ControllerStatus | null,
  error?: string,
) {
  db()
    .prepare(
      `UPDATE controllers SET last_checked_at=?,last_online=?,last_address=?,last_version=?,last_error=?,updated_at=? WHERE id=?`,
    )
    .run(
      Date.now(),
      status?.online ? 1 : 0,
      status?.address || null,
      status?.version || null,
      error || null,
      Date.now(),
      id,
    );
}

export function getActiveControllerId(userId: string) {
  const preferred = queryOne<{ active_controller_id: string | null }>(
    "SELECT active_controller_id FROM user_preferences WHERE user_id=?",
    userId,
  )?.active_controller_id;
  if (preferred && getController(preferred)?.enabled) return preferred;
  const fallback =
    listControllers().find((controller) => controller.enabled)?.id || null;
  return fallback;
}

export function setActiveController(userId: string, controllerId: string) {
  const controller = getController(controllerId);
  if (!controller || !controller.enabled)
    throw new AppError(
      "Choose an enabled controller.",
      404,
      "CONTROLLER_NOT_AVAILABLE",
    );
  db()
    .prepare(
      `INSERT INTO user_preferences (user_id,active_controller_id) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET active_controller_id=excluded.active_controller_id`,
    )
    .run(userId, controllerId);
}
