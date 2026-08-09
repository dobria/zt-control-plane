import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { adapterFor } from "@/lib/adapters";
import { getMemberDescription, saveMemberDescription } from "@/lib/metadata";
import { jsonError } from "@/lib/errors";
import {
  jsonBody,
  memberId,
  networkId as validateNetworkId,
  optionalText,
} from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";
import { memberPayload } from "@/lib/payloads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; networkId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    await requireUser("networks:read");
    const params = await context.params;
    const networkId = validateNetworkId(params.networkId);
    const members = await adapterFor(params.id).listMembers(networkId);
    return NextResponse.json({
      members: members.map((member) => ({
        ...member,
        description:
          getMemberDescription(params.id, networkId, member.id) ||
          String(member.description || ""),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, context: Context) {
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
    const id = memberId(body.id);
    target = `${networkId}/${id}`;
    const member = await adapterFor(params.id).createMember(
      networkId,
      id,
      memberPayload(body),
    );
    const description = optionalText(body.description, 4000);
    saveMemberDescription(params.id, networkId, id, description);
    writeAudit({
      userId: user.id,
      controllerId: params.id,
      action: "member.create",
      method: "POST",
      target: `${networkId}/${id}`,
      status: 201,
      ok: true,
    });
    return NextResponse.json(
      { member: { ...member, description } },
      { status: 201 },
    );
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      controllerId,
      action: "member.create",
      method: "POST",
      target,
    });
    return jsonError(error);
  }
}
