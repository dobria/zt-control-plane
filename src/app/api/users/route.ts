import { NextResponse } from "next/server";
import { assertSameOrigin, newUserId, requireUser } from "@/lib/auth";
import { db, publicUser, queryAll, type UserRow } from "@/lib/database";
import { jsonError } from "@/lib/errors";
import { hashPassword } from "@/lib/passwords";
import {
  booleanValue,
  email,
  jsonBody,
  requiredText,
  role,
} from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUser("users:write");
    const users = queryAll<
      UserRow & {
        active_controller_id: string | null;
        active_node_id: string | null;
        landing_page: string | null;
        reduced_motion: number | null;
        mfa_enabled: number | null;
      }
    >(
      `SELECT u.*,p.active_controller_id,p.active_node_id,p.landing_page,
       p.reduced_motion,m.enabled AS mfa_enabled
       FROM users u LEFT JOIN user_preferences p ON p.user_id=u.id
       LEFT JOIN user_mfa m ON m.user_id=u.id
       ORDER BY u.display_name COLLATE NOCASE`,
    ).map(publicUser);
    return NextResponse.json({ users });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  let actorId: string | null = null;
  let target = "new user";
  try {
    assertSameOrigin(request);
    const actor = await requireUser("users:write");
    actorId = actor.id;
    const body = await jsonBody(request);
    const id = newUserId();
    const now = Date.now();
    const userEmail = email(body.email);
    target = userEmail;
    const displayName = requiredText(body.displayName, "Display name", 120);
    const passwordHash = await hashPassword(
      requiredText(body.password, "Password", 512),
    );
    const userRole = role(body.role);
    db()
      .prepare(
        "INSERT INTO users (id,email,display_name,password_hash,role,disabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        userEmail,
        displayName,
        passwordHash,
        userRole,
        booleanValue(body.disabled, "Disabled", false) ? 1 : 0,
        now,
        now,
      );
    writeAudit({
      userId: actor.id,
      action: "user.create",
      method: "POST",
      target: userEmail,
      status: 201,
      ok: true,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    writeFailureAudit(error, {
      userId: actorId,
      action: "user.create",
      method: "POST",
      target,
    });
    return jsonError(error);
  }
}
