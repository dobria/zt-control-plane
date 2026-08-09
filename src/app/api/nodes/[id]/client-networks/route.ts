import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { nodeAdapterFor } from "@/lib/adapters";
import { jsonError } from "@/lib/errors";
import { jsonBody, networkId } from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";
import { clientNetworkPayload } from "@/lib/payloads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    await requireUser("devices:read");
    const { id } = await context.params;
    const adapter = nodeAdapterFor(id);
    const [networks, vrfs] = await Promise.all([
      adapter.listClientNetworks(),
      adapter.listVrfs ? adapter.listVrfs().catch(() => ["main"]) : [],
    ]);
    return NextResponse.json({
      networks,
      vrfs,
      capabilities: adapter.capabilities,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, context: Context) {
  let userId: string | null = null;
  let nodeId: string | null = null;
  let target = "unknown";
  try {
    assertSameOrigin(request);
    const user = await requireUser("devices:write");
    userId = user.id;
    const { id } = await context.params;
    nodeId = id;
    const body = await jsonBody(request);
    const nwid = networkId(body.networkId);
    target = nwid;
    const network = await nodeAdapterFor(id).joinClientNetwork(
      nwid,
      clientNetworkPayload(body),
    );
    writeAudit({
      userId: user.id,
      nodeId: id,
      action: "node.network.join",
      method: "POST",
      target: nwid,
      status: 201,
      ok: true,
    });
    return NextResponse.json({ network }, { status: 201 });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      nodeId,
      action: "node.network.join",
      method: "POST",
      target,
    });
    return jsonError(error);
  }
}
