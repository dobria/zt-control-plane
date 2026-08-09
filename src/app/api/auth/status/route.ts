import { NextResponse } from "next/server";
import { currentUser, setupRequired } from "@/lib/auth";
import { permissionsFor } from "@/lib/rbac";
import { getSetupToken } from "@/lib/setup-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  const required = setupRequired();
  if (required) getSetupToken();
  return NextResponse.json({
    setupRequired: required,
    authenticated: Boolean(user),
    user,
    permissions: user ? permissionsFor(user.role) : null,
  });
}
