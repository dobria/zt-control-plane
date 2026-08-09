import { db, queryAll } from "@/lib/database";
import { normalizeIpAccessRules } from "@/lib/ip-access";
import type { AppSettings, PublicAppSettings } from "@/lib/types";

const refreshOptions = new Set([15, 30, 60, 120]);
const retentionOptions = new Set([0, 30, 90, 180, 365, 730]);

function storedSettings() {
  return new Map(
    queryAll<{ key: string; value: string }>(
      "SELECT key,value FROM app_settings",
    ).map((entry) => [entry.key, entry.value]),
  );
}

function integerSetting(
  value: string | undefined,
  fallback: number,
  allowed?: Set<number>,
) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  if (allowed && !allowed.has(parsed)) return fallback;
  return parsed;
}

export function getAppSettings(): AppSettings {
  const stored = storedSettings();
  const environmentSessionHours = Math.max(
    1,
    Math.min(168, Number(process.env.SESSION_HOURS || 12)),
  );
  let ipAllowlist: string[] = [];
  try {
    ipAllowlist = normalizeIpAccessRules(
      JSON.parse(stored.get("ip_allowlist") || "[]"),
    );
  } catch {
    // Invalid persisted data must never weaken the fail-closed access boundary.
    ipAllowlist = [];
  }
  return {
    workspaceName: "Control Plane",
    refreshSeconds: integerSetting(
      stored.get("refresh_seconds"),
      30,
      refreshOptions,
    ) as AppSettings["refreshSeconds"],
    sessionHours: Math.max(
      1,
      Math.min(
        168,
        integerSetting(stored.get("session_hours"), environmentSessionHours),
      ),
    ),
    auditRetentionDays: integerSetting(
      stored.get("audit_retention_days"),
      0,
      retentionOptions,
    ) as AppSettings["auditRetentionDays"],
    ipAllowlistEnabled: stored.get("ip_allowlist_enabled") === "1",
    ipAllowlist,
  };
}

export function getPublicAppSettings(): PublicAppSettings {
  const { workspaceName, refreshSeconds } = getAppSettings();
  return { workspaceName, refreshSeconds };
}

export function saveAppSettings(settings: AppSettings) {
  const statement = db().prepare(
    `INSERT INTO app_settings (key,value,updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
  );
  const now = Date.now();
  const values: Array<[string, string]> = [
    ["refresh_seconds", String(settings.refreshSeconds)],
    ["session_hours", String(settings.sessionHours)],
    ["audit_retention_days", String(settings.auditRetentionDays)],
    ["ip_allowlist_enabled", settings.ipAllowlistEnabled ? "1" : "0"],
    ["ip_allowlist", JSON.stringify(settings.ipAllowlist)],
  ];
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const [key, value] of values) statement.run(key, value, now);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function settingsOptions() {
  return {
    refreshSeconds: [...refreshOptions] as AppSettings["refreshSeconds"][],
    auditRetentionDays: [
      ...retentionOptions,
    ] as AppSettings["auditRetentionDays"][],
  };
}
