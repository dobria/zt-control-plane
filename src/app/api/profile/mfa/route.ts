import { NextResponse } from "next/server";
import {
  assertLoginRateLimit,
  assertSameOrigin,
  clearLoginRateLimit,
  mfaRateLimitBucket,
  recordLoginFailure,
  requireUser,
} from "@/lib/auth";
import { db, queryOne, type UserRow } from "@/lib/database";
import { AppError, jsonError } from "@/lib/errors";
import { disableMfa, mfaStatus, verifySecondFactor } from "@/lib/mfa";
import { verifyPassword } from "@/lib/passwords";
import { jsonBody, requiredText } from "@/lib/validation";
import { revokeUserSessions } from "@/lib/user-management";
import { writeAudit, writeFailureAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(mfaStatus(user.id), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  let userId: string | null = null;
  try {
    assertSameOrigin(request);
    const actor = await requireUser();
    userId = actor.id;
    const bucket = mfaRateLimitBucket(actor.id);
    assertLoginRateLimit([bucket]);
    const body = await jsonBody(request);
    const current = queryOne<UserRow>(
      "SELECT * FROM users WHERE id=?",
      actor.id,
    );
    if (!current) throw new AppError("User not found.", 404, "USER_NOT_FOUND");
    const password = requiredText(body.password, "Current password", 512);
    if (!(await verifyPassword(password, current.password_hash))) {
      recordLoginFailure([bucket]);
      throw new AppError(
        "Current password is incorrect.",
        400,
        "INVALID_CURRENT_PASSWORD",
      );
    }
    const code = requiredText(body.code, "Authenticator or recovery code", 80);
    const method = verifySecondFactor(actor.id, code);
    if (!method) {
      recordLoginFailure([bucket]);
      throw new AppError(
        "The authenticator or recovery code is incorrect.",
        400,
        "INVALID_MFA_CODE",
      );
    }
    if (!disableMfa(actor.id))
      throw new AppError(
        "Two-factor authentication is not enabled.",
        409,
        "MFA_NOT_ENABLED",
      );
    const sessionsRevoked = revokeUserSessions(actor.id);
    clearLoginRateLimit([bucket]);
    db()
      .prepare("DELETE FROM mfa_login_challenges WHERE user_id=?")
      .run(actor.id);
    writeAudit({
      userId: actor.id,
      action: "profile.mfa.disable",
      method: "DELETE",
      target: actor.email,
      status: 200,
      ok: true,
      detail: `${method}; ${sessionsRevoked} session(s) revoked`,
    });
    return NextResponse.json({ ok: true, reauthenticate: true });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      action: "profile.mfa.disable",
      method: "DELETE",
      target: userId || "current user",
    });
    return jsonError(error);
  }
}
