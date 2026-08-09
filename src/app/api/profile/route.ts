import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { db, publicUser, queryOne, type UserRow } from "@/lib/database";
import { AppError, jsonError } from "@/lib/errors";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import {
  booleanValue,
  email,
  jsonBody,
  optionalText,
  requiredText,
  ValidationError,
} from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";
import { revokeUserSessions } from "@/lib/user-management";
import type { PublicUser } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const landingPages = new Set<PublicUser["landingPage"]>([
  "/",
  "/controllers",
  "/nodes",
  "/networks",
  "/diagnostics",
]);

function landingPage(value: unknown) {
  if (!landingPages.has(value as PublicUser["landingPage"]))
    throw new ValidationError("Choose a supported landing page.");
  return value as PublicUser["landingPage"];
}

function profileUser(userId: string) {
  const row = queryOne<UserRow>(
    `SELECT u.*,p.active_controller_id,p.active_node_id,p.landing_page,
     p.reduced_motion,m.enabled AS mfa_enabled
     FROM users u LEFT JOIN user_preferences p ON p.user_id=u.id
     LEFT JOIN user_mfa m ON m.user_id=u.id WHERE u.id=?`,
    userId,
  );
  if (!row) throw new AppError("User not found.", 404, "USER_NOT_FOUND");
  return publicUser(row);
}

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ user: profileUser(user.id) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  let userId: string | null = null;
  try {
    assertSameOrigin(request);
    const actor = await requireUser();
    userId = actor.id;
    const current = queryOne<UserRow>(
      "SELECT * FROM users WHERE id=?",
      actor.id,
    );
    if (!current) throw new AppError("User not found.", 404, "USER_NOT_FOUND");
    const body = await jsonBody(request);
    const nextEmail = email(body.email);
    const displayName = requiredText(body.displayName, "Display name", 120);
    const nextLandingPage = landingPage(body.landingPage);
    const reducedMotion = booleanValue(body.reducedMotion, "Reduced motion");
    const newPassword = optionalText(body.newPassword, 512);
    const emailChanged = nextEmail !== current.email.toLowerCase();
    const sensitiveChange = Boolean(newPassword) || emailChanged;
    let passwordHash = current.password_hash;
    if (sensitiveChange) {
      const currentPassword = requiredText(
        body.currentPassword,
        "Current password",
        512,
      );
      if (!(await verifyPassword(currentPassword, current.password_hash)))
        throw new AppError(
          "Current password is incorrect.",
          400,
          "INVALID_CURRENT_PASSWORD",
        );
      if (newPassword) passwordHash = await hashPassword(newPassword);
    }
    const conflict = queryOne<{ id: string }>(
      "SELECT id FROM users WHERE email=? AND id<>?",
      nextEmail,
      actor.id,
    );
    if (conflict)
      throw new AppError(
        "Another account already uses this email address.",
        409,
        "EMAIL_IN_USE",
      );

    const database = db();
    database.exec("BEGIN IMMEDIATE");
    try {
      database
        .prepare(
          "UPDATE users SET email=?,display_name=?,password_hash=?,updated_at=? WHERE id=?",
        )
        .run(nextEmail, displayName, passwordHash, Date.now(), actor.id);
      database
        .prepare(
          `INSERT INTO user_preferences (user_id,landing_page,reduced_motion)
           VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET
           landing_page=excluded.landing_page,reduced_motion=excluded.reduced_motion`,
        )
        .run(actor.id, nextLandingPage, reducedMotion ? 1 : 0);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    const sessionsRevoked = sensitiveChange ? revokeUserSessions(actor.id) : 0;
    writeAudit({
      userId: actor.id,
      action: "profile.update",
      method: "PUT",
      target: nextEmail,
      status: 200,
      ok: true,
      detail: sensitiveChange
        ? `Sign-in identity changed; ${sessionsRevoked} session(s) revoked`
        : null,
    });
    return NextResponse.json({
      user: profileUser(actor.id),
      reauthenticate: sensitiveChange,
    });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      action: "profile.update",
      method: "PUT",
      target: userId || "current user",
    });
    return jsonError(error);
  }
}
