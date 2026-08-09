import { db, queryAll } from "@/lib/database";
import type { ClientNetwork, ManagedNetwork, NetworkMember } from "@/lib/types";

function parsed<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function cachePayload<T extends { raw?: unknown }>(value: T): T {
  const safe = { ...value };
  delete safe.raw;
  return safe;
}

export function saveNetworkInventory(
  controllerId: string,
  networks: ManagedNetwork[],
  syncedAt: number,
) {
  const database = db();
  const current = new Set(
    queryAll<{ network_id: string }>(
      "SELECT network_id FROM network_inventory WHERE controller_id=?",
      controllerId,
    ).map((row) => row.network_id),
  );
  const upsert = database.prepare(
    `INSERT INTO network_inventory
     (controller_id,network_id,payload_json,synced_at) VALUES (?,?,?,?)
     ON CONFLICT(controller_id,network_id) DO UPDATE SET
       payload_json=excluded.payload_json,synced_at=excluded.synced_at`,
  );
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const network of networks) {
      upsert.run(
        controllerId,
        network.id,
        JSON.stringify(cachePayload(network)),
        syncedAt,
      );
      current.delete(network.id);
    }
    const remove = database.prepare(
      "DELETE FROM network_inventory WHERE controller_id=? AND network_id=?",
    );
    for (const networkId of current) remove.run(controllerId, networkId);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function cachedNetworks(controllerId: string) {
  return queryAll<{
    payload_json: string;
    synced_at: number;
  }>(
    "SELECT payload_json,synced_at FROM network_inventory WHERE controller_id=? ORDER BY network_id",
    controllerId,
  )
    .map((row) => ({
      network: parsed<ManagedNetwork>(row.payload_json),
      syncedAt: row.synced_at,
    }))
    .filter((row): row is { network: ManagedNetwork; syncedAt: number } =>
      Boolean(row.network),
    );
}

export function saveMemberInventory(
  controllerId: string,
  networkId: string,
  members: NetworkMember[],
  syncedAt: number,
) {
  const database = db();
  const remove = database.prepare(
    "DELETE FROM member_inventory WHERE controller_id=? AND network_id=?",
  );
  const insert = database.prepare(
    `INSERT INTO member_inventory
     (controller_id,network_id,member_id,payload_json,synced_at)
     VALUES (?,?,?,?,?)`,
  );
  database.exec("BEGIN IMMEDIATE");
  try {
    remove.run(controllerId, networkId);
    for (const member of members)
      insert.run(
        controllerId,
        networkId,
        member.id,
        JSON.stringify(cachePayload(member)),
        syncedAt,
      );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function cachedMembers(controllerId: string, networkId: string) {
  return queryAll<{ payload_json: string; synced_at: number }>(
    `SELECT payload_json,synced_at FROM member_inventory
     WHERE controller_id=? AND network_id=? ORDER BY member_id`,
    controllerId,
    networkId,
  )
    .map((row) => ({
      member: parsed<NetworkMember>(row.payload_json),
      syncedAt: row.synced_at,
    }))
    .filter((row): row is { member: NetworkMember; syncedAt: number } =>
      Boolean(row.member),
    );
}

export function saveClientNetworkInventory(
  nodeId: string,
  networks: ClientNetwork[],
  syncedAt: number,
) {
  const database = db();
  const remove = database.prepare(
    "DELETE FROM client_network_inventory WHERE node_id=?",
  );
  const insert = database.prepare(
    `INSERT INTO client_network_inventory
     (node_id,instance_key,network_id,payload_json,synced_at)
     VALUES (?,?,?,?,?)`,
  );
  database.exec("BEGIN IMMEDIATE");
  try {
    remove.run(nodeId);
    for (const network of networks)
      insert.run(
        nodeId,
        network.instance || "",
        network.id,
        JSON.stringify(cachePayload(network)),
        syncedAt,
      );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function cachedClientNetworks(nodeId: string) {
  return queryAll<{ payload_json: string; synced_at: number }>(
    `SELECT payload_json,synced_at FROM client_network_inventory
     WHERE node_id=? ORDER BY instance_key,network_id`,
    nodeId,
  )
    .map((row) => ({
      network: parsed<ClientNetwork>(row.payload_json),
      syncedAt: row.synced_at,
    }))
    .filter((row): row is { network: ClientNetwork; syncedAt: number } =>
      Boolean(row.network),
    );
}
