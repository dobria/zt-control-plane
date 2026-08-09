import { NextResponse } from "next/server";
import {
  assertLoginRateLimit,
  assertSameOrigin,
  clearLoginRateLimit,
  clearMfaLoginChallenge,
  createSession,
  currentMfaLoginChallenge,
  mfaRateLimitBucket,
  recordLoginFailure,
  recordMfaChallengeFailure,
} from "@/lib/auth";
import { db, publicUser, queryOne, type UserRow } from "@/lib/database";
import { AppError, jsonError } from "@/lib/errors";
import { verifySecondFactor } from "@/lib/mfa";
import { jsonBody, requiredText } from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let userId: string | null = null;
  try {
    assertSameOrigin(request);
    const challenge = await currentMfaLoginChallenge();
    if (!challenge)
      throw new AppError(
        "The two-factor sign-in session has expired. Enter your password again.",
        401,
        "MFA_CHALLENGE_REQUIRED",
      );
    userId = challenge.userId;
    const bucket = mfaRateLimitBucket(userId);
    assertLoginRateLimit([bucket]);
    const body = await jsonBody(request);
    const code = requiredText(body.code, "Authenticator or recovery code", 80);
    const method = verifySecondFactor(userId, code);
    if (!method) {
      await recordMfaChallengeFailure();
      recordLoginFailure([bucket]);
      throw new AppError(
        "The authenticator or recovery code is incorrect.",
        401,
        "INVALID_MFA_CODE",
      );
    }

    const user = queryOne<
      UserRow & {
        landing_page: string | null;
        reduced_motion: number | null;
        mfa_enabled: number | null;
      }
    >(
      `SELECT u.*,p.landing_page,p.reduced_motion,m.enabled AS mfa_enabled
       FROM users u LEFT JOIN user_preferences p ON p.user_id=u.id
       LEFT JOIN user_mfa m ON m.user_id=u.id WHERE u.id=? AND u.disabled=0`,
      userId,
    );
    if (!user)
      throw new AppError("Authentication required.", 401, "AUTH_REQUIRED");
    clearLoginRateLimit([bucket]);
    await clearMfaLoginChallenge();
    db()
      .prepare("UPDATE users SET last_login_at=?,updated_at=? WHERE id=?")
      .run(Date.now(), Date.now(), user.id);
    await createSession(user.id);
    writeAudit({
      userId: user.id,
      action: "auth.login.mfa",
      method: "POST",
      target: user.email,
      status: 200,
      ok: true,
      detail: method === "recovery" ? "Recovery code used" : "TOTP verified",
    });
    return NextResponse.json({
      ok: true,
      landingPage: publicUser(user).landingPage,
    });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      action: "auth.login.mfa",
      method: "POST",
      target: userId || "MFA challenge",
    });
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    await clearMfaLoginChallenge();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
