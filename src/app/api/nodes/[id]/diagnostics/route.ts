import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { nodeAdapterFor } from "@/lib/adapters";
import { getNode, publicNode } from "@/lib/node-registry";
import { AppError, jsonError } from "@/lib/errors";
import { redactSensitiveValues } from "@/lib/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    await requireUser("devices:read");
    const { id } = await context.params;
    const node = getNode(id);
    if (!node) throw new AppError("Managed node not found.", 404);
    return NextResponse.json({
      node: publicNode(node),
      diagnostics: redactSensitiveValues(
        await nodeAdapterFor(id).getDiagnostics(),
      ),
    });
  } catch (error) {
    return jsonError(error);
  }
}
