import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { queryOne } from "@/lib/database";
import { adapterFor } from "@/lib/adapters";
import { embeddedZeroTierEnabled } from "@/lib/runtime-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const database = queryOne<{ ok: number }>("SELECT 1 AS ok")?.ok === 1;
    const embedded = embeddedZeroTierEnabled();
    const localToken = !embedded || existsSync(
      /* turbopackIgnore: true */ process.env.ZT_LOCAL_TOKEN_PATH ||
        "/var/lib/zerotier-one/authtoken.secret",
    );
    let embeddedController = !embedded;
    if (embedded && database && localToken) {
      try {
        embeddedController = (await adapterFor("embedded-local").getStatus())
          .online;
      } catch {
        embeddedController = false;
      }
    }
    const ok = database && localToken && embeddedController;
    return NextResponse.json(
      { ok, mode: embedded ? "embedded" : "control-plane" },
      { status: ok ? 200 : 503 },
    );
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
