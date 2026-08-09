import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { nodeAdapterFor } from "@/lib/adapters";
import { getNode, updateNodeStatus } from "@/lib/node-registry";
import { AppError, jsonError } from "@/lib/errors";
import { writeAudit, writeFailureAudit } from "@/lib/audit";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  let userId: string | null = null;
  let nodeId: string | null = null;
  let canUpdateStatus = false;
  try {
    assertSameOrigin(request);
    const user = await requireUser("controllers:write");
    userId = user.id;
    const { id } = await context.params;
    nodeId = id;
    if (!getNode(id)) throw new AppError("Managed node not found.", 404);
    canUpdateStatus = true;
    const status = await nodeAdapterFor(id).getStatus();
    updateNodeStatus(id, status);
    writeAudit({
      userId,
      nodeId: id,
      action: "node.test",
      method: "POST",
      target: id,
      status: 200,
      ok: true,
    });
    return NextResponse.json({ status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection test failed.";
    if (canUpdateStatus && nodeId) updateNodeStatus(nodeId, null, message);
    writeFailureAudit(error, {
      userId,
      nodeId,
      action: "node.test",
      method: "POST",
      target: nodeId || "unknown",
      detail: message,
    });
    return jsonError(error);
  }
}
