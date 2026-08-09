import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { adapterFor } from "@/lib/adapters";
import { getController, publicController } from "@/lib/controller-registry";
import { AppError, jsonError } from "@/lib/errors";
import { redactSensitiveValues } from "@/lib/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    await requireUser("controllers:read");
    const { id } = await context.params;
    const controller = getController(id);
    if (!controller) throw new AppError("Controller not found.", 404);
    return NextResponse.json({
      controller: publicController(controller),
      diagnostics: redactSensitiveValues(await adapterFor(id).getDiagnostics()),
    });
  } catch (error) {
    return jsonError(error);
  }
}
