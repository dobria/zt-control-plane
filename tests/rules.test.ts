import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDeepStrictEqual } from "node:util";
import {
  defaultPolicy,
  generateFlowSource,
} from "@/features/networks/network-detail/model";
import { compileRules, RuleCompileError } from "@/lib/rules";

describe("ZeroTier Flow Rules compiler", () => {
  it("compiles a valid default policy into controller structures", () => {
    const result = compileRules("accept;");
    assert.ok(result.config.rules.length > 0);
    assert.deepEqual(result.config.capabilities, []);
    assert.deepEqual(result.config.tags, []);
  });

  it("returns useful source coordinates for invalid policies", () => {
    assert.throws(() => compileRules("accept ipprotocol;"), RuleCompileError);
  });

  for (const layer2Only of [false, true]) {
    for (const services of [[], ["http", "https"]]) {
      it(`compiles adding Ping to ${services.length ? "HTTP/HTTPS" : "an empty allow-list"} with the Ethernet guardrail ${layer2Only ? "on" : "off"}`, () => {
        const policy = {
          ...defaultPolicy,
          restrict: true,
          layer2Only,
          services,
        };
        const before = compileRules(generateFlowSource(policy)).config.rules;
        const after = compileRules(
          generateFlowSource({ ...policy, services: [...services, "ping"] }),
        ).config.rules;
        const pingRules = [
          { type: "MATCH_IP_PROTOCOL", not: false, or: false, ipProtocol: 1 },
          { type: "ACTION_ACCEPT" },
          { type: "MATCH_IP_PROTOCOL", not: false, or: false, ipProtocol: 58 },
          { type: "ACTION_ACCEPT" },
        ];
        const pingIndex = after.findIndex((rule) =>
          isDeepStrictEqual(rule, pingRules[0]),
        );

        assert.ok(pingIndex >= 0, "IPv4 ICMP must be allowed");
        assert.deepEqual(after.slice(pingIndex, pingIndex + 4), pingRules);
        assert.deepEqual(
          [...after.slice(0, pingIndex), ...after.slice(pingIndex + 4)],
          before,
          "Existing traffic rules must remain unchanged when Ping is added",
        );
        assert.deepEqual(after.at(-1), { type: "ACTION_DROP" });
      });
    }
  }
});
