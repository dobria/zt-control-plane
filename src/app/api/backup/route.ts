import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { adapterFor } from "@/lib/adapters";
import {
  getController,
  getActiveControllerId,
  listPublicControllers,
} from "@/lib/controller-registry";
import { getMemberDescription, getNetworkMetadata } from "@/lib/metadata";
import { AppError, jsonError } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import {
  backupMemberConfiguration,
  backupNetworkConfiguration,
} from "@/lib/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser("backup:read");
    const requested = new URL(request.url).searchParams.get("controllerId");
    const ids = requested
      ? [requested]
      : ([getActiveControllerId(user.id)].filter(Boolean) as string[]);
    const controllers = [];
    for (const id of ids) {
      const record = getController(id);
      if (!record) throw new AppError("Controller not found.", 404);
      const adapter = adapterFor(id);
      const networks = [];
      for (const summary of await adapter.listNetworks()) {
        const network = await adapter.getNetwork(summary.id);
        const members = adapter.capabilities.memberCrud
          ? await adapter.listMembers(summary.id)
          : [];
        networks.push({
          network: backupNetworkConfiguration(network),
          metadata: getNetworkMetadata(id, summary.id),
          members: members.map((member) => ({
            member: backupMemberConfiguration(member),
            description: getMemberDescription(id, summary.id, member.id),
          })),
        });
      }
      controllers.push({
        controller: listPublicControllers().find((item) => item.id === id),
        networks,
      });
    }
    const payload = {
      format: "zerotier-control-plane-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      controllers,
    };
    writeAudit({
      userId: user.id,
      controllerId: ids.length === 1 ? ids[0] : null,
      action: "backup.export",
      method: "GET",
      target: ids.join(","),
      status: 200,
      ok: true,
    });
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json",
        "content-disposition": `attachment; filename="zerotier-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
