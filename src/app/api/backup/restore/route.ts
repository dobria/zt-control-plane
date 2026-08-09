import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { adapterFor } from "@/lib/adapters";
import { db, queryOne } from "@/lib/database";
import { saveMemberDescription, saveNetworkMetadata } from "@/lib/metadata";
import { AppError, errorDetail, jsonError } from "@/lib/errors";
import {
  jsonBody,
  memberId,
  networkId,
  optionalText,
  requiredText,
} from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";
import {
  flowPolicyPayload,
  memberPayload,
  networkPayload,
} from "@/lib/payloads";
import type { ManagedNetwork, NetworkMember } from "@/lib/types";

export const runtime = "nodejs";

interface BackupNetwork {
  network: ManagedNetwork;
  metadata?: {
    description?: string;
    rulesSource?: string;
    templatePolicy?: Record<string, unknown> | null;
  };
  members?: Array<{ member: NetworkMember; description?: string }>;
}

interface RestoreMemberResult {
  memberId: string;
  ok: boolean;
  error: string | null;
}

interface RestoreNetworkResult {
  sourceNetworkId: string;
  restoredNetworkId: string | null;
  operation: "create" | "update";
  ok: boolean;
  error: string | null;
  members: RestoreMemberResult[];
}

function backupNetwork(value: unknown, index: number): BackupNetwork {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError(
      `Backup network ${index + 1} is invalid.`,
      400,
      "INVALID_BACKUP_NETWORK",
    );
  const item = value as Record<string, unknown>;
  if (!item.network || typeof item.network !== "object")
    throw new AppError(
      `Backup network ${index + 1} has no configuration.`,
      400,
      "INVALID_BACKUP_NETWORK",
    );
  const network = item.network as ManagedNetwork;
  networkId(network.id);
  if (item.members !== undefined && !Array.isArray(item.members))
    throw new AppError(
      `Backup network ${index + 1} has invalid members.`,
      400,
      "INVALID_BACKUP_MEMBERS",
    );
  return value as BackupNetwork;
}

function mappedNetwork(controllerId: string, sourceNetworkId: string) {
  return queryOne<{ restored_network_id: string }>(
    "SELECT restored_network_id FROM restore_mappings WHERE controller_id=? AND source_network_id=?",
    controllerId,
    sourceNetworkId,
  )?.restored_network_id;
}

function saveMapping(
  controllerId: string,
  sourceNetworkId: string,
  restoredNetworkId: string,
) {
  db()
    .prepare(
      `INSERT INTO restore_mappings (controller_id,source_network_id,restored_network_id,updated_at)
       VALUES (?,?,?,?) ON CONFLICT(controller_id,source_network_id)
       DO UPDATE SET restored_network_id=excluded.restored_network_id,updated_at=excluded.updated_at`,
    )
    .run(controllerId, sourceNetworkId, restoredNetworkId, Date.now());
}

export async function POST(request: Request) {
  let userId: string | null = null;
  let controllerId: string | null = null;
  try {
    assertSameOrigin(request);
    const user = await requireUser("backup:write");
    userId = user.id;
    const body = await jsonBody(request, 5 * 1024 * 1024);
    controllerId = requiredText(body.controllerId, "Target controller", 80);
    const backup = body.backup as {
      format?: string;
      version?: number;
      controllers?: Array<{ networks?: unknown[] }>;
    };
    if (
      !backup ||
      backup.format !== "zerotier-control-plane-backup" ||
      backup.version !== 1 ||
      !Array.isArray(backup.controllers)
    )
      throw new AppError("Unsupported backup file.", 400, "INVALID_BACKUP");
    const sourceIndex = body.sourceIndex === undefined ? 0 : Number(body.sourceIndex);
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0)
      throw new AppError(
        "The selected backup source is invalid.",
        400,
        "INVALID_BACKUP_SOURCE",
      );
    const source = backup.controllers[sourceIndex];
    if (!source || !Array.isArray(source.networks))
      throw new AppError(
        "The selected backup source is invalid.",
        400,
        "INVALID_BACKUP_SOURCE",
      );
    const sourceNetworks = source.networks.map(backupNetwork);
    const adapter = adapterFor(controllerId);
    const existing = new Set(
      (await adapter.listNetworks()).map((item) => item.id),
    );
    const plan = sourceNetworks.map((item) => {
      const sourceNetworkId = networkId(item.network.id);
      const mapped = mappedNetwork(controllerId!, sourceNetworkId);
      const restoredNetworkId = existing.has(sourceNetworkId)
        ? sourceNetworkId
        : mapped && existing.has(mapped)
          ? mapped
          : null;
      return {
        networkId: sourceNetworkId,
        restoredNetworkId,
        name: optionalText(item.network.name, 128) || "Unnamed network",
        operation: restoredNetworkId ? "update" : "create",
        members: item.members?.length || 0,
      };
    });
    if (body.dryRun === true) return NextResponse.json({ plan });

    const results: RestoreNetworkResult[] = [];
    for (const [index, item] of sourceNetworks.entries()) {
      const sourceNetworkId = networkId(item.network.id);
      const planned = plan[index];
      const memberResults: RestoreMemberResult[] = [];
      try {
        const restored = planned.restoredNetworkId
          ? await adapter.updateNetwork(
              planned.restoredNetworkId,
              networkPayload(item.network),
            )
          : await adapter.createNetwork(networkPayload(item.network));
        saveMapping(controllerId, sourceNetworkId, restored.id);
        saveNetworkMetadata(controllerId, restored.id, {
          description: optionalText(item.metadata?.description, 4000),
          rulesSource: optionalText(item.metadata?.rulesSource, 200_000),
          templatePolicy:
            item.metadata?.templatePolicy === null ||
            item.metadata?.templatePolicy === undefined
              ? null
              : flowPolicyPayload(item.metadata.templatePolicy),
        });
        if (adapter.capabilities.memberCrud && item.members) {
          for (const entry of item.members) {
            let safeMemberId = "unknown";
            try {
              if (!entry || typeof entry !== "object" || !entry.member)
                throw new AppError(
                  "Member configuration is invalid.",
                  400,
                  "INVALID_BACKUP_MEMBER",
                );
              safeMemberId = memberId(entry.member.id);
              await adapter.updateMember(
                restored.id,
                safeMemberId,
                memberPayload(entry.member),
              );
              saveMemberDescription(
                controllerId,
                restored.id,
                safeMemberId,
                optionalText(entry.description, 4000),
              );
              memberResults.push({
                memberId: safeMemberId,
                ok: true,
                error: null,
              });
            } catch (error) {
              memberResults.push({
                memberId: safeMemberId,
                ok: false,
                error: errorDetail(error),
              });
            }
          }
        }
        const memberFailure = memberResults.some((entry) => !entry.ok);
        results.push({
          sourceNetworkId,
          restoredNetworkId: restored.id,
          operation: planned.operation as "create" | "update",
          ok: !memberFailure,
          error: memberFailure ? "One or more members failed to restore." : null,
          members: memberResults,
        });
      } catch (error) {
        results.push({
          sourceNetworkId,
          restoredNetworkId: planned.restoredNetworkId,
          operation: planned.operation as "create" | "update",
          ok: false,
          error: errorDetail(error),
          members: memberResults,
        });
      }
    }
    const succeeded = results.filter((entry) => entry.ok).length;
    const failed = results.length - succeeded;
    const partial = failed > 0;
    writeAudit({
      userId,
      controllerId,
      action: "backup.restore",
      method: "POST",
      target: controllerId,
      status: partial ? 207 : 200,
      ok: !partial,
      detail: `${succeeded} succeeded, ${failed} failed`,
    });
    return NextResponse.json(
      {
        plan,
        results,
        summary: { total: results.length, succeeded, failed, partial },
      },
      { status: partial ? 207 : 200 },
    );
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      controllerId,
      action: "backup.restore",
      method: "POST",
      target: controllerId || "unknown",
    });
    return jsonError(error);
  }
}
