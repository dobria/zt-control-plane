import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { adapterFor } from "@/lib/adapters";
import {
  createController,
  getActiveControllerId,
  listPublicControllers,
  publicController,
  updateControllerStatus,
} from "@/lib/controller-registry";
import { jsonError } from "@/lib/errors";
import {
  baseUrl,
  booleanValue,
  controllerType,
  jsonBody,
  optionalText,
  requiredText,
} from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser("controllers:read");
    return NextResponse.json({
      controllers: listPublicControllers(),
      activeControllerId: getActiveControllerId(user.id),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  let userId: string | null = null;
  let controllerId: string | null = null;
  let target = "new controller";
  try {
    assertSameOrigin(request);
    const user = await requireUser("controllers:write");
    userId = user.id;
    const body = await jsonBody(request);
    const type = controllerType(body.type);
    const credentials =
      type === "mikrotik"
        ? {
            username: requiredText(body.username, "RouterOS username", 120),
            password: requiredText(body.password, "RouterOS password", 512),
          }
        : { apiToken: requiredText(body.apiToken, "ZeroTier API token", 1024) };
    target = requiredText(body.name, "Controller name", 120);
    const controller = createController({
      type,
      name: target,
      baseUrl: baseUrl(body.baseUrl),
      credentials,
      configuration:
        type === "central_v2"
          ? {
              organizationId: requiredText(
                body.organizationId,
                "Organization ID",
                160,
              ),
              networkGroupId: optionalText(body.networkGroupId, 160),
            }
          : {},
      enabled: booleanValue(body.enabled, "Enabled", true),
      tlsVerify: booleanValue(body.tlsVerify, "TLS verification", true),
    });
    controllerId = controller.id;
    let warning: string | null = null;
    try {
      updateControllerStatus(
        controller.id,
        await adapterFor(controller.id).getStatus(),
      );
    } catch (caught) {
      warning =
        caught instanceof Error ? caught.message : "Connection test failed.";
      updateControllerStatus(controller.id, null, warning);
    }
    writeAudit({
      userId: user.id,
      controllerId: controller.id,
      action: "controller.create",
      method: "POST",
      target: controller.name,
      status: 201,
      ok: true,
      detail: warning,
    });
    return NextResponse.json(
      { controller: publicController(controller), warning },
      { status: 201 },
    );
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      controllerId,
      action: "controller.create",
      method: "POST",
      target,
    });
    return jsonError(error);
  }
}
