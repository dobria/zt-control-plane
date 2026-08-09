import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  decryptJson,
  encryptJson,
  getSecretKey,
  resetSecretCacheForTests,
} from "@/lib/secrets";
import {
  dummyPasswordHash,
  hashPassword,
  passwordHashNeedsUpgrade,
  verifyPassword,
} from "@/lib/passwords";
import { ValidationError } from "@/lib/validation";
import {
  backupMemberConfiguration,
  backupNetworkConfiguration,
} from "@/lib/backup";
import { endpointAddressIsForbidden } from "@/lib/endpoint-security";
import { redactSensitiveValues } from "@/lib/redaction";
import {
  resetSetupTokenCacheForTests,
  verifySetupToken,
} from "@/lib/setup-token";

describe("credential encryption", () => {
  it("round-trips credentials with randomized AES-GCM ciphertext", () => {
    process.env.APP_SECRET = "integration-test-secret-that-is-long-enough";
    resetSecretCacheForTests();
    const value = { apiToken: "highly-sensitive-token" };
    const first = encryptJson(value);
    const second = encryptJson(value);
    assert.notEqual(first, second);
    assert.equal(first.includes(value.apiToken), false);
    assert.deepEqual(decryptJson(first), value);
  });

  it("rejects tampered encrypted values", () => {
    process.env.APP_SECRET = "integration-test-secret-that-is-long-enough";
    resetSecretCacheForTests();
    const encrypted = encryptJson({ password: "secret" });
    const last = encrypted.at(-1) === "a" ? "b" : "a";
    assert.throws(() => decryptJson(`${encrypted.slice(0, -1)}${last}`));
  });

  it("creates a persistent secret atomically with private permissions", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ztcp-secret-"));
    const previousSecret = process.env.APP_SECRET;
    const previousDirectory = process.env.APP_DATA_DIR;
    delete process.env.APP_SECRET;
    process.env.APP_DATA_DIR = directory;
    resetSecretCacheForTests();
    try {
      const key = getSecretKey();
      const secretPath = path.join(directory, "app.secret");
      assert.equal(readFileSync(secretPath, "utf8"), key.toString("hex"));
      if (process.platform !== "win32")
        assert.equal(statSync(secretPath).mode & 0o777, 0o600);
      resetSecretCacheForTests();
      assert.deepEqual(getSecretKey(), key);
    } finally {
      if (previousSecret === undefined) delete process.env.APP_SECRET;
      else process.env.APP_SECRET = previousSecret;
      if (previousDirectory === undefined) delete process.env.APP_DATA_DIR;
      else process.env.APP_DATA_DIR = previousDirectory;
      resetSecretCacheForTests();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a symbolic link used as the persistent secret", {
    skip: process.platform === "win32",
  }, () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ztcp-secret-link-"));
    const victim = path.join(directory, "victim");
    const secretPath = path.join(directory, "app.secret");
    const previousSecret = process.env.APP_SECRET;
    const previousSecretFile = process.env.APP_SECRET_FILE;
    writeFileSync(victim, "must-not-change", { mode: 0o600 });
    symlinkSync(victim, secretPath);
    delete process.env.APP_SECRET;
    process.env.APP_SECRET_FILE = secretPath;
    resetSecretCacheForTests();
    try {
      assert.throws(() => getSecretKey());
      assert.equal(readFileSync(victim, "utf8"), "must-not-change");
    } finally {
      if (previousSecret === undefined) delete process.env.APP_SECRET;
      else process.env.APP_SECRET = previousSecret;
      if (previousSecretFile === undefined) delete process.env.APP_SECRET_FILE;
      else process.env.APP_SECRET_FILE = previousSecretFile;
      resetSecretCacheForTests();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("password hashing", () => {
  it("uses salted scrypt hashes and constant-time verification", async () => {
    const password = "correct horse battery staple";
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    assert.match(first, /^scrypt\$v2\$32768\$8\$3\$/);
    assert.notEqual(first, second);
    assert.equal(await verifyPassword(password, first), true);
    assert.equal(await verifyPassword("incorrect password", first), false);
    assert.equal(passwordHashNeedsUpgrade(first), false);
  });

  it("verifies legacy hashes and marks them for an automatic upgrade", async () => {
    const password = "correct horse battery staple";
    const salt = Buffer.from("legacy-test-salt", "utf8");
    const key = scryptSync(password, salt, 64);
    const encoded = `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
    assert.equal(await verifyPassword(password, encoded), true);
    assert.equal(passwordHashNeedsUpgrade(encoded), true);
  });

  it("enforces the minimum password length at the server boundary", async () => {
    await assert.rejects(() => hashPassword("too-short"), ValidationError);
  });

  it("provides a valid dummy hash for the unknown-account verification path", async () => {
    assert.match(dummyPasswordHash(), /^scrypt\$v2\$32768\$8\$3\$/);
    assert.equal(
      await verifyPassword(
        "an-attacker-supplied-password",
        dummyPasswordHash(),
      ),
      false,
    );
  });

  it("rejects malformed hashes before allowing attacker-controlled scrypt sizes", async () => {
    assert.equal(await verifyPassword("password", "scrypt$YQ$YQ"), false);
    assert.equal(
      await verifyPassword(
        "password",
        "scrypt$v2$1073741824$8$3$YWFhYWFhYWFhYWFhYWFhYQ$YQ",
      ),
      false,
    );
  });
});

describe("provider boundary hardening", () => {
  it("blocks metadata, link-local and reserved addresses but permits private overlays", () => {
    assert.equal(endpointAddressIsForbidden("169.254.169.254"), true);
    assert.equal(endpointAddressIsForbidden("::ffff:169.254.169.254"), true);
    assert.equal(endpointAddressIsForbidden("fe80::1"), true);
    assert.equal(endpointAddressIsForbidden("ff02::1"), true);
    assert.equal(endpointAddressIsForbidden("10.147.17.4"), false);
    assert.equal(endpointAddressIsForbidden("127.0.0.1"), false);
  });

  it("exports only portable network and member configuration", () => {
    const network = backupNetworkConfiguration({
      id: "0123456789abcdef",
      name: "Private network",
      private: true,
      raw: { providerSecret: "must-not-leak" },
      providerSecret: "must-not-leak",
    });
    const member = backupMemberConfiguration({
      id: "0123456789",
      name: "Node",
      authorized: true,
      raw: { privateIdentity: "must-not-leak" },
      privateIdentity: "must-not-leak",
    });
    assert.deepEqual(network, {
      id: "0123456789abcdef",
      name: "Private network",
      private: true,
    });
    assert.deepEqual(member, {
      id: "0123456789",
      name: "Node",
      authorized: true,
    });
  });

  it("redacts nested secrets from diagnostics without hiding network privacy", () => {
    assert.deepEqual(
      redactSensitiveValues({
        private: true,
        token: "provider-token",
        nested: { password: "router-password", address: "10.0.0.1" },
      }),
      {
        private: true,
        token: "[redacted]",
        nested: { password: "[redacted]", address: "10.0.0.1" },
      },
    );
  });
});

describe("first-run ownership", () => {
  it("requires a separate high-entropy setup token", () => {
    process.env.APP_SETUP_TOKEN = "test-setup-token-that-is-long-enough";
    resetSetupTokenCacheForTests();
    assert.equal(
      verifySetupToken("test-setup-token-that-is-long-enough"),
      true,
    );
    assert.equal(verifySetupToken("wrong-token"), false);
    delete process.env.APP_SETUP_TOKEN;
    resetSetupTokenCacheForTests();
  });
});
