import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { nodeAdapterFor } from "@/lib/adapters";
import { jsonError } from "@/lib/errors";
import { jsonBody, moonId } from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    await requireUser("devices:read");
    const { id } = await context.params;
    const adapter = nodeAdapterFor(id);
    const [moons, peers] = await Promise.all([
      adapter.capabilities.moons ? adapter.listMoons() : [],
      adapter.capabilities.peers ? adapter.listPeers() : [],
    ]);
    return NextResponse.json({
      moons,
      peers,
      planetRoots: peers.filter((peer) => peer.role === "PLANET"),
      supported: adapter.capabilities.moons,
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
    const worldId = moonId(body.worldId);
    target = worldId;
    const seed = moonId(body.seed, "Seed node ID");
    const moon = await nodeAdapterFor(id).orbitMoon(worldId, seed);
    writeAudit({
      userId: user.id,
      nodeId: id,
      action: "node.moon.orbit",
      method: "POST",
      target: worldId,
      status: 201,
      ok: true,
    });
    return NextResponse.json({ moon }, { status: 201 });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      nodeId,
      action: "node.moon.orbit",
      method: "POST",
      target,
    });
    return jsonError(error);
  }
}
