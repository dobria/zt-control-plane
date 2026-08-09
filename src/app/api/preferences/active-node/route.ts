import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { setActiveNode } from "@/lib/node-registry";
import { jsonError } from "@/lib/errors";
import { jsonBody, requiredText } from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  let userId: string | null = null;
  let nodeId: string | null = null;
  try {
    assertSameOrigin(request);
    const user = await requireUser("devices:read");
    userId = user.id;
    const body = await jsonBody(request);
    nodeId = requiredText(body.nodeId, "Managed node", 160);
    setActiveNode(user.id, nodeId);
    writeAudit({
      userId,
      nodeId,
      action: "node.activate",
      method: "PUT",
      target: nodeId,
      status: 200,
      ok: true,
    });
    return NextResponse.json({ ok: true, activeNodeId: nodeId });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      nodeId,
      action: "node.activate",
      method: "PUT",
      target: nodeId || "unknown",
    });
    return jsonError(error);
  }
}
