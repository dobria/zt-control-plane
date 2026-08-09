import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { after, before, describe, it } from "node:test";
import {
  assertLoginRateLimit,
  clearLoginRateLimit,
  loginRateLimitBuckets,
  mfaRateLimitBucket,
  recordLoginFailure,
  assertSameOrigin,
} from "@/lib/auth";
import { closeDatabaseForTests, queryOne } from "@/lib/database";
import { AppError } from "@/lib/errors";

const databaseFile = path.join(
  tmpdir(),
  `ztcp-rate-limit-${randomUUID()}.sqlite`,
);

before(() => {
  process.env.DATABASE_PATH = databaseFile;
  process.env.APP_SECRET = "rate-limit-test-secret-that-is-long-enough";
});

after(() => {
  delete process.env.APP_PUBLIC_URL;
  process.env.TRUST_PROXY = "0";
  closeDatabaseForTests();
});

describe("persistent login throttling", () => {
  it("uses a separate, privacy-preserving MFA bucket", () => {
    const bucket = mfaRateLimitBucket("user-123");
    const accountBucket = loginRateLimitBuckets(
      new Request("https://control.example/api/auth/login"),
      "user-123",
    )[0];
    assert.equal(bucket.scope, "mfa");
    assert.equal(bucket.limit, 10);
    assert.match(bucket.key, /^mfa:[a-f0-9]{64}$/);
    assert.equal(bucket.key.includes("user-123"), false);
    assert.notEqual(bucket.key.slice(4), accountBucket.key.slice(8));
  });

  it("limits account attempts in SQLite and can clear the bucket", () => {
    const buckets = [
      { key: "account:test", limit: 2, scope: "account" as const },
    ];
    recordLoginFailure(buckets);
    recordLoginFailure(buckets);
    assert.throws(
      () => recordLoginFailure(buckets),
      (error: unknown) =>
        error instanceof AppError &&
        error.status === 429 &&
        error.code === "RATE_LIMITED",
    );
    assert.equal(
      queryOne<{ count: number }>(
        "SELECT count FROM login_attempts WHERE key=?",
        "account:test",
      )?.count,
      2,
    );
    clearLoginRateLimit(buckets);
    assert.equal(
      queryOne<{ count: number }>(
        "SELECT count FROM login_attempts WHERE key=?",
        "account:test",
      ),
      undefined,
    );
  });

  it("uses proxy IP headers only when the deployment explicitly trusts them", () => {
    const request = new Request("https://control.example/api/auth/login", {
      headers: { "x-forwarded-for": "203.0.113.8" },
    });
    process.env.TRUST_PROXY = "0";
    assert.equal(loginRateLimitBuckets(request, "a@example.com").length, 2);
    process.env.TRUST_PROXY = "1";
    assert.equal(loginRateLimitBuckets(request, "a@example.com").length, 3);
    process.env.TRUST_PROXY = "0";
  });

  it("uses the canonical public origin instead of forwarded host headers", () => {
    const request = new Request("https://control.example/api/test", {
      headers: {
        host: "control.example",
        origin: "https://attacker.example",
        "x-forwarded-host": "attacker.example",
      },
    });
    process.env.TRUST_PROXY = "1";
    process.env.APP_PUBLIC_URL = "https://control.example";
    assert.throws(
      () => assertSameOrigin(request),
      (error: unknown) =>
        error instanceof AppError && error.code === "CSRF_REJECTED",
    );
    const valid = new Request("http://internal:3000/api/test", {
      headers: {
        host: "internal:3000",
        origin: "https://control.example",
        "x-forwarded-host": "attacker.example",
      },
    });
    assert.doesNotThrow(() => assertSameOrigin(valid));
    process.env.TRUST_PROXY = "0";
    delete process.env.APP_PUBLIC_URL;
  });

  it("fails closed when mutation origin metadata is missing", () => {
    process.env.TRUST_PROXY = "0";
    const missing = new Request("https://control.example/api/test", {
      headers: { host: "control.example" },
    });
    assert.throws(
      () => assertSameOrigin(missing),
      (error: unknown) =>
        error instanceof AppError && error.code === "CSRF_REJECTED",
    );
    const fetchMetadata = new Request("https://control.example/api/test", {
      headers: {
        host: "control.example",
        "sec-fetch-site": "same-origin",
      },
    });
    assert.doesNotThrow(() => assertSameOrigin(fetchMetadata));
  });

  it("requires a canonical public URL for trusted-proxy mutations", () => {
    process.env.TRUST_PROXY = "1";
    delete process.env.APP_PUBLIC_URL;
    const request = new Request("http://internal:3000/api/test", {
      headers: {
        host: "internal:3000",
        "sec-fetch-site": "same-origin",
      },
    });
    assert.throws(
      () => assertSameOrigin(request),
      (error: unknown) =>
        error instanceof AppError && error.code === "PUBLIC_URL_REQUIRED",
    );
    process.env.TRUST_PROXY = "0";
  });

  it("pre-checks an exhausted IP bucket without locking a valid account", () => {
    const buckets = [
      { key: "account:valid", limit: 1, scope: "account" as const },
      { key: "ip:shared", limit: 2, scope: "ip" as const },
    ];
    recordLoginFailure([buckets[0]]);
    assert.doesNotThrow(() =>
      assertLoginRateLimit(buckets.filter((bucket) => bucket.scope === "ip")),
    );
    clearLoginRateLimit(buckets);
  });

  it("continues counting the source IP after an account bucket is exhausted", () => {
    const buckets = [
      { key: "account:target", limit: 1, scope: "account" as const },
      { key: "ip:attacker", limit: 3, scope: "ip" as const },
    ];
    recordLoginFailure(buckets);
    assert.throws(() => recordLoginFailure(buckets), AppError);
    assert.equal(
      queryOne<{ count: number }>(
        "SELECT count FROM login_attempts WHERE key=?",
        "ip:attacker",
      )?.count,
      2,
    );
    clearLoginRateLimit(buckets);
  });
});
