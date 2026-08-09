import { readFileSync } from "node:fs";
import {
  createId,
  db,
  managedNodeRecord,
  queryAll,
  queryOne,
} from "@/lib/database";
import { capabilitiesForNodeType } from "@/lib/controller-capabilities";
import { decryptJson, encryptJson } from "@/lib/secrets";
import { AppError } from "@/lib/errors";
import type {
  ControllerStatus,
  ManagedNodeRecord,
  ManagedNodeType,
  PublicManagedNode,
} from "@/lib/types";
import type {
  MikroTikCredentials,
  ZeroTierCredentials,
} from "@/lib/controller-registry";
import { embeddedZeroTierEnabled } from "@/lib/runtime-mode";

const selectNode = `SELECT id,controller_id,type,name,base_url,encrypted_credentials,enabled,tls_verify,local,last_checked_at,last_online,last_address,last_version,last_error,created_at,updated_at FROM managed_nodes`;

function nodeIsAvailable(record: ManagedNodeRecord) {
  return !record.local || embeddedZeroTierEnabled();
}

export function listNodes(): ManagedNodeRecord[] {
  return queryAll<Record<string, unknown>>(
    `${selectNode} ORDER BY local DESC, name COLLATE NOCASE`,
  )
    .map((row) => managedNodeRecord(row as never))
    .filter(nodeIsAvailable);
}

export function listNodesForController(
  controllerId: string,
): ManagedNodeRecord[] {
  return queryAll<Record<string, unknown>>(
    `${selectNode} WHERE controller_id=? ORDER BY local DESC, name COLLATE NOCASE`,
    controllerId,
  )
    .map((row) => managedNodeRecord(row as never))
    .filter(nodeIsAvailable);
}

export function getNode(id: string) {
  const row = queryOne<Record<string, unknown>>(`${selectNode} WHERE id=?`, id);
  if (!row) return null;
  const record = managedNodeRecord(row as never);
  return nodeIsAvailable(record) ? record : null;
}

export function publicNode(record: ManagedNodeRecord): PublicManagedNode {
  const { encryptedCredentials: _, ...safe } = record;
  void _;
  return { ...safe, capabilities: capabilitiesForNodeType(record.type) };
}

export function listPublicNodes() {
  return listNodes().map(publicNode);
}

export function nodeCredentialsFor(
  record: ManagedNodeRecord,
): ZeroTierCredentials | MikroTikCredentials {
  if (record.type === "local") {
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
        "The local ZeroTier API token is not available yet.",
        503,
        "LOCAL_TOKEN_UNAVAILABLE",
      );
    }
  }
  if (!record.encryptedCredentials)
    throw new AppError(
      "Managed node credentials are missing.",
      500,
      "CREDENTIALS_MISSING",
    );
  return decryptJson(record.encryptedCredentials);
}

export function createNode(input: {
  controllerId?: string | null;
  type: Exclude<ManagedNodeType, "local">;
  name: string;
  baseUrl: string;
  credentials: ZeroTierCredentials | MikroTikCredentials;
  enabled: boolean;
  tlsVerify: boolean;
}) {
  if (input.controllerId) {
    const controller = queryOne<{ type: string }>(
      "SELECT type FROM controllers WHERE id=?",
      input.controllerId,
    );
    if (!controller)
      throw new AppError("Controller not found.", 404, "CONTROLLER_NOT_FOUND");
    if (controller.type === "central_v1" || controller.type === "central_v2")
      throw new AppError(
        "ZeroTier Central does not expose a managed-node API.",
        409,
        "NODE_API_UNAVAILABLE",
      );
  }
  const id = createId();
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO managed_nodes (id,controller_id,type,name,base_url,encrypted_credentials,enabled,tls_verify,local,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      input.controllerId || null,
      input.type,
      input.name,
      input.baseUrl,
      encryptJson(input.credentials),
      input.enabled ? 1 : 0,
      input.tlsVerify ? 1 : 0,
      0,
      now,
      now,
    );
  return getNode(id)!;
}

export function updateNode(
  id: string,
  input: {
    name: string;
    baseUrl: string;
    credentials?: ZeroTierCredentials | MikroTikCredentials;
    enabled: boolean;
    tlsVerify: boolean;
  },
) {
  const current = getNode(id);
  if (!current)
    throw new AppError("Managed node not found.", 404, "NODE_NOT_FOUND");
  if (current.local)
    throw new AppError(
      "The local node connection is managed automatically.",
      409,
      "LOCAL_NODE",
    );
  const encrypted = input.credentials
    ? encryptJson(input.credentials)
    : current.encryptedCredentials;
  db()
    .prepare(
      `UPDATE managed_nodes SET name=?,base_url=?,encrypted_credentials=?,enabled=?,tls_verify=?,updated_at=? WHERE id=?`,
    )
    .run(
      input.name,
      input.baseUrl,
      encrypted,
      input.enabled ? 1 : 0,
      input.tlsVerify ? 1 : 0,
      Date.now(),
      id,
    );
  return getNode(id)!;
}

export function deleteNode(id: string) {
  const current = getNode(id);
  if (!current)
    throw new AppError("Managed node not found.", 404, "NODE_NOT_FOUND");
  if (current.local)
    throw new AppError(
      "The local node cannot be removed.",
      409,
      "LOCAL_NODE",
    );
  db().prepare("DELETE FROM managed_nodes WHERE id=?").run(id);
}

export function updateNodeStatus(
  id: string,
  status: ControllerStatus | null,
  error?: string,
) {
  db()
    .prepare(
      `UPDATE managed_nodes SET last_checked_at=?,last_online=?,last_address=?,last_version=?,last_error=?,updated_at=? WHERE id=?`,
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

export function getActiveNodeId(userId: string) {
  const preferred = queryOne<{ active_node_id: string | null }>(
    "SELECT active_node_id FROM user_preferences WHERE user_id=?",
    userId,
  )?.active_node_id;
  if (preferred && getNode(preferred)?.enabled) return preferred;
  const fallback = listNodes().find((node) => node.enabled)?.id || null;
  return fallback;
}

export function setActiveNode(userId: string, nodeId: string) {
  const node = getNode(nodeId);
  if (!node || !node.enabled)
    throw new AppError(
      "Choose an enabled managed node.",
      404,
      "NODE_NOT_AVAILABLE",
    );
  db()
    .prepare(
      `INSERT INTO user_preferences (user_id,active_node_id) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET active_node_id=excluded.active_node_id`,
    )
    .run(userId, nodeId);
}
