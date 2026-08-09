import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listAuditPage, parseAuditRequest } from "@/lib/audit";
import { jsonError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireUser("audit:read");
    const { filters, page, pageSize } = parseAuditRequest(
      new URL(request.url).searchParams,
    );
    return NextResponse.json(listAuditPage(filters, page, pageSize), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
