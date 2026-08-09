import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { jsonError } from "@/lib/errors";
import { setActiveController } from "@/lib/controller-registry";
import { writeAudit, writeFailureAudit } from "@/lib/audit";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  let userId: string | null = null;
  let controllerId: string | null = null;
  try {
    assertSameOrigin(request);
    const user = await requireUser("controllers:read");
    userId = user.id;
    const { id } = await context.params;
    controllerId = id;
    setActiveController(user.id, id);
    writeAudit({
      userId: user.id,
      controllerId: id,
      action: "controller.activate",
      method: "POST",
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
      method: "POST",
      target: controllerId || "unknown",
    });
    return jsonError(error);
  }
}
