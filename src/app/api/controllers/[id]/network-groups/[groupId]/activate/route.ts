import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { controllerAdapterFor } from "@/lib/adapters";
import {
  getController,
  publicController,
  updateController,
} from "@/lib/controller-registry";
import { AppError, jsonError } from "@/lib/errors";
import { requiredText } from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; groupId: string }> };

export async function POST(request: Request, context: Context) {
  let userId: string | null = null;
  let controllerId: string | null = null;
  let target = "unknown";
  try {
    assertSameOrigin(request);
    const user = await requireUser("controllers:write");
    userId = user.id;
    const { id, groupId } = await context.params;
    controllerId = id;
    target = groupId;
    const safeGroupId = requiredText(groupId, "Network group ID", 160);
    const current = getController(id);
    if (!current)
      throw new AppError("Controller not found.", 404, "CONTROLLER_NOT_FOUND");
    if (current.type !== "central_v2")
      throw new AppError(
        "Network groups are available only for New ZeroTier Central.",
        409,
        "NETWORK_GROUPS_UNSUPPORTED",
      );
    const adapter = controllerAdapterFor(id);
    if (!adapter.getNetworkGroup)
      throw new AppError(
        "This controller adapter does not support network groups.",
        409,
        "NETWORK_GROUPS_UNSUPPORTED",
      );
    await adapter.getNetworkGroup(safeGroupId);
    const controller = updateController(id, {
      name: current.name,
      baseUrl: current.baseUrl,
      configuration: {
        ...current.configuration,
        networkGroupId: safeGroupId,
      },
      enabled: current.enabled,
      tlsVerify: current.tlsVerify,
    });
    writeAudit({
      userId: user.id,
      controllerId: id,
      action: "network-group.activate",
      method: "POST",
      target: safeGroupId,
      status: 200,
      ok: true,
    });
    return NextResponse.json({ controller: publicController(controller) });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      controllerId,
      action: "network-group.activate",
      method: "POST",
      target,
    });
    return jsonError(error);
  }
}
