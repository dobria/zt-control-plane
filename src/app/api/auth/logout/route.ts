import { NextResponse } from "next/server";
import { assertSameOrigin, currentUser, destroySession } from "@/lib/auth";
import { jsonError } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    await destroySession();
    if (user)
      writeAudit({
        userId: user.id,
        action: "auth.logout",
        method: "POST",
        target: user.email,
        status: 200,
        ok: true,
      });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
