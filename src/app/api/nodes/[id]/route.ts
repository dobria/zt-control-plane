import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import {
  deleteNode,
  getNode,
  publicNode,
  updateNode,
} from "@/lib/node-registry";
import { AppError, jsonError } from "@/lib/errors";
import {
  baseUrl,
  booleanValue,
  jsonBody,
  optionalText,
  requiredText,
} from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    await requireUser("devices:read");
    const node = getNode((await context.params).id);
    if (!node) throw new AppError("Managed node not found.", 404);
    return NextResponse.json({ node: publicNode(node) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request, context: Context) {
  let userId: string | null = null;
  let nodeId: string | null = null;
  let target = "unknown";
  try {
    assertSameOrigin(request);
    const user = await requireUser("controllers:write");
    userId = user.id;
    const { id } = await context.params;
    nodeId = id;
    const current = getNode(id);
    if (!current)
      throw new AppError("Managed node not found.", 404, "NODE_NOT_FOUND");
    target = current.name;
    const body = await jsonBody(request);
    const credentials =
      current.type === "mikrotik"
        ? optionalText(body.password, 512)
          ? {
              username: requiredText(body.username, "RouterOS username", 120),
              password: optionalText(body.password, 512),
            }
          : undefined
        : optionalText(body.apiToken, 1024)
          ? { apiToken: optionalText(body.apiToken, 1024) }
          : undefined;
    const node = updateNode(id, {
      name: requiredText(body.name, "Node name", 120),
      baseUrl: baseUrl(body.baseUrl),
      credentials,
      enabled: booleanValue(body.enabled, "Enabled", true),
      tlsVerify: booleanValue(body.tlsVerify, "TLS verification", true),
    });
    writeAudit({
      userId: user.id,
      nodeId: id,
      action: "node.update",
      method: "PUT",
      target: node.name,
      status: 200,
      ok: true,
    });
    return NextResponse.json({ node: publicNode(node) });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      nodeId,
      action: "node.update",
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
    const user = await requireUser("controllers:write");
    userId = user.id;
    const { id } = await context.params;
    nodeId = id;
    const current = getNode(id);
    if (!current)
      throw new AppError("Managed node not found.", 404, "NODE_NOT_FOUND");
    target = current.name;
    deleteNode(id);
    writeAudit({
      userId: user.id,
      nodeId: null,
      action: "node.delete",
      method: "DELETE",
      target: current.name,
      status: 200,
      ok: true,
      detail: `Deleted managed node ID: ${id}`,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      nodeId,
      action: "node.delete",
      method: "DELETE",
      target,
    });
    return jsonError(error);
  }
}
