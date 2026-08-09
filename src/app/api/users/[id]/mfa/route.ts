import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { db, queryOne, type UserRow } from "@/lib/database";
import { AppError, jsonError } from "@/lib/errors";
import { disableMfa } from "@/lib/mfa";
import { revokeUserSessions } from "@/lib/user-management";
import { writeAudit, writeFailureAudit } from "@/lib/audit";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Context) {
  let actorId: string | null = null;
  let target = "unknown user";
  try {
    assertSameOrigin(request);
    const actor = await requireUser("users:write");
    actorId = actor.id;
    const { id } = await context.params;
    if (id === actor.id)
      throw new AppError(
        "Reset your own two-factor authentication from your profile.",
        409,
        "SELF_MFA_RESET",
      );
    const user = queryOne<UserRow>("SELECT * FROM users WHERE id=?", id);
    if (!user) throw new AppError("User not found.", 404, "USER_NOT_FOUND");
    target = user.email;
    if (!disableMfa(id))
      throw new AppError(
        "Two-factor authentication is not enabled for this user.",
        409,
        "MFA_NOT_ENABLED",
      );
    const sessionsRevoked = revokeUserSessions(id);
    db().prepare("DELETE FROM mfa_login_challenges WHERE user_id=?").run(id);
    writeAudit({
      userId: actor.id,
      action: "user.mfa.reset",
      method: "DELETE",
      target: user.email,
      status: 200,
      ok: true,
      detail: `${sessionsRevoked} session(s) revoked`,
    });
    return NextResponse.json({ ok: true, sessionsRevoked });
  } catch (error) {
    writeFailureAudit(error, {
      userId: actorId,
      action: "user.mfa.reset",
      method: "DELETE",
      target,
    });
    return jsonError(error);
  }
}
