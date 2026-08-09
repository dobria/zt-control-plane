import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { after, before, describe, it } from "node:test";
import { closeDatabaseForTests, db, queryOne } from "@/lib/database";
import { AppError } from "@/lib/errors";
import {
  authenticatorUri,
  base32Decode,
  base32Encode,
  beginMfaEnrollment,
  confirmMfaEnrollment,
  disableMfa,
  mfaStatus,
  regenerateRecoveryCodes,
  totpAt,
  verifySecondFactor,
} from "@/lib/mfa";
import { resetSecretCacheForTests } from "@/lib/secrets";

const databaseFile = path.join(tmpdir(), `ztcp-mfa-${randomUUID()}.sqlite`);

before(() => {
  process.env.DATABASE_PATH = databaseFile;
  process.env.APP_SECRET = "mfa-test-secret-that-is-long-enough-for-encryption";
  resetSecretCacheForTests();
  db();
});

after(() => closeDatabaseForTests());

describe("RFC 6238 TOTP", () => {
  it("matches the RFC SHA-1 test vectors", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    const vectors = [
      [59, "94287082"],
      [1_111_111_109, "07081804"],
      [1_111_111_111, "14050471"],
      [1_234_567_890, "89005924"],
      [2_000_000_000, "69279037"],
      [20_000_000_000, "65353130"],
    ] as const;
    for (const [seconds, expected] of vectors)
      assert.equal(totpAt(secret, seconds * 1000, { digits: 8 }), expected);
  });

  it("round-trips Base32 and produces a Google Authenticator URI", () => {
    const bytes = Buffer.from("a private authenticator secret");
    const secret = base32Encode(bytes);
    assert.deepEqual(base32Decode(secret), bytes);
    const uri = authenticatorUri({
      issuer: "Home Control Plane",
      account: "operator@example.com",
      secret,
    });
    assert.match(uri, /^otpauth:\/\/totp\/Home%20Control%20Plane:/);
    assert.match(uri, /issuer=Home\+Control\+Plane/);
    assert.match(uri, /algorithm=SHA1/);
    assert.match(uri, /digits=6/);
    assert.match(uri, /period=30/);
  });
});

describe("MFA enrollment and recovery", () => {
  const userId = `mfa-user-${randomUUID()}`;
  const now = 1_800_000_000_000;

  before(() => {
    db()
      .prepare(
        `INSERT INTO users
         (id,email,display_name,password_hash,role,disabled,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        userId,
        `${userId}@example.com`,
        "MFA user",
        "test",
        "viewer",
        0,
        now,
        now,
      );
  });

  it("encrypts enrollment, prevents TOTP replay, and consumes recovery codes", () => {
    assert.deepEqual(mfaStatus(userId), {
      enabled: false,
      recoveryCodesRemaining: 0,
    });
    const enrollment = beginMfaEnrollment(userId, now);
    const stored = queryOne<{ encrypted_secret: string }>(
      "SELECT encrypted_secret FROM user_mfa WHERE user_id=?",
      userId,
    )!;
    assert.equal(stored.encrypted_secret.includes(enrollment.secret), false);

    const confirmationCode = totpAt(enrollment.secret, now);
    const recoveryCodes = confirmMfaEnrollment(userId, confirmationCode, now);
    assert.equal(recoveryCodes.length, 10);
    assert.equal(new Set(recoveryCodes).size, 10);
    assert.match(recoveryCodes[0], /^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/);
    assert.deepEqual(mfaStatus(userId), {
      enabled: true,
      recoveryCodesRemaining: 10,
    });

    const storedRecoveryCodes = db()
      .prepare(
        "SELECT code_hash FROM mfa_recovery_codes WHERE user_id=? ORDER BY id",
      )
      .all(userId) as { code_hash: string }[];
    assert.equal(storedRecoveryCodes.length, 10);
    for (const [index, row] of storedRecoveryCodes.entries())
      assert.equal(
        row.code_hash.includes(recoveryCodes[index].replaceAll("-", "")),
        false,
      );

    // The enrollment code has already been accepted and cannot be replayed.
    assert.equal(verifySecondFactor(userId, confirmationCode, now), null);
    const nextCode = totpAt(enrollment.secret, now + 30_000);
    assert.equal(verifySecondFactor(userId, nextCode, now + 30_000), "totp");

    assert.equal(
      verifySecondFactor(userId, recoveryCodes[0], now + 31_000),
      "recovery",
    );
    assert.equal(
      verifySecondFactor(userId, recoveryCodes[0], now + 31_000),
      null,
    );
    assert.equal(mfaStatus(userId).recoveryCodesRemaining, 9);

    const replacements = regenerateRecoveryCodes(userId, now + 32_000);
    assert.equal(replacements.length, 10);
    assert.equal(
      verifySecondFactor(userId, recoveryCodes[1], now + 33_000),
      null,
    );
    assert.equal(
      verifySecondFactor(userId, replacements[0], now + 33_000),
      "recovery",
    );
    assert.equal(disableMfa(userId), 1);
    assert.equal(mfaStatus(userId).enabled, false);
  });

  it("expires an unfinished enrollment", () => {
    const enrollment = beginMfaEnrollment(userId, now);
    assert.throws(
      () =>
        confirmMfaEnrollment(
          userId,
          totpAt(enrollment.secret, now + 10 * 60 * 1000 + 1),
          now + 10 * 60 * 1000 + 1,
        ),
      (error: unknown) =>
        error instanceof AppError && error.code === "MFA_SETUP_EXPIRED",
    );
    assert.equal(mfaStatus(userId).enabled, false);
  });
});
