import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { adapterFor } from "@/lib/adapters";
import { getNetworkMetadata, saveNetworkMetadata } from "@/lib/metadata";
import { jsonError } from "@/lib/errors";
import { jsonBody, optionalText } from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";
import { networkPayload } from "@/lib/payloads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    await requireUser("networks:read");
    const { id } = await context.params;
    const adapter = adapterFor(id);
    const [networks, instances] = await Promise.all([
      adapter.listNetworks(),
      adapter.listInstances ? adapter.listInstances() : [],
    ]);
    const enriched = await Promise.all(
      networks.map(async (network) => {
        const metadata = getNetworkMetadata(id, network.id);
        let memberCount = network.memberCount;
        if (memberCount === undefined && adapter.capabilities.memberCrud) {
          try {
            memberCount = (await adapter.listMembers(network.id)).length;
          } catch {
            memberCount = 0;
          }
        }
        return {
          ...network,
          description:
            metadata.description || String(network.description || ""),
          memberCount: memberCount || 0,
        };
      }),
    );
    return NextResponse.json({
      networks: enriched,
      instances,
      capabilities: adapter.capabilities,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, context: Context) {
  let userId: string | null = null;
  let controllerId: string | null = null;
  try {
    assertSameOrigin(request);
    const user = await requireUser("networks:write");
    userId = user.id;
    const { id } = await context.params;
    controllerId = id;
    const body = await jsonBody(request);
    const adapter = adapterFor(id);
    const network = await adapter.createNetwork(networkPayload(body));
    const description = optionalText(body.description, 4000);
    saveNetworkMetadata(id, network.id, { description });
    writeAudit({
      userId: user.id,
      controllerId: id,
      action: "network.create",
      method: "POST",
      target: network.id,
      status: 201,
      ok: true,
    });
    return NextResponse.json(
      { network: { ...network, description } },
      { status: 201 },
    );
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      controllerId,
      action: "network.create",
      method: "POST",
      target: controllerId || "unknown",
    });
    return jsonError(error);
  }
}
