import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateFlowSource,
  generatedSubnet,
  memberDraftFrom,
} from "@/features/networks/network-detail/model";

describe("network editor model", () => {
  it("generates a valid private subnet and assignment range", () => {
    const generated = generatedSubnet();
    assert.match(generated.route, /^10\.\d+\.\d+\.0\/24$/);
    const prefix = generated.route.replace(/0\/24$/, "");
    assert.equal(generated.start, `${prefix}1`);
    assert.equal(generated.end, `${prefix}254`);
    const [, second, third] = generated.route.match(/^10\.(\d+)\.(\d+)\./)!;
    assert.ok(Number(second) >= 16 && Number(second) <= 239);
    assert.ok(Number(third) >= 1 && Number(third) <= 253);
  });

  it("maps API member data into an editable draft without losing policy fields", () => {
    const draft = memberDraftFrom({
      id: "abcdef0123",
      name: "Workstation",
      authorized: true,
      activeBridge: false,
      noAutoAssignIps: true,
      ipAssignments: ["10.0.0.10"],
      capabilities: [1, 2],
      tags: [[7, 9]],
    });
    assert.equal(draft.id, "abcdef0123");
    assert.equal(draft.authorized, true);
    assert.deepEqual(draft.ipAssignments, ["10.0.0.10"]);
    assert.equal(draft.capabilitiesJson, "[\n  1,\n  2\n]");
    assert.equal(draft.tagsJson, "[\n  [\n    7,\n    9\n  ]\n]");
  });

  it("removes API padding from a member remote trace target", () => {
    const emptyTarget = memberDraftFrom({
      id: "abcdef0123",
      name: "",
      authorized: true,
      remoteTraceTarget: "                    ",
    });
    const populatedTarget = memberDraftFrom({
      id: "abcdef0123",
      name: "",
      authorized: true,
      remoteTraceTarget: "  ABCDEF0123  ",
    });

    assert.equal(emptyTarget.remoteTraceTarget, "");
    assert.equal(populatedTarget.remoteTraceTarget, "abcdef0123");
  });

  it("generates an explicit accept/drop rule set for restricted traffic", () => {
    const source = generateFlowSource({
      layer2Only: true,
      restrict: true,
      services: ["ping", "dns", "https", "ssh"],
      exemptMembers: [],
      custom: [{ name: "Admin", protocol: "tcp", port: "8443" }],
    });
    assert.match(source, /drop not ethertype ipv4/);
    assert.match(source, /ipprotocol icmp/);
    assert.match(source, /dport 53/);
    assert.match(source, /dport 8443/);
    assert.match(source, /drop;/);
  });
});
