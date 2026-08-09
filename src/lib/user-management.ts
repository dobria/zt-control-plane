import { db, queryOne, type UserRow } from "@/lib/database";
import { AppError } from "@/lib/errors";
import type { AppRole } from "@/lib/types";

export function assertAdminContinuity(
  current: UserRow,
  next: { role?: AppRole; disabled?: boolean; deleting?: boolean },
) {
  const currentlyActiveAdmin = current.role === "admin" && !current.disabled;
  const remainsActiveAdmin =
    !next.deleting &&
    (next.role ?? current.role) === "admin" &&
    !(next.disabled ?? Boolean(current.disabled));
  if (!currentlyActiveAdmin || remainsActiveAdmin) return;

  const activeAdmins = Number(
    queryOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM users WHERE role='admin' AND disabled=0",
    )?.count || 0,
  );
  if (activeAdmins <= 1) {
    throw new AppError(
      "At least one enabled administrator account must remain.",
      409,
      "LAST_ADMIN",
    );
  }
}

export function revokeUserSessions(userId: string) {
  return Number(
    db().prepare("DELETE FROM sessions WHERE user_id=?").run(userId).changes,
  );
}
