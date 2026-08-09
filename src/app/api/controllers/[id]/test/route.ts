import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { adapterFor } from "@/lib/adapters";
import {
  getController,
  updateControllerStatus,
} from "@/lib/controller-registry";
import { AppError, jsonError } from "@/lib/errors";
import { writeAudit, writeFailureAudit } from "@/lib/audit";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  let userId: string | null = null;
  let controllerId: string | null = null;
  let canUpdateStatus = false;
  try {
    assertSameOrigin(request);
    const user = await requireUser("controllers:write");
    userId = user.id;
    const { id } = await context.params;
    controllerId = id;
    if (!getController(id))
      throw new AppError("Controller not found.", 404, "CONTROLLER_NOT_FOUND");
    canUpdateStatus = true;
    const status = await adapterFor(id).getStatus();
    updateControllerStatus(id, status);
    writeAudit({
      userId,
      controllerId: id,
      action: "controller.test",
      method: "POST",
      target: id,
      status: 200,
      ok: true,
    });
    return NextResponse.json({ status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Connection test failed.";
    if (canUpdateStatus && controllerId)
      updateControllerStatus(controllerId, null, message);
    writeFailureAudit(error, {
      userId,
      controllerId,
      action: "controller.test",
      method: "POST",
      target: controllerId || "unknown",
      detail: message,
    });
    return jsonError(error);
  }
}
