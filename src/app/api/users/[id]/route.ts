import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { db, queryOne, type UserRow } from "@/lib/database";
import { AppError, jsonError } from "@/lib/errors";
import { hashPassword } from "@/lib/passwords";
import {
  booleanValue,
  email,
  jsonBody,
  optionalText,
  requiredText,
  role,
} from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";
import {
  assertAdminContinuity,
  revokeUserSessions,
} from "@/lib/user-management";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  let actorId: string | null = null;
  let target = "unknown";
  try {
    assertSameOrigin(request);
    const actor = await requireUser("users:write");
    actorId = actor.id;
    const { id } = await context.params;
    target = id;
    const current = queryOne<UserRow>("SELECT * FROM users WHERE id=?", id);
    if (!current) throw new AppError("User not found.", 404, "USER_NOT_FOUND");
    const body = await jsonBody(request);
    const disabled =
      id === actor.id ? false : booleanValue(body.disabled, "Disabled", false);
    const nextRole = role(body.role);
    assertAdminContinuity(current, { role: nextRole, disabled });
    const password = optionalText(body.password, 512);
    const passwordHash = password
      ? await hashPassword(password)
      : current.password_hash;
    db()
      .prepare(
        "UPDATE users SET email=?,display_name=?,password_hash=?,role=?,disabled=?,updated_at=? WHERE id=?",
      )
      .run(
        email(body.email),
        requiredText(body.displayName, "Display name", 120),
        passwordHash,
        nextRole,
        disabled ? 1 : 0,
        Date.now(),
        id,
      );
    const sessionsRevoked = disabled || password ? revokeUserSessions(id) : 0;
    writeAudit({
      userId: actor.id,
      action: "user.update",
      method: "PUT",
      target: id,
      status: 200,
      ok: true,
      detail:
        disabled || password
          ? `${password ? "Password changed; " : ""}${sessionsRevoked} session(s) revoked`
          : null,
    });
    return NextResponse.json({ ok: true, sessionsRevoked });
  } catch (error) {
    writeFailureAudit(error, {
      userId: actorId,
      action: "user.update",
      method: "PUT",
      target,
    });
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  let actorId: string | null = null;
  let target = "unknown";
  try {
    assertSameOrigin(request);
    const actor = await requireUser("users:write");
    actorId = actor.id;
    const { id } = await context.params;
    target = id;
    if (id === actor.id)
      throw new AppError(
        "You cannot delete your own account.",
        409,
        "SELF_DELETE",
      );
    const current = queryOne<UserRow>("SELECT * FROM users WHERE id=?", id);
    if (!current) throw new AppError("User not found.", 404, "USER_NOT_FOUND");
    assertAdminContinuity(current, { deleting: true });
    target = current.email;
    db().prepare("DELETE FROM users WHERE id=?").run(id);
    writeAudit({
      userId: actor.id,
      action: "user.delete",
      method: "DELETE",
      target: current.email,
      status: 200,
      ok: true,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    writeFailureAudit(error, {
      userId: actorId,
      action: "user.delete",
      method: "DELETE",
      target,
    });
    return jsonError(error);
  }
}
