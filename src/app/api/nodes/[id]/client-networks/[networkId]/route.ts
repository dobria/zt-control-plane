import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { nodeAdapterFor } from "@/lib/adapters";
import { jsonError } from "@/lib/errors";
import {
  jsonBody,
  networkId as validateNetworkId,
  optionalText,
} from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";
import { clientNetworkPayload } from "@/lib/payloads";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; networkId: string }> };

export async function PUT(request: Request, context: Context) {
  let userId: string | null = null;
  let nodeId: string | null = null;
  let target = "unknown";
  try {
    assertSameOrigin(request);
    const user = await requireUser("devices:write");
    userId = user.id;
    const params = await context.params;
    nodeId = params.id;
    const networkId = validateNetworkId(params.networkId);
    target = networkId;
    const body = await jsonBody(request);
    const network = await nodeAdapterFor(params.id).updateClientNetwork(
      networkId,
      clientNetworkPayload(body),
    );
    writeAudit({
      userId: user.id,
      nodeId: params.id,
      action: "node.network.update",
      method: "PUT",
      target: networkId,
      status: 200,
      ok: true,
    });
    return NextResponse.json({ network });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      nodeId,
      action: "node.network.update",
      method: "PUT",
      target,
    });
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  let userId: string | null = null;
  let nodeId: string | null = null;
  let target = "unknown";
  try {
    assertSameOrigin(request);
    const user = await requireUser("devices:write");
    userId = user.id;
    const params = await context.params;
    nodeId = params.id;
    const networkId = validateNetworkId(params.networkId);
    target = networkId;
    const instance = optionalText(
      new URL(request.url).searchParams.get("instance"),
      120,
    );
    await nodeAdapterFor(params.id).leaveClientNetwork(
      networkId,
      instance || undefined,
    );
    writeAudit({
      userId: user.id,
      nodeId: params.id,
      action: "node.network.leave",
      method: "DELETE",
      target: networkId,
      status: 200,
      ok: true,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      nodeId,
      action: "node.network.leave",
      method: "DELETE",
      target,
    });
    return jsonError(error);
  }
}
