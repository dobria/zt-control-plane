import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveActiveNode } from "@/lib/active-node";
import type { PublicManagedNode } from "@/lib/types";

function node(
  id: string,
  controllerId: string,
  enabled = true,
): PublicManagedNode {
  return {
    id,
    controllerId,
    type: "zerotier",
    name: id,
    baseUrl: `http://${id}:9993`,
    enabled,
    tlsVerify: true,
    local: false,
    lastCheckedAt: null,
    lastOnline: null,
    lastAddress: null,
    lastVersion: null,
    lastError: null,
    createdAt: 1,
    updatedAt: 1,
    capabilities: {
      controllerNetworks: false,
      networkGroups: false,
      networkCrud: false,
      memberCrud: false,
      manualMemberAdd: false,
      flowRules: false,
      tagsAndCapabilities: false,
      networkSso: false,
      managedRoutes: false,
      managedDns: false,
      ipAssignment: false,
      v4AutoAssignMode: false,
      multipleIpPools: false,
      ipv6Assignment: false,
      customIpv6Pools: false,
      multicast: false,
      memberIpAssignments: false,
      memberDetails: false,
      clientNetworks: false,
      clientDns: false,
      peers: false,
      moons: false,
      rawConfiguration: false,
    },
  };
}

describe("active managed-node selection", () => {
  it("honors the persisted preference within the selected controller", () => {
    const nodes = [node("first", "controller-a"), node("second", "controller-a")];
    assert.equal(
      resolveActiveNode(nodes, "controller-a", "second")?.id,
      "second",
    );
  });

  it("does not leak a preference from another controller", () => {
    const nodes = [node("a", "controller-a"), node("b", "controller-b")];
    assert.equal(resolveActiveNode(nodes, "controller-b", "a")?.id, "b");
  });

  it("falls back to the first enabled node", () => {
    const nodes = [
      node("disabled", "controller-a", false),
      node("enabled", "controller-a"),
    ];
    assert.equal(resolveActiveNode(nodes, "controller-a", null)?.id, "enabled");
  });
});
