import { NextResponse } from "next/server";
import {
  assertSameOrigin,
  assertLoginRateLimit,
  clearLoginRateLimit,
  clearMfaLoginChallenge,
  createMfaLoginChallenge,
  createSession,
  loginRateLimitBuckets,
  recordLoginFailure,
  setupRequired,
} from "@/lib/auth";
import { db, publicUser, queryOne, type UserRow } from "@/lib/database";
import { AppError, jsonError } from "@/lib/errors";
import { dummyPasswordHash, verifyPassword } from "@/lib/passwords";
import { email, jsonBody, requiredText } from "@/lib/validation";
import { writeAudit } from "@/lib/audit";
import { isMfaEnabled } from "@/lib/mfa";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (setupRequired())
      throw new AppError(
        "Complete initial setup first.",
        409,
        "SETUP_REQUIRED",
      );
    const body = await jsonBody(request);
    const userEmail = email(body.email);
    const password = requiredText(body.password, "Password", 512);
    const rateBuckets = loginRateLimitBuckets(request, userEmail);
    assertLoginRateLimit(
      rateBuckets.filter((bucket) => bucket.scope !== "account"),
    );
    const user = queryOne<UserRow>(
      "SELECT * FROM users WHERE email=?",
      userEmail,
    );
    const passwordMatches = await verifyPassword(
      password,
      user?.password_hash || dummyPasswordHash(),
    );
    if (!user || user.disabled || !passwordMatches) {
      let rateLimitError: unknown = null;
      try {
        recordLoginFailure(rateBuckets);
      } catch (error) {
        rateLimitError = error;
      }
      writeAudit({
        userId: user?.id,
        action: "auth.login",
        method: "POST",
        target: userEmail,
        status:
          rateLimitError instanceof AppError ? rateLimitError.status : 401,
        ok: false,
        detail: "Invalid credentials or disabled account",
      });
      if (rateLimitError) throw rateLimitError;
      throw new AppError(
        "Email or password is incorrect.",
        401,
        "INVALID_CREDENTIALS",
      );
    }
    clearLoginRateLimit(
      rateBuckets.filter((bucket) => bucket.scope === "account"),
    );
    if (isMfaEnabled(user.id)) {
      await createMfaLoginChallenge(user.id);
      writeAudit({
        userId: user.id,
        action: "auth.login.mfa_challenge",
        method: "POST",
        target: userEmail,
        status: 202,
        ok: true,
        detail: "Password verified; awaiting second factor",
      });
      return NextResponse.json({ ok: true, mfaRequired: true });
    }
    db()
      .prepare("UPDATE users SET last_login_at=?,updated_at=? WHERE id=?")
      .run(Date.now(), Date.now(), user.id);
    await clearMfaLoginChallenge();
    await createSession(user.id);
    writeAudit({
      userId: user.id,
      action: "auth.login",
      method: "POST",
      target: userEmail,
      status: 200,
      ok: true,
    });
    const preference = queryOne<{
      landing_page: string | null;
      reduced_motion: number | null;
    }>(
      "SELECT landing_page,reduced_motion FROM user_preferences WHERE user_id=?",
      user.id,
    );
    return NextResponse.json({
      ok: true,
      mfaRequired: false,
      landingPage: publicUser({ ...user, ...preference }).landingPage,
    });
  } catch (error) {
    return jsonError(error);
  }
}
