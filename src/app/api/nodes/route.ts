import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { nodeAdapterFor } from "@/lib/adapters";
import {
  createNode,
  getActiveNodeId,
  listNodesForController,
  listPublicNodes,
  publicNode,
  updateNodeStatus,
} from "@/lib/node-registry";
import { jsonError } from "@/lib/errors";
import {
  baseUrl,
  booleanValue,
  jsonBody,
  managedNodeType,
  optionalText,
  requiredText,
} from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser("devices:read");
    const controllerId = new URL(request.url).searchParams.get("controllerId");
    return NextResponse.json({
      nodes: controllerId
        ? listNodesForController(controllerId).map(publicNode)
        : listPublicNodes(),
      activeNodeId: getActiveNodeId(user.id),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  let userId: string | null = null;
  let nodeId: string | null = null;
  let target = "new managed node";
  try {
    assertSameOrigin(request);
    const user = await requireUser("controllers:write");
    userId = user.id;
    const body = await jsonBody(request);
    const type = managedNodeType(body.type);
    const credentials =
      type === "mikrotik"
        ? {
            username: requiredText(body.username, "RouterOS username", 120),
            password: requiredText(body.password, "RouterOS password", 512),
          }
        : { apiToken: requiredText(body.apiToken, "ZeroTier API token", 1024) };
    target = requiredText(body.name, "Node name", 120);
    const node = createNode({
      controllerId: optionalText(body.controllerId, 80) || null,
      type,
      name: target,
      baseUrl: baseUrl(body.baseUrl),
      credentials,
      enabled: booleanValue(body.enabled, "Enabled", true),
      tlsVerify: booleanValue(body.tlsVerify, "TLS verification", true),
    });
    nodeId = node.id;
    let warning: string | null = null;
    try {
      updateNodeStatus(node.id, await nodeAdapterFor(node.id).getStatus());
    } catch (caught) {
      warning = caught instanceof Error ? caught.message : "Connection test failed.";
      updateNodeStatus(node.id, null, warning);
    }
    writeAudit({
      userId: user.id,
      nodeId: node.id,
      action: "node.create",
      method: "POST",
      target: node.name,
      status: 201,
      ok: true,
      detail: warning,
    });
    return NextResponse.json(
      { node: publicNode(node), warning },
      { status: 201 },
    );
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      nodeId,
      action: "node.create",
      method: "POST",
      target,
    });
    return jsonError(error);
  }
}
