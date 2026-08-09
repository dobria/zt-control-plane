import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { adapterFor } from "@/lib/adapters";
import { saveNetworkMetadata } from "@/lib/metadata";
import { AppError, jsonError } from "@/lib/errors";
import { compileRules, RuleCompileError } from "@/lib/rules";
import {
  jsonBody,
  networkId as validateNetworkId,
  requiredText,
} from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";
import { flowPolicyPayload } from "@/lib/payloads";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; networkId: string }> };

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
    if (!adapter.capabilities.flowRules)
      throw new AppError(
        "This controller does not expose the full ZeroTier Flow Rules API.",
        409,
        "FEATURE_UNSUPPORTED",
      );
    const source = requiredText(body.source, "Rule source", 200_000);
    let compiled;
    try {
      compiled = compileRules(source);
    } catch (error) {
      if (error instanceof RuleCompileError)
        throw new AppError(
          `Line ${error.line}, column ${error.column}: ${error.message}`,
          400,
          "RULE_COMPILE_ERROR",
        );
      throw error;
    }
    if (adapter.updateFlowRules)
      await adapter.updateFlowRules(networkId, source, compiled.config);
    else await adapter.updateNetwork(networkId, compiled.config);
    saveNetworkMetadata(params.id, networkId, {
      rulesSource: source,
      templatePolicy:
        body.templatePolicy === null || body.templatePolicy === undefined
          ? null
          : flowPolicyPayload(body.templatePolicy),
    });
    writeAudit({
      userId: user.id,
      controllerId: params.id,
      action: "rules.update",
      method: "PUT",
      target: networkId,
      status: 200,
      ok: true,
    });
    return NextResponse.json(compiled);
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      controllerId,
      action: "rules.update",
      method: "PUT",
      target,
    });
    return jsonError(error);
  }
}
