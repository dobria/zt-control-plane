import type {
  AdapterCapabilities,
  ControllerType,
  ManagedNodeType,
} from "@/lib/types";

const zeroTierController: AdapterCapabilities = {
  controllerNetworks: true,
  networkGroups: false,
  networkCrud: true,
  memberCrud: true,
  manualMemberAdd: true,
  flowRules: true,
  tagsAndCapabilities: true,
  networkSso: true,
  managedRoutes: true,
  managedDns: true,
  ipAssignment: true,
  v4AutoAssignMode: true,
  multipleIpPools: true,
  ipv6Assignment: true,
  customIpv6Pools: true,
  multicast: true,
  memberIpAssignments: true,
  memberDetails: true,
  clientNetworks: false,
  clientDns: false,
  peers: false,
  moons: false,
  rawConfiguration: true,
};

const centralV2: AdapterCapabilities = {
  ...zeroTierController,
  networkGroups: true,
};

const mikrotikController: AdapterCapabilities = {
  ...zeroTierController,
  manualMemberAdd: true,
  flowRules: false,
  tagsAndCapabilities: false,
  networkSso: false,
  managedDns: false,
  memberIpAssignments: true,
  memberDetails: true,
  v4AutoAssignMode: false,
  multipleIpPools: false,
  customIpv6Pools: false,
};

const zeroTierNode: AdapterCapabilities = {
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
  clientNetworks: true,
  clientDns: true,
  peers: true,
  moons: true,
  rawConfiguration: false,
};

const mikrotikNode: AdapterCapabilities = {
  ...zeroTierNode,
  peers: true,
  moons: false,
  clientDns: false,
};

export function capabilitiesForType(type: ControllerType): AdapterCapabilities {
  if (type === "mikrotik") return { ...mikrotikController };
  if (type === "central_v2") return { ...centralV2 };
  return { ...zeroTierController };
}

export function capabilitiesForNodeType(
  type: ManagedNodeType,
): AdapterCapabilities {
  return type === "mikrotik" ? { ...mikrotikNode } : { ...zeroTierNode };
}
