import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  instanceWorkspaceQuery,
  normalizeInstanceWorkspaceView,
} from "@/lib/routeros-workspace";

describe("RouterOS instance workspace navigation", () => {
  it("normalizes unsupported views to overview", () => {
    assert.equal(normalizeInstanceWorkspaceView("peers"), "peers");
    assert.equal(normalizeInstanceWorkspaceView("unknown"), "overview");
    assert.equal(normalizeInstanceWorkspaceView(null), "overview");
  });

  it("persists the selected instance and role without losing other state", () => {
    const result = new URLSearchParams(
      instanceWorkspaceQuery(
        new URLSearchParams("source=controller"),
        "edge-west",
        "controlled",
      ),
    );
    assert.equal(result.get("source"), "controller");
    assert.equal(result.get("instance"), "edge-west");
    assert.equal(result.get("view"), "controlled");
  });
});
