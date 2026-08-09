import { NextResponse } from "next/server";
import QRCode from "qrcode";
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
import { authenticatorUri, beginMfaEnrollment } from "@/lib/mfa";
import { verifyPassword } from "@/lib/passwords";
import { getAppSettings } from "@/lib/settings";
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
    const enrollment = beginMfaEnrollment(actor.id);
    const uri = authenticatorUri({
      issuer: getAppSettings().workspaceName,
      account: actor.email,
      secret: enrollment.secret,
    });
    const qrCodeDataUrl = await QRCode.toDataURL(uri, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 256,
      color: { dark: "#111111", light: "#ffffff" },
    });
    clearLoginRateLimit([bucket]);
    writeAudit({
      userId: actor.id,
      action: "profile.mfa.setup",
      method: "POST",
      target: actor.email,
      status: 200,
      ok: true,
      detail: "Pending TOTP enrollment created",
    });
    return NextResponse.json(
      {
        secret: enrollment.secret,
        expiresAt: enrollment.expiresAt,
        qrCodeDataUrl,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      action: "profile.mfa.setup",
      method: "POST",
      target: userId || "current user",
    });
    return jsonError(error);
  }
}
