import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { controllerAdapterFor } from "@/lib/adapters";
import { getController } from "@/lib/controller-registry";
import { AppError, jsonError } from "@/lib/errors";
import { jsonBody, optionalText, requiredText } from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

function groupAdapter(id: string) {
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
  if (!adapter.listNetworkGroups || !adapter.createNetworkGroup)
    throw new AppError(
      "This controller adapter does not support network groups.",
      409,
      "NETWORK_GROUPS_UNSUPPORTED",
    );
  return adapter;
}

export async function GET(_request: Request, context: Context) {
  try {
    await requireUser("controllers:read");
    const { id } = await context.params;
    const controller = getController(id);
    const groups = await groupAdapter(id).listNetworkGroups!();
    return NextResponse.json({
      groups,
      activeGroupId: controller?.configuration.networkGroupId || null,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, context: Context) {
  let userId: string | null = null;
  let controllerId: string | null = null;
  let target = "unknown";
  try {
    assertSameOrigin(request);
    const user = await requireUser("controllers:write");
    userId = user.id;
    const { id } = await context.params;
    controllerId = id;
    const body = await jsonBody(request);
    const group = await groupAdapter(id).createNetworkGroup!({
      name: requiredText(body.name, "Network group name", 160),
      description: optionalText(body.description, 2000),
    });
    target = group.id;
    writeAudit({
      userId: user.id,
      controllerId: id,
      action: "network-group.create",
      method: "POST",
      target: group.id,
      status: 201,
      ok: true,
    });
    return NextResponse.json({ group }, { status: 201 });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      controllerId,
      action: "network-group.create",
      method: "POST",
      target,
    });
    return jsonError(error);
  }
}
