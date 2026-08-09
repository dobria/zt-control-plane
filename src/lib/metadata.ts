import { db, queryOne } from "@/lib/database";

export interface NetworkMetadata {
  description: string;
  rulesSource: string;
  templatePolicy: Record<string, unknown> | null;
}

export function getNetworkMetadata(
  controllerId: string,
  networkId: string,
): NetworkMetadata {
  const row = queryOne<{
    description: string;
    rules_source: string;
    template_policy_json: string | null;
  }>(
    "SELECT description,rules_source,template_policy_json FROM network_metadata WHERE controller_id=? AND network_id=?",
    controllerId,
    networkId,
  );
  return {
    description: row?.description || "",
    rulesSource: row?.rules_source || "",
    templatePolicy: (() => {
      if (!row?.template_policy_json) return null;
      try {
        const parsed = JSON.parse(row.template_policy_json);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    })(),
  };
}
export function saveNetworkMetadata(
  controllerId: string,
  networkId: string,
  input: Partial<NetworkMetadata>,
) {
  const current = getNetworkMetadata(controllerId, networkId);
  const templatePolicy = Object.hasOwn(input, "templatePolicy")
    ? input.templatePolicy
    : current.templatePolicy;
  db()
    .prepare(
      `INSERT INTO network_metadata (controller_id,network_id,description,rules_source,template_policy_json,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(controller_id,network_id) DO UPDATE SET description=excluded.description,rules_source=excluded.rules_source,template_policy_json=excluded.template_policy_json,updated_at=excluded.updated_at`,
    )
    .run(
      controllerId,
      networkId,
      input.description ?? current.description,
      input.rulesSource ?? current.rulesSource,
      templatePolicy === null ? null : JSON.stringify(templatePolicy),
      Date.now(),
    );
}
export function deleteNetworkMetadata(controllerId: string, networkId: string) {
  db()
    .prepare(
      "DELETE FROM network_metadata WHERE controller_id=? AND network_id=?",
    )
    .run(controllerId, networkId);
}
export function getMemberDescription(
  controllerId: string,
  networkId: string,
  memberId: string,
) {
  return (
    queryOne<{ description: string }>(
      "SELECT description FROM member_metadata WHERE controller_id=? AND network_id=? AND member_id=?",
      controllerId,
      networkId,
      memberId,
    )?.description || ""
  );
}
export function saveMemberDescription(
  controllerId: string,
  networkId: string,
  memberId: string,
  description: string,
) {
  saveNetworkMetadata(controllerId, networkId, {});
  db()
    .prepare(
      `INSERT INTO member_metadata (controller_id,network_id,member_id,description,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(controller_id,network_id,member_id) DO UPDATE SET description=excluded.description,updated_at=excluded.updated_at`,
    )
    .run(controllerId, networkId, memberId, description, Date.now());
}
export function deleteMemberMetadata(
  controllerId: string,
  networkId: string,
  memberId: string,
) {
  db()
    .prepare(
      "DELETE FROM member_metadata WHERE controller_id=? AND network_id=? AND member_id=?",
    )
    .run(controllerId, networkId, memberId);
}
