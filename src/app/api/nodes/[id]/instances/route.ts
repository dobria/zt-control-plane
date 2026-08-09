import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { nodeAdapterFor } from "@/lib/adapters";
import { AppError, jsonError } from "@/lib/errors";
import { jsonBody } from "@/lib/validation";
import { routerOsInstancePayload } from "@/lib/routeros-instance";
import { writeAudit, writeFailureAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    await requireUser("devices:read");
    const { id } = await context.params;
    const adapter = nodeAdapterFor(id);
    if (!adapter.listInstances)
      throw new AppError(
        "ZeroTier instance management is available only for RouterOS nodes.",
        409,
        "INSTANCE_API_UNAVAILABLE",
      );
    const [instances, hostInterfaces] = await Promise.all([
      adapter.listInstances(),
      adapter.listHostInterfaces
        ? adapter.listHostInterfaces().catch(() => [])
        : [],
    ]);
    return NextResponse.json({ instances, hostInterfaces });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, context: Context) {
  let userId: string | null = null;
  let nodeId: string | null = null;
  let target = "new RouterOS ZeroTier instance";
  try {
    assertSameOrigin(request);
    const user = await requireUser("controllers:write");
    userId = user.id;
    const { id } = await context.params;
    nodeId = id;
    const input = routerOsInstancePayload(await jsonBody(request));
    target = input.name;
    const adapter = nodeAdapterFor(id);
    if (!adapter.createInstance)
      throw new AppError(
        "ZeroTier instance management is available only for RouterOS nodes.",
        409,
        "INSTANCE_API_UNAVAILABLE",
      );
    const instance = await adapter.createInstance(input);
    writeAudit({
      userId,
      nodeId,
      action: "routeros.instance.create",
      method: "POST",
      target: instance.name,
      status: 201,
      ok: true,
    });
    return NextResponse.json({ instance }, { status: 201 });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      nodeId,
      action: "routeros.instance.create",
      method: "POST",
      target,
    });
    return jsonError(error);
  }
}
