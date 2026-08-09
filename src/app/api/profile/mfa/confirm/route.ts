import { NextResponse } from "next/server";
import {
  assertLoginRateLimit,
  assertSameOrigin,
  clearLoginRateLimit,
  mfaRateLimitBucket,
  recordLoginFailure,
  requireUser,
} from "@/lib/auth";
import { confirmMfaEnrollment } from "@/lib/mfa";
import { AppError, jsonError } from "@/lib/errors";
import { jsonBody, requiredText } from "@/lib/validation";
import { revokeUserSessions } from "@/lib/user-management";
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
    const body = await jsonBody(request);
    const code = requiredText(body.code, "Authenticator code", 12).replace(
      /\s/g,
      "",
    );
    let recoveryCodes: string[];
    try {
      recoveryCodes = confirmMfaEnrollment(actor.id, code);
    } catch (error) {
      if (error instanceof AppError && error.code === "INVALID_MFA_CODE")
        recordLoginFailure([bucket]);
      throw error;
    }
    clearLoginRateLimit([bucket]);
    const sessionsRevoked = revokeUserSessions(actor.id);
    writeAudit({
      userId: actor.id,
      action: "profile.mfa.enable",
      method: "POST",
      target: actor.email,
      status: 200,
      ok: true,
      detail: `${sessionsRevoked} session(s) revoked`,
    });
    return NextResponse.json(
      { recoveryCodes, reauthenticate: true },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      action: "profile.mfa.enable",
      method: "POST",
      target: userId || "current user",
    });
    return jsonError(error);
  }
}
