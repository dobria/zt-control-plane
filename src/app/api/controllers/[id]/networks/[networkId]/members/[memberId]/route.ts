import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { adapterFor } from "@/lib/adapters";
import {
  deleteMemberMetadata,
  getMemberDescription,
  saveMemberDescription,
} from "@/lib/metadata";
import { jsonError } from "@/lib/errors";
import {
  jsonBody,
  memberId as validateMemberId,
  networkId as validateNetworkId,
  optionalText,
} from "@/lib/validation";
import { writeAudit, writeFailureAudit } from "@/lib/audit";
import { memberPayload } from "@/lib/payloads";

export const runtime = "nodejs";
type Context = {
  params: Promise<{ id: string; networkId: string; memberId: string }>;
};

export async function GET(_request: Request, context: Context) {
  try {
    await requireUser("networks:read");
    const params = await context.params;
    const networkId = validateNetworkId(params.networkId);
    const memberId = validateMemberId(params.memberId);
    const member = await adapterFor(params.id).getMember(networkId, memberId);
    return NextResponse.json({
      member: {
        ...member,
        description:
          getMemberDescription(params.id, networkId, memberId) ||
          String(member.description || ""),
      },
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
    const memberId = validateMemberId(params.memberId);
    target = `${networkId}/${memberId}`;
    const body = await jsonBody(request);
    const member = await adapterFor(params.id).updateMember(
      networkId,
      memberId,
      memberPayload(body),
    );
    if (body.description !== undefined)
      saveMemberDescription(
        params.id,
        networkId,
        memberId,
        optionalText(body.description, 4000),
      );
    writeAudit({
      userId: user.id,
      controllerId: params.id,
      action: "member.update",
      method: "PUT",
      target: `${networkId}/${memberId}`,
      status: 200,
      ok: true,
    });
    return NextResponse.json({
      member: {
        ...member,
        description:
          getMemberDescription(params.id, networkId, memberId) ||
          String(member.description || ""),
      },
    });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      controllerId,
      action: "member.update",
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
    const memberId = validateMemberId(params.memberId);
    target = `${networkId}/${memberId}`;
    await adapterFor(params.id).deleteMember(networkId, memberId);
    deleteMemberMetadata(params.id, networkId, memberId);
    writeAudit({
      userId: user.id,
      controllerId: params.id,
      action: "member.delete",
      method: "DELETE",
      target: `${networkId}/${memberId}`,
      status: 200,
      ok: true,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      controllerId,
      action: "member.delete",
      method: "DELETE",
      target,
    });
    return jsonError(error);
  }
}
