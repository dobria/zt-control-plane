import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { jsonError } from "@/lib/errors";
import { writeAudit, writeFailureAudit } from "@/lib/audit";
import {
  getAppSettings,
  saveAppSettings,
  settingsOptions,
} from "@/lib/settings";
import type { AppSettings } from "@/lib/types";
import { jsonBody, ValidationError } from "@/lib/validation";
import {
  ipAllowlistBypassed,
  trustedClientIp,
  validateIpAccessConfiguration,
} from "@/lib/ip-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function option<T extends number>(
  value: unknown,
  values: readonly T[],
  field: string,
) {
  const parsed = Number(value);
  if (!values.includes(parsed as T))
    throw new ValidationError(`${field} contains an unsupported value.`);
  return parsed as T;
}

function responsePayload(request: Request) {
  const settings = getAppSettings();
  const publicUrl = process.env.APP_PUBLIC_URL?.trim() || null;
  return {
    settings,
    options: settingsOptions(),
    environment: {
      publicUrl,
      trustedProxy: process.env.TRUST_PROXY === "1",
      secureCookies:
        process.env.APP_SECURE_COOKIES === "1" ||
        Boolean(publicUrl?.startsWith("https://")),
      database: "SQLite",
      storage: "/data",
      clientIp: trustedClientIp(request.headers),
      ipAllowlistBypass: ipAllowlistBypassed(),
    },
  };
}

export async function GET(request: Request) {
  try {
    await requireUser("users:write");
    return NextResponse.json(responsePayload(request));
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  let userId: string | null = null;
  try {
    assertSameOrigin(request);
    const user = await requireUser("users:write");
    userId = user.id;
    const body = await jsonBody(request);
    const options = settingsOptions();
    if (typeof body.ipAllowlistEnabled !== "boolean")
      throw new ValidationError("IP access-list state is invalid.");
    const clientIp = trustedClientIp(request.headers);
    const ipAllowlist = validateIpAccessConfiguration({
      enabled: body.ipAllowlistEnabled,
      rules: body.ipAllowlist,
      clientIp,
      trustedProxy: process.env.TRUST_PROXY === "1",
    });
    const settings: AppSettings = {
      workspaceName: getAppSettings().workspaceName,
      refreshSeconds: option(
        body.refreshSeconds,
        options.refreshSeconds,
        "Refresh interval",
      ),
      sessionHours: option(
        body.sessionHours,
        [1, 4, 8, 12, 24, 72, 168] as const,
        "Session lifetime",
      ),
      auditRetentionDays: option(
        body.auditRetentionDays,
        options.auditRetentionDays,
        "Audit retention",
      ),
      ipAllowlistEnabled: body.ipAllowlistEnabled,
      ipAllowlist,
    };
    saveAppSettings(settings);
    writeAudit({
      userId: user.id,
      action: "settings.update",
      method: "PUT",
      target: "global settings",
      status: 200,
      ok: true,
      detail: `IP access list ${settings.ipAllowlistEnabled ? "enabled" : "disabled"}; ${settings.ipAllowlist.length} rule(s).`,
    });
    return NextResponse.json(responsePayload(request));
  } catch (error) {
    writeFailureAudit(error, {
      userId,
      action: "settings.update",
      method: "PUT",
      target: "global settings",
    });
    return jsonError(error);
  }
}
