import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { adapterFor } from "@/lib/adapters";
import {
  deleteNetworkMetadata,
  getNetworkMetadata,
  saveNetworkMetadata,
} from "@/lib/metadata";
import { jsonError } from "@/lib/errors";
import {
  jsonBody,
  networkId as validateNetworkId,
  optionalText,
} from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";
import { networkPayload } from "@/lib/payloads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; networkId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    await requireUser("networks:read");
    const params = await context.params;
    const networkId = validateNetworkId(params.networkId);
    const adapter = adapterFor(params.id);
    const [network, members] = await Promise.all([
      adapter.getNetwork(networkId),
      adapter.capabilities.memberCrud
        ? adapter.listMembers(networkId)
        : Promise.resolve([]),
    ]);
    const metadata = getNetworkMetadata(params.id, networkId);
    return NextResponse.json({
      network: {
        ...network,
        description: metadata.description || String(network.description || ""),
      },
      members,
      metadata: {
        ...metadata,
        rulesSource:
          metadata.rulesSource || String(network.rulesSource || ""),
      },
      capabilities: adapter.capabilities,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request, context: Context) {
  let userId: string | null = null;
  let controllerId: string | null = null;
  let target = "unknown";
  try {
    assertSameOrigin(request);
    const user = await requireUser("networks:write");
    userId = user.id;
    const params = await context.params;
    controllerId = params.id;
    const networkId = validateNetworkId(params.networkId);
    target = networkId;
    const body = await jsonBody(request);
    const adapter = adapterFor(params.id);
    const network = await adapter.updateNetwork(
      networkId,
      networkPayload(body),
    );
    if (body.description !== undefined)
      saveNetworkMetadata(params.id, networkId, {
        description: optionalText(body.description, 4000),
      });
    writeAudit({
      userId: user.id,
      controllerId: params.id,
      action: "network.update",
      method: "PUT",
      target: networkId,
      status: 200,
      ok: true,
    });
    return NextResponse.json({
      network: {
        ...network,
        description:
          getNetworkMetadata(params.id, networkId).description ||
          String(network.description || ""),
      },
    });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      controllerId,
      action: "network.update",
      method: "PUT",
      target,
    });
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  let userId: string | null = null;
  let controllerId: string | null = null;
  let target = "unknown";
  try {
    assertSameOrigin(request);
    const user = await requireUser("networks:write");
    userId = user.id;
    const params = await context.params;
    controllerId = params.id;
    const networkId = validateNetworkId(params.networkId);
    target = networkId;
    await adapterFor(params.id).deleteNetwork(networkId);
    deleteNetworkMetadata(params.id, networkId);
    writeAudit({
      userId: user.id,
      controllerId: params.id,
      action: "network.delete",
      method: "DELETE",
      target: networkId,
      status: 200,
      ok: true,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      controllerId,
      action: "network.delete",
      method: "DELETE",
      target,
    });
    return jsonError(error);
  }
}
