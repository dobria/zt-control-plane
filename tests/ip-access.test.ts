import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  ipMatchesAccessList,
  normalizeIpAccessRules,
  trustedClientIp,
  validateIpAccessConfiguration,
} from "@/lib/ip-access";

const originalTrustProxy = process.env.TRUST_PROXY;

afterEach(() => {
  if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = originalTrustProxy;
});

describe("web IP access list", () => {
  it("normalizes exact IPv4, IPv6 and CIDR rules", () => {
    assert.deepEqual(
      normalizeIpAccessRules([
        " 203.0.113.8 ",
        "10.20.0.4/16",
        "2001:DB8:1234::/48",
        "203.0.113.8",
        "",
      ]),
      ["203.0.113.8", "10.20.0.4/16", "2001:db8:1234::/48"],
    );
  });

  it("rejects malformed addresses and CIDR prefixes", () => {
    assert.throws(() => normalizeIpAccessRules(["not-an-ip"]));
    assert.throws(() => normalizeIpAccessRules(["10.0.0.1/33"]));
    assert.throws(() => normalizeIpAccessRules(["2001:db8::/129"]));
  });

  it("matches exact addresses, subnets and IPv4-mapped IPv6 addresses", () => {
    const rules = ["203.0.113.8", "10.20.0.0/16", "2001:db8::/48"];
    assert.equal(ipMatchesAccessList("203.0.113.8", rules), true);
    assert.equal(ipMatchesAccessList("10.20.44.9", rules), true);
    assert.equal(ipMatchesAccessList("::ffff:10.20.44.9", rules), true);
    assert.equal(ipMatchesAccessList("2001:db8::beef", rules), true);
    assert.equal(ipMatchesAccessList("192.0.2.10", rules), false);
  });

  it("trusts forwarding headers only when explicitly configured", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.8, 172.18.0.2",
      "x-real-ip": "192.0.2.2",
    });
    process.env.TRUST_PROXY = "0";
    assert.equal(trustedClientIp(headers), null);
    process.env.TRUST_PROXY = "1";
    assert.equal(trustedClientIp(headers), "203.0.113.8");
  });

  it("fails closed when a trusted proxy supplies an invalid client address", () => {
    process.env.TRUST_PROXY = "1";
    const headers = new Headers({
      "x-forwarded-for": "invalid, 172.18.0.2",
      "x-real-ip": "203.0.113.8",
    });
    assert.equal(trustedClientIp(headers), null);
  });

  it("prevents activation without a trusted proxy or a matching current address", () => {
    assert.throws(() =>
      validateIpAccessConfiguration({
        enabled: true,
        rules: ["203.0.113.8"],
        clientIp: "203.0.113.8",
        trustedProxy: false,
      }),
    );
    assert.throws(
      () =>
        validateIpAccessConfiguration({
          enabled: true,
          rules: ["203.0.113.8"],
          clientIp: "192.0.2.4",
          trustedProxy: true,
        }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "IP_ALLOWLIST_LOCKOUT",
    );
    assert.deepEqual(
      validateIpAccessConfiguration({
        enabled: true,
        rules: ["203.0.113.0/24"],
        clientIp: "203.0.113.8",
        trustedProxy: true,
      }),
      ["203.0.113.0/24"],
    );
  });
});
