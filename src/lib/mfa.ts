import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db, queryOne } from "@/lib/database";
import { AppError } from "@/lib/errors";
import { decryptJson, encryptJson, getSecretKey } from "@/lib/secrets";
import { ValidationError } from "@/lib/validation";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_PERIOD_SECONDS = 30;
const ENROLLMENT_LIFETIME_MS = 10 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;

interface MfaRow {
  user_id: string;
  encrypted_secret: string;
  enabled: number;
  pending_expires_at: number | null;
  last_used_step: number | null;
}

export interface MfaStatus {
  enabled: boolean;
  recoveryCodesRemaining: number;
}

export function base32Encode(value: Uint8Array) {
  let bits = 0;
  let buffer = 0;
  let encoded = "";
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      encoded += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) encoded += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return encoded;
}

export function base32Decode(value: string) {
  const normalized = value.toUpperCase().replace(/=+$/g, "");
  let bits = 0;
  let buffer = 0;
  const decoded: number[] = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0)
      throw new ValidationError("Authenticator secret is invalid.");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      decoded.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(decoded);
}

export function totpAt(
  secret: string,
  timestamp = Date.now(),
  options: { digits?: number; periodSeconds?: number } = {},
) {
  const digits = options.digits ?? 6;
  const periodSeconds = options.periodSeconds ?? TOTP_PERIOD_SECONDS;
  const step = Math.floor(timestamp / 1000 / periodSeconds);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret))
    .update(counter)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    (((digest[offset] & 0x7f) << 24) |
      (digest[offset + 1] << 16) |
      (digest[offset + 2] << 8) |
      digest[offset + 3]) >>>
    0;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function verifyTotp(
  secret: string,
  code: string,
  timestamp = Date.now(),
  window = 1,
) {
  if (!/^\d{6}$/.test(code)) return null;
  const supplied = Buffer.from(code);
  const currentStep = Math.floor(timestamp / 1000 / TOTP_PERIOD_SECONDS);
  for (let offset = -window; offset <= window; offset += 1) {
    const step = currentStep + offset;
    if (step < 0) continue;
    const generated = Buffer.from(
      totpAt(secret, step * TOTP_PERIOD_SECONDS * 1000),
    );
    if (
      generated.length === supplied.length &&
      timingSafeEqual(generated, supplied)
    )
      return step;
  }
  return null;
}

export function authenticatorUri(input: {
  issuer: string;
  account: string;
  secret: string;
}) {
  const issuer = input.issuer.replace(/:/g, " ").trim().slice(0, 60);
  const account = input.account.trim().slice(0, 254);
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query}`;
}

function mfaRow(userId: string) {
  return queryOne<MfaRow>("SELECT * FROM user_mfa WHERE user_id=?", userId);
}

function secretFor(row: MfaRow) {
  return decryptJson<{ secret: string }>(row.encrypted_secret).secret;
}

function normalizedRecoveryCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

function recoveryCodeHash(value: string) {
  return createHmac("sha256", getSecretKey())
    .update(`mfa-recovery:${normalizedRecoveryCode(value)}`)
    .digest("base64url");
}

function generateRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = base32Encode(randomBytes(10));
    return raw.match(/.{1,4}/g)!.join("-");
  });
}

function replaceRecoveryCodes(userId: string, codes: string[], now: number) {
  const database = db();
  database
    .prepare("DELETE FROM mfa_recovery_codes WHERE user_id=?")
    .run(userId);
  const insert = database.prepare(
    "INSERT INTO mfa_recovery_codes (user_id,code_hash,created_at) VALUES (?,?,?)",
  );
  for (const code of codes) insert.run(userId, recoveryCodeHash(code), now);
}

export function mfaStatus(userId: string): MfaStatus {
  let row = mfaRow(userId);
  if (
    row &&
    !row.enabled &&
    row.pending_expires_at &&
    row.pending_expires_at < Date.now()
  ) {
    db().prepare("DELETE FROM user_mfa WHERE user_id=?").run(userId);
    row = undefined;
  }
  const enabled = Boolean(row?.enabled);
  const recoveryCodesRemaining = enabled
    ? Number(
        queryOne<{ count: number }>(
          "SELECT COUNT(*) AS count FROM mfa_recovery_codes WHERE user_id=? AND used_at IS NULL",
          userId,
        )?.count || 0,
      )
    : 0;
  return { enabled, recoveryCodesRemaining };
}

export function isMfaEnabled(userId: string) {
  return Boolean(
    queryOne<{ enabled: number }>(
      "SELECT enabled FROM user_mfa WHERE user_id=?",
      userId,
    )?.enabled,
  );
}

export function beginMfaEnrollment(userId: string, now = Date.now()) {
  if (isMfaEnabled(userId))
    throw new AppError(
      "Two-factor authentication is already enabled.",
      409,
      "MFA_ALREADY_ENABLED",
    );
  const secret = base32Encode(randomBytes(20));
  const expiresAt = now + ENROLLMENT_LIFETIME_MS;
  db()
    .prepare(
      `INSERT INTO user_mfa
       (user_id,encrypted_secret,enabled,pending_expires_at,last_used_step,created_at,updated_at)
       VALUES (?,?,0,?,NULL,?,?)
       ON CONFLICT(user_id) DO UPDATE SET
       encrypted_secret=excluded.encrypted_secret,enabled=0,
       pending_expires_at=excluded.pending_expires_at,last_used_step=NULL,
       updated_at=excluded.updated_at`,
    )
    .run(userId, encryptJson({ secret }), expiresAt, now, now);
  return { secret, expiresAt };
}

export function confirmMfaEnrollment(
  userId: string,
  code: string,
  now = Date.now(),
) {
  const row = mfaRow(userId);
  if (!row || row.enabled || !row.pending_expires_at)
    throw new AppError(
      "Start two-factor setup again.",
      409,
      "MFA_SETUP_REQUIRED",
    );
  if (row.pending_expires_at < now) {
    db().prepare("DELETE FROM user_mfa WHERE user_id=?").run(userId);
    throw new AppError(
      "The setup key has expired. Start again.",
      410,
      "MFA_SETUP_EXPIRED",
    );
  }
  const verifiedStep = verifyTotp(secretFor(row), code, now);
  if (verifiedStep === null)
    throw new AppError(
      "The authenticator code is incorrect.",
      400,
      "INVALID_MFA_CODE",
    );

  const codes = generateRecoveryCodes();
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        `UPDATE user_mfa
         SET enabled=1,pending_expires_at=NULL,last_used_step=?,updated_at=?
         WHERE user_id=?`,
      )
      .run(verifiedStep, now, userId);
    replaceRecoveryCodes(userId, codes, now);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return codes;
}

export function verifySecondFactor(
  userId: string,
  value: string,
  now = Date.now(),
): "totp" | "recovery" | null {
  const row = mfaRow(userId);
  if (!row?.enabled) return null;
  const compact = value.trim().replace(/[\s-]/g, "");
  if (/^\d{6}$/.test(compact)) {
    const step = verifyTotp(secretFor(row), compact, now);
    if (step === null) return null;
    const result = db()
      .prepare(
        `UPDATE user_mfa SET last_used_step=?,updated_at=?
         WHERE user_id=? AND enabled=1
         AND (last_used_step IS NULL OR last_used_step < ?)`,
      )
      .run(step, now, userId, step);
    return result.changes === 1 ? "totp" : null;
  }
  const normalized = normalizedRecoveryCode(value);
  if (!/^[A-Z2-7]{16}$/.test(normalized)) return null;
  const result = db()
    .prepare(
      `UPDATE mfa_recovery_codes SET used_at=?
       WHERE user_id=? AND code_hash=? AND used_at IS NULL`,
    )
    .run(now, userId, recoveryCodeHash(normalized));
  return result.changes === 1 ? "recovery" : null;
}

export function regenerateRecoveryCodes(userId: string, now = Date.now()) {
  if (!isMfaEnabled(userId))
    throw new AppError(
      "Two-factor authentication is not enabled.",
      409,
      "MFA_NOT_ENABLED",
    );
  const codes = generateRecoveryCodes();
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    replaceRecoveryCodes(userId, codes, now);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return codes;
}

export function disableMfa(userId: string) {
  return Number(
    db().prepare("DELETE FROM user_mfa WHERE user_id=?").run(userId).changes,
  );
}
