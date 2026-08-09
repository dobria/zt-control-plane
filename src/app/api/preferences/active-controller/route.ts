import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { jsonError } from "@/lib/errors";
import { setActiveController } from "@/lib/controller-registry";
import { jsonBody, requiredText } from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  let userId: string | null = null;
  let controllerId: string | null = null;
  try {
    assertSameOrigin(request);
    const user = await requireUser("controllers:read");
    userId = user.id;
    const body = await jsonBody(request);
    const id = requiredText(body.controllerId, "Controller ID", 80);
    controllerId = id;
    setActiveController(user.id, id);
    writeAudit({
      userId,
      controllerId,
      action: "controller.activate",
      method: "PUT",
      target: id,
      status: 200,
      ok: true,
    });
    return NextResponse.json({ activeControllerId: id });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      controllerId,
      action: "controller.activate",
      method: "PUT",
      target: controllerId || "unknown",
    });
    return jsonError(error);
  }
}
