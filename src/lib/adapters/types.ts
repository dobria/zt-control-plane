import type {
  AdapterCapabilities,
  ClientNetwork,
  ControllerStatus,
  ManagedNetwork,
  Moon,
  NetworkGroup,
  NetworkMember,
  RouterOsZeroTierInstance,
  RouterOsZeroTierInstanceInput,
  ZeroTierPeer,
} from "@/lib/types";

interface RouterOsInstanceOperations {
  listInstances?(): Promise<RouterOsZeroTierInstance[]>;
  listHostInterfaces?(): Promise<string[]>;
  createInstance?(
    input: RouterOsZeroTierInstanceInput,
  ): Promise<RouterOsZeroTierInstance>;
  updateInstance?(
    instanceId: string,
    input: RouterOsZeroTierInstanceInput,
  ): Promise<RouterOsZeroTierInstance>;
  deleteInstance?(instanceId: string): Promise<void>;
}

interface EndpointAdapter {
  readonly capabilities: AdapterCapabilities;
  getStatus(): Promise<ControllerStatus>;
  getDiagnostics(): Promise<Record<string, unknown>>;
}

export interface NetworkControllerAdapter
  extends EndpointAdapter, RouterOsInstanceOperations {
  listNetworkGroups?(): Promise<NetworkGroup[]>;
  getNetworkGroup?(groupId: string): Promise<NetworkGroup>;
  createNetworkGroup?(input: Partial<NetworkGroup>): Promise<NetworkGroup>;
  updateNetworkGroup?(
    groupId: string,
    input: Partial<NetworkGroup>,
  ): Promise<NetworkGroup>;
  deleteNetworkGroup?(groupId: string): Promise<void>;
  listNetworks(): Promise<ManagedNetwork[]>;
  getNetwork(networkId: string): Promise<ManagedNetwork>;
  createNetwork(input: Partial<ManagedNetwork>): Promise<ManagedNetwork>;
  updateNetwork(
    networkId: string,
    input: Partial<ManagedNetwork>,
  ): Promise<ManagedNetwork>;
  deleteNetwork(networkId: string): Promise<void>;
  listMembers(networkId: string): Promise<NetworkMember[]>;
  getMember(networkId: string, memberId: string): Promise<NetworkMember>;
  createMember(
    networkId: string,
    memberId: string,
    input: Partial<NetworkMember>,
  ): Promise<NetworkMember>;
  updateMember(
    networkId: string,
    memberId: string,
    input: Partial<NetworkMember>,
  ): Promise<NetworkMember>;
  deleteMember(networkId: string, memberId: string): Promise<void>;
  updateFlowRules?(
    networkId: string,
    source: string,
    compiled: Partial<ManagedNetwork>,
  ): Promise<void>;
}

export interface ManagedNodeAdapter
  extends EndpointAdapter, RouterOsInstanceOperations {
  listVrfs?(): Promise<string[]>;
  listClientNetworks(): Promise<ClientNetwork[]>;
  joinClientNetwork(
    networkId: string,
    input?: Partial<ClientNetwork>,
  ): Promise<ClientNetwork>;
  updateClientNetwork(
    networkId: string,
    input: Partial<ClientNetwork>,
  ): Promise<ClientNetwork>;
  leaveClientNetwork(networkId: string, instance?: string): Promise<void>;
  listPeers(): Promise<ZeroTierPeer[]>;
  listMoons(): Promise<Moon[]>;
  orbitMoon(worldId: string, seed: string): Promise<Moon>;
  deorbitMoon(worldId: string): Promise<void>;
}

export interface ControllerAdapter
  extends NetworkControllerAdapter, ManagedNodeAdapter {}

export class AdapterError extends Error {
  constructor(
    message: string,
    public status = 502,
    public responseBody?: unknown,
  ) {
    super(message.slice(0, 2_000));
  }
}

export type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;
