import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { nodeAdapterFor } from "@/lib/adapters";
import { AppError, jsonError } from "@/lib/errors";
import { jsonBody, routerOsRecordId } from "@/lib/validation";
import { routerOsInstancePayload } from "@/lib/routeros-instance";
import { writeAudit, writeFailureAudit } from "@/lib/audit";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; instanceId: string }> };

export async function PUT(request: Request, context: Context) {
  let userId: string | null = null;
  let nodeId: string | null = null;
  let target = "unknown RouterOS ZeroTier instance";
  try {
    assertSameOrigin(request);
    const user = await requireUser("controllers:write");
    userId = user.id;
    const params = await context.params;
    nodeId = params.id;
    const instanceId = routerOsRecordId(params.instanceId);
    const input = routerOsInstancePayload(await jsonBody(request));
    target = input.name;
    const adapter = nodeAdapterFor(params.id);
    if (!adapter.updateInstance)
      throw new AppError(
        "ZeroTier instance management is available only for RouterOS nodes.",
        409,
        "INSTANCE_API_UNAVAILABLE",
      );
    const instance = await adapter.updateInstance(instanceId, input);
    writeAudit({
      userId,
      nodeId,
      action: "routeros.instance.update",
      method: "PUT",
      target: instance.name,
      status: 200,
      ok: true,
    });
    return NextResponse.json({ instance });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      nodeId,
      action: "routeros.instance.update",
      method: "PUT",
      target,
    });
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  let userId: string | null = null;
  let nodeId: string | null = null;
  let target = "unknown RouterOS ZeroTier instance";
  try {
    assertSameOrigin(request);
    const user = await requireUser("controllers:write");
    userId = user.id;
    const params = await context.params;
    nodeId = params.id;
    const instanceId = routerOsRecordId(params.instanceId);
    target = instanceId;
    const adapter = nodeAdapterFor(params.id);
    if (!adapter.deleteInstance)
      throw new AppError(
        "ZeroTier instance management is available only for RouterOS nodes.",
        409,
        "INSTANCE_API_UNAVAILABLE",
      );
    await adapter.deleteInstance(instanceId);
    writeAudit({
      userId,
      nodeId,
      action: "routeros.instance.delete",
      method: "DELETE",
      target,
      status: 200,
      ok: true,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      nodeId,
      action: "routeros.instance.delete",
      method: "DELETE",
      target,
    });
    return jsonError(error);
  }
}
