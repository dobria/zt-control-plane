import { NextResponse } from "next/server";
import {
  assertLoginRateLimit,
  assertSameOrigin,
  clearLoginRateLimit,
  mfaRateLimitBucket,
  recordLoginFailure,
  requireUser,
} from "@/lib/auth";
import { queryOne, type UserRow } from "@/lib/database";
import { AppError, jsonError } from "@/lib/errors";
import { regenerateRecoveryCodes, verifySecondFactor } from "@/lib/mfa";
import { verifyPassword } from "@/lib/passwords";
import { jsonBody, requiredText } from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let userId: string | null = null;
  try {
    assertSameOrigin(request);
    const actor = await requireUser();
    userId = actor.id;
    const bucket = mfaRateLimitBucket(actor.id);
    assertLoginRateLimit([bucket]);
    const current = queryOne<UserRow>(
      "SELECT * FROM users WHERE id=?",
      actor.id,
    );
    if (!current) throw new AppError("User not found.", 404, "USER_NOT_FOUND");
    const body = await jsonBody(request);
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
    if (!verifySecondFactor(actor.id, code)) {
      recordLoginFailure([bucket]);
      throw new AppError(
        "The authenticator or recovery code is incorrect.",
        400,
        "INVALID_MFA_CODE",
      );
    }
    const recoveryCodes = regenerateRecoveryCodes(actor.id);
    clearLoginRateLimit([bucket]);
    writeAudit({
      userId: actor.id,
      action: "profile.mfa.recovery_regenerate",
      method: "POST",
      target: actor.email,
      status: 200,
      ok: true,
    });
    return NextResponse.json(
      { recoveryCodes },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      action: "profile.mfa.recovery_regenerate",
      method: "POST",
      target: userId || "current user",
    });
    return jsonError(error);
  }
}
