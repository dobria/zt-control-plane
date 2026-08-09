import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { nodeAdapterFor } from "@/lib/adapters";
import { jsonError } from "@/lib/errors";
import { moonId } from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; worldId: string }> };

export async function DELETE(request: Request, context: Context) {
  let userId: string | null = null;
  let nodeId: string | null = null;
  let target = "unknown";
  try {
    assertSameOrigin(request);
    const user = await requireUser("devices:write");
    userId = user.id;
    const params = await context.params;
    nodeId = params.id;
    target = params.worldId;
    const worldId = moonId(params.worldId);
    await nodeAdapterFor(params.id).deorbitMoon(worldId);
    writeAudit({
      userId: user.id,
      nodeId: params.id,
      action: "node.moon.deorbit",
      method: "DELETE",
      target: worldId,
      status: 200,
      ok: true,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      nodeId,
      action: "node.moon.deorbit",
      method: "DELETE",
      target,
    });
    return jsonError(error);
  }
}
