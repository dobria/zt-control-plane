import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { adapterFor } from "@/lib/adapters";
import { updateControllerStatus } from "@/lib/controller-registry";
import { jsonError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  try {
    await requireUser("controllers:read");
    const status = await adapterFor(id).getStatus();
    updateControllerStatus(id, status);
    return NextResponse.json({ status });
  } catch (error) {
    updateControllerStatus(
      id,
      null,
      error instanceof Error ? error.message : "Status check failed.",
    );
    return jsonError(error);
  }
}
