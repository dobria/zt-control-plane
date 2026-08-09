import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { cookies, headers } from "next/headers";
import { db, publicUser, queryOne, type UserRow } from "@/lib/database";
import { hasPermission } from "@/lib/rbac";
import type { Permission, PublicUser } from "@/lib/types";
import { AppError } from "@/lib/errors";
import { getActiveControllerId } from "@/lib/controller-registry";
import { getActiveNodeId } from "@/lib/node-registry";
import { getAppSettings } from "@/lib/settings";
import { getSecretKey } from "@/lib/secrets";

const COOKIE_NAME = "ztcp_session";
const MFA_CHALLENGE_COOKIE = "ztcp_mfa_challenge";
const MFA_CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;
const MAX_MFA_CHALLENGE_ATTEMPTS = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_RATE_BUCKETS = 5_000;

function keyedDigest(purpose: string, value: string) {
  return createHmac("sha256", getSecretKey())
    .update(purpose, "utf8")
    .update("\0", "utf8")
    .update(value, "utf8")
    .digest("hex");
}
function sessionHours() {
  return getAppSettings().sessionHours;
}

interface HeaderReader {
  get(name: string): string | null;
}

function configuredPublicOrigin() {
  const configured = process.env.APP_PUBLIC_URL?.trim();
  if (!configured) return null;
  try {
    const parsed = new URL(configured);
    if (
      !new Set(["http:", "https:"]).has(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      (parsed.pathname !== "/" && parsed.pathname !== "") ||
      parsed.search ||
      parsed.hash
    )
      throw new Error();
    return parsed.origin;
  } catch {
    throw new AppError(
      "APP_PUBLIC_URL must be a valid HTTP or HTTPS URL.",
      500,
      "INVALID_PUBLIC_URL",
    );
  }
}

function secureSessionCookie(headerStore: HeaderReader) {
  if (process.env.APP_SECURE_COOKIES === "1") return true;
  if (configuredPublicOrigin()?.startsWith("https://")) return true;
  return (
    process.env.TRUST_PROXY === "1" &&
    headerStore.get("x-forwarded-proto")?.split(",")[0].trim() === "https"
  );
}

export function setupRequired() {
  return (
    Number(
      queryOne<{ count: number }>("SELECT COUNT(*) AS count FROM users")
        ?.count || 0,
    ) === 0
  );
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + sessionHours() * 60 * 60 * 1000;
  db().prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  db()
    .prepare(
      "INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)",
    )
    .run(keyedDigest("session", token), userId, now, expiresAt);
  const headerStore = await headers();
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: secureSessionCookie(headerStore),
    priority: "high",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export interface MfaLoginChallenge {
  userId: string;
  attempts: number;
}

export async function createMfaLoginChallenge(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + MFA_CHALLENGE_LIFETIME_MS;
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        "DELETE FROM mfa_login_challenges WHERE expires_at<=? OR user_id=?",
      )
      .run(now, userId);
    database
      .prepare(
        `INSERT INTO mfa_login_challenges
         (token_hash,user_id,created_at,expires_at,attempts)
         VALUES (?,?,?,?,0)`,
      )
    .run(keyedDigest("mfa-challenge", token), userId, now, expiresAt);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  const headerStore = await headers();
  (await cookies()).set(MFA_CHALLENGE_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: secureSessionCookie(headerStore),
    priority: "high",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function currentMfaLoginChallenge(): Promise<MfaLoginChallenge | null> {
  const token = (await cookies()).get(MFA_CHALLENGE_COOKIE)?.value;
  if (!token) return null;
  const row = queryOne<{
    user_id: string;
    attempts: number;
    expires_at: number;
  }>(
    `SELECT c.user_id,c.attempts,c.expires_at
     FROM mfa_login_challenges c JOIN users u ON u.id=c.user_id
     WHERE c.token_hash=? AND c.expires_at>? AND u.disabled=0`,
    keyedDigest("mfa-challenge", token),
    Date.now(),
  );
  if (!row || row.attempts >= MAX_MFA_CHALLENGE_ATTEMPTS) return null;
  return { userId: row.user_id, attempts: row.attempts };
}

export async function recordMfaChallengeFailure() {
  const token = (await cookies()).get(MFA_CHALLENGE_COOKIE)?.value;
  if (!token) return 0;
  return Number(
    db()
      .prepare(
        "UPDATE mfa_login_challenges SET attempts=attempts+1 WHERE token_hash=? AND expires_at>?",
      )
      .run(keyedDigest("mfa-challenge", token), Date.now()).changes,
  );
}

export async function clearMfaLoginChallenge() {
  const store = await cookies();
  const headerStore = await headers();
  const token = store.get(MFA_CHALLENGE_COOKIE)?.value;
  if (token)
    db()
      .prepare("DELETE FROM mfa_login_challenges WHERE token_hash=?")
      .run(keyedDigest("mfa-challenge", token));
  store.set(MFA_CHALLENGE_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: secureSessionCookie(headerStore),
    priority: "high",
    path: "/",
    expires: new Date(0),
  });
}

export async function destroySession() {
  const store = await cookies();
  const headerStore = await headers();
  const token = store.get(COOKIE_NAME)?.value;
  if (token)
    db()
      .prepare("DELETE FROM sessions WHERE token_hash=?")
      .run(keyedDigest("session", token));
  store.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: secureSessionCookie(headerStore),
    priority: "high",
    path: "/",
    expires: new Date(0),
  });
  await clearMfaLoginChallenge();
}

export async function currentUser(): Promise<PublicUser | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const row = queryOne<
    UserRow & {
      active_controller_id: string | null;
      active_node_id: string | null;
      landing_page: string | null;
      reduced_motion: number | null;
      mfa_enabled: number | null;
    }
  >(
    `
    SELECT u.*,p.active_controller_id,p.active_node_id,p.landing_page,p.reduced_motion,m.enabled AS mfa_enabled
    FROM sessions s JOIN users u ON u.id=s.user_id
    LEFT JOIN user_preferences p ON p.user_id=u.id
    LEFT JOIN user_mfa m ON m.user_id=u.id
    WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0
  `,
    keyedDigest("session", token),
    Date.now(),
  );
  if (!row) return null;
  const user = publicUser(row);
  user.activeControllerId = getActiveControllerId(user.id);
  user.activeNodeId = getActiveNodeId(user.id);
  return user;
}

export async function requireUser(permission?: Permission) {
  const user = await currentUser();
  if (!user)
    throw new AppError("Authentication required.", 401, "AUTH_REQUIRED");
  if (permission && !hasPermission(user.role, permission))
    throw new AppError(
      "You do not have permission to perform this action.",
      403,
      "FORBIDDEN",
    );
  return user;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && !new Set(["same-origin", "none"]).has(fetchSite))
    throw new AppError("Cross-origin mutation rejected.", 403, "CSRF_REJECTED");
  let expectedOrigin = configuredPublicOrigin();
  if (!expectedOrigin) {
    if (process.env.TRUST_PROXY === "1")
      throw new AppError(
        "APP_PUBLIC_URL is required when TRUST_PROXY is enabled.",
        500,
        "PUBLIC_URL_REQUIRED",
      );
    const host = request.headers.get("host")?.trim();
    if (!host)
      throw new AppError("Request host is required.", 403, "CSRF_REJECTED");
    try {
      expectedOrigin = new URL(`${new URL(request.url).protocol}//${host}`)
        .origin;
    } catch {
      throw new AppError("Invalid request host.", 403, "CSRF_REJECTED");
    }
  }
  if (!origin) {
    if (fetchSite === "same-origin") return;
    throw new AppError("Request origin is required.", 403, "CSRF_REJECTED");
  }
  let requestOrigin = "";
  try {
    requestOrigin = new URL(origin).origin;
  } catch {
    throw new AppError("Invalid request origin.", 403, "CSRF_REJECTED");
  }
  if (requestOrigin !== expectedOrigin)
    throw new AppError("Cross-origin mutation rejected.", 403, "CSRF_REJECTED");
}

export interface LoginRateBucket {
  key: string;
  limit: number;
  scope: "account" | "ip" | "global" | "mfa";
}

export function mfaRateLimitBucket(userId: string): LoginRateBucket {
  return {
    key: `mfa:${keyedDigest("rate-limit:mfa", userId)}`,
    limit: 10,
    scope: "mfa",
  };
}

export function loginRateLimitBuckets(request: Request, userEmail: string) {
  const buckets: LoginRateBucket[] = [
    {
      key: `account:${keyedDigest("rate-limit:account", userEmail)}`,
      limit: 8,
      scope: "account",
    },
    {
      key: "global:login",
      limit: 100,
      scope: "global",
    },
  ];
  if (process.env.TRUST_PROXY === "1") {
    const forwarded =
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "";
    const realIp = request.headers.get("x-real-ip")?.trim() || "";
    const address = isIP(forwarded) ? forwarded : isIP(realIp) ? realIp : "";
    if (address)
      buckets.push({
        key: `ip:${keyedDigest("rate-limit:ip", address)}`,
        limit: 40,
        scope: "ip",
      });
  }
  return buckets;
}

export function assertLoginRateLimit(buckets: LoginRateBucket[]) {
  const now = Date.now();
  db().prepare("DELETE FROM login_attempts WHERE reset_at<=?").run(now);
  for (const bucket of buckets) {
    const entry = queryOne<{ count: number }>(
      "SELECT count FROM login_attempts WHERE key=?",
      bucket.key,
    );
    if (entry && entry.count >= bucket.limit)
      throw new AppError(
        "Too many sign-in attempts. Try again later.",
        429,
        "RATE_LIMITED",
      );
  }
}

export function recordLoginFailure(buckets: LoginRateBucket[]) {
  const now = Date.now();
  const database = db();
  let limited = false;
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("DELETE FROM login_attempts WHERE reset_at<=?").run(now);
    for (const bucket of buckets) {
      const entry = database
        .prepare("SELECT count FROM login_attempts WHERE key=?")
        .get(bucket.key) as { count: number } | undefined;
      if (!entry) {
        database
          .prepare(
            "INSERT INTO login_attempts (key,count,reset_at,updated_at) VALUES (?,1,?,?)",
          )
          .run(bucket.key, now + RATE_WINDOW_MS, now);
        continue;
      }
      if (entry.count >= bucket.limit) {
        limited = true;
        continue;
      }
      database
        .prepare(
          "UPDATE login_attempts SET count=count+1,updated_at=? WHERE key=?",
        )
        .run(now, bucket.key);
    }
    database
      .prepare(
        `
        DELETE FROM login_attempts WHERE key IN (
          SELECT key FROM login_attempts
          ORDER BY updated_at DESC
          LIMIT -1 OFFSET ${MAX_RATE_BUCKETS}
        )
      `,
      )
      .run();
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  if (limited)
    throw new AppError(
      "Too many sign-in attempts. Try again later.",
      429,
      "RATE_LIMITED",
    );
}
export function clearLoginRateLimit(buckets: LoginRateBucket[]) {
  const statement = db().prepare("DELETE FROM login_attempts WHERE key=?");
  for (const bucket of buckets) statement.run(bucket.key);
}
export function newUserId() {
  return randomUUID();
}
