import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
});
