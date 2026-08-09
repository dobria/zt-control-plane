import { auditCsv, parseAuditRequest, writeAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { jsonError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser("audit:export");
    const { filters } = parseAuditRequest(new URL(request.url).searchParams);
    writeAudit({
      userId: user.id,
      action: "audit.export",
      method: "GET",
      target: "Filtered audit log",
      status: 200,
      ok: true,
    });
    const iterator = auditCsv(filters)[Symbol.iterator]();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      },
      cancel() {
        iterator.return?.(undefined);
      },
    });
    return new Response(body, {
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="audit-log-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`,
        "content-type": "text/csv; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
