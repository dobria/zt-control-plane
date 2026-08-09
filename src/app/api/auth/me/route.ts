import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listPublicControllers } from "@/lib/controller-registry";
import { listPublicNodes } from "@/lib/node-registry";
import { jsonError } from "@/lib/errors";
import { permissionsFor } from "@/lib/rbac";
import { getPublicAppSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({
      user,
      permissions: permissionsFor(user.role),
      controllers: listPublicControllers(),
      nodes: listPublicNodes(),
      settings: getPublicAppSettings(),
    });
  } catch (error) {
    return jsonError(error);
  }
}
