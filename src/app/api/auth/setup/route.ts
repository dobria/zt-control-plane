import { NextResponse } from "next/server";
import {
  assertSameOrigin,
  createSession,
  newUserId,
  setupRequired,
} from "@/lib/auth";
import { db } from "@/lib/database";
import { jsonError, AppError } from "@/lib/errors";
import { hashPassword } from "@/lib/passwords";
import { email, jsonBody, requiredText } from "@/lib/validation";
import { writeAudit } from "@/lib/audit";
import { verifySetupToken } from "@/lib/setup-token";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!setupRequired())
      throw new AppError(
        "Initial setup has already been completed.",
        409,
        "SETUP_COMPLETE",
      );
    const body = await jsonBody(request);
    if (!verifySetupToken(body.setupToken))
      throw new AppError(
        "The setup token is invalid.",
        403,
        "INVALID_SETUP_TOKEN",
      );
    const userId = newUserId();
    const userEmail = email(body.email);
    const displayName = requiredText(body.displayName, "Display name", 120);
    const password = requiredText(body.password, "Password", 512);
    const passwordHash = await hashPassword(password);
    const now = Date.now();
    const database = db();
    database.exec("BEGIN IMMEDIATE");
    try {
      const count = Number(
        (
          database.prepare("SELECT COUNT(*) AS count FROM users").get() as {
            count: number;
          }
        ).count,
      );
      if (count !== 0)
        throw new AppError(
          "Initial setup has already been completed.",
          409,
          "SETUP_COMPLETE",
        );
      database
        .prepare(
          "INSERT INTO users (id,email,display_name,password_hash,role,disabled,created_at,updated_at) VALUES (?,?,?,?, 'admin',0,?,?)",
        )
        .run(userId, userEmail, displayName, passwordHash, now, now);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    await createSession(userId);
    writeAudit({
      userId,
      action: "auth.setup",
      method: "POST",
      target: userEmail,
      status: 201,
      ok: true,
    });
    return NextResponse.json({ ok: true, landingPage: "/" }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
