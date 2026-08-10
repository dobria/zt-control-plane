import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import {
  deleteController,
  getController,
  publicController,
  setControllerEnabled,
  updateController,
} from "@/lib/controller-registry";
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
    await requireUser("controllers:read");
    const controller = getController((await context.params).id);
    if (!controller) throw new AppError("Controller not found.", 404);
    return NextResponse.json({ controller: publicController(controller) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request, context: Context) {
  let userId: string | null = null;
  let controllerId: string | null = null;
  let target = "unknown";
  let action = "controller.update";
  try {
    assertSameOrigin(request);
    const user = await requireUser("controllers:write");
    userId = user.id;
    const { id } = await context.params;
    controllerId = id;
    const current = getController(id);
    if (!current)
      throw new AppError("Controller not found.", 404, "CONTROLLER_NOT_FOUND");
    target = current.name;
    const body = await jsonBody(request);
    const enabled = booleanValue(body.enabled, "Connection active", true);
    if (enabled !== current.enabled)
      action = enabled ? "controller.resume" : "controller.pause";
    if (current.embedded) {
      const controller = setControllerEnabled(id, enabled);
      writeAudit({
        userId: user.id,
        controllerId: id,
        action,
        method: "PUT",
        target: controller.name,
        status: 200,
        ok: true,
      });
      return NextResponse.json({ controller: publicController(controller) });
    }
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
    const controller = updateController(id, {
      name: requiredText(body.name, "Controller name", 120),
      baseUrl: baseUrl(body.baseUrl),
      credentials,
      configuration:
        current.type === "central_v2"
          ? {
              organizationId: requiredText(
                body.organizationId,
                "Organization ID",
                160,
              ),
              networkGroupId: optionalText(body.networkGroupId, 160),
            }
          : current.configuration,
      enabled,
      tlsVerify: booleanValue(body.tlsVerify, "TLS verification", true),
    });
    writeAudit({
      userId: user.id,
      controllerId: id,
      action,
      method: "PUT",
      target: controller.name,
      status: 200,
      ok: true,
    });
    return NextResponse.json({ controller: publicController(controller) });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      controllerId,
      action,
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
    const user = await requireUser("controllers:write");
    userId = user.id;
    const { id } = await context.params;
    controllerId = id;
    const current = getController(id);
    if (!current)
      throw new AppError("Controller not found.", 404, "CONTROLLER_NOT_FOUND");
    target = current.name;
    deleteController(id);
    writeAudit({
      userId: user.id,
      // The controller no longer exists, so retaining its ID in the foreign-key
      // column would make the otherwise successful deletion return HTTP 500.
      controllerId: null,
      action: "controller.delete",
      method: "DELETE",
      target: current.name,
      status: 200,
      ok: true,
      detail: `Deleted controller ID: ${id}`,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      controllerId,
      action: "controller.delete",
      method: "DELETE",
      target,
    });
    return jsonError(error);
  }
}
