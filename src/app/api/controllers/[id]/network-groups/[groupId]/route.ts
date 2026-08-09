import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { controllerAdapterFor } from "@/lib/adapters";
import { getController, updateController } from "@/lib/controller-registry";
import { AppError, jsonError } from "@/lib/errors";
import { jsonBody, optionalText, requiredText } from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; groupId: string }> };

function groupContext(id: string) {
  const controller = getController(id);
  if (!controller)
    throw new AppError("Controller not found.", 404, "CONTROLLER_NOT_FOUND");
  if (controller.type !== "central_v2")
    throw new AppError(
      "Network groups are available only for New ZeroTier Central.",
      409,
      "NETWORK_GROUPS_UNSUPPORTED",
    );
  const adapter = controllerAdapterFor(id);
  if (
    !adapter.getNetworkGroup ||
    !adapter.updateNetworkGroup ||
    !adapter.deleteNetworkGroup
  )
    throw new AppError(
      "This controller adapter does not support network groups.",
      409,
      "NETWORK_GROUPS_UNSUPPORTED",
    );
  return { controller, adapter };
}

export async function GET(_request: Request, context: Context) {
  try {
    await requireUser("controllers:read");
    const { id, groupId } = await context.params;
    const { adapter } = groupContext(id);
    return NextResponse.json({
      group: await adapter.getNetworkGroup!(
        requiredText(groupId, "Network group ID", 160),
      ),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request, context: Context) {
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
    const body = await jsonBody(request);
    const { adapter } = groupContext(id);
    const group = await adapter.updateNetworkGroup!(
      requiredText(groupId, "Network group ID", 160),
      {
        name: requiredText(body.name, "Network group name", 160),
        description: optionalText(body.description, 2000),
      },
    );
    writeAudit({
      userId: user.id,
      controllerId: id,
      action: "network-group.update",
      method: "PUT",
      target: groupId,
      status: 200,
      ok: true,
    });
    return NextResponse.json({ group });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      controllerId,
      action: "network-group.update",
      method: "PUT",
      target,
    });
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
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
    const { controller, adapter } = groupContext(id);
    const safeGroupId = requiredText(groupId, "Network group ID", 160);
    await adapter.deleteNetworkGroup!(safeGroupId);
    if (controller.configuration.networkGroupId === safeGroupId) {
      updateController(id, {
        name: controller.name,
        baseUrl: controller.baseUrl,
        configuration: {
          ...controller.configuration,
          networkGroupId: "",
        },
        enabled: controller.enabled,
        tlsVerify: controller.tlsVerify,
      });
    }
    writeAudit({
      userId: user.id,
      controllerId: id,
      action: "network-group.delete",
      method: "DELETE",
      target: safeGroupId,
      status: 200,
      ok: true,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      controllerId,
      action: "network-group.delete",
      method: "DELETE",
      target,
    });
    return jsonError(error);
  }
}
