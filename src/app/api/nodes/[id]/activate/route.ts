import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { setActiveNode } from "@/lib/node-registry";
import { jsonError } from "@/lib/errors";
import { writeAudit, writeFailureAudit } from "@/lib/audit";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  let userId: string | null = null;
  let nodeId: string | null = null;
  try {
    assertSameOrigin(request);
    const user = await requireUser("devices:read");
    userId = user.id;
    const { id } = await context.params;
    nodeId = id;
    setActiveNode(user.id, id);
    writeAudit({
      userId: user.id,
      nodeId: id,
      action: "node.activate",
      method: "POST",
      target: id,
      status: 200,
      ok: true,
    });
    return NextResponse.json({ ok: true, activeNodeId: id });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      nodeId,
      action: "node.activate",
      method: "POST",
      target: nodeId || "unknown",
    });
    return jsonError(error);
  }
}
