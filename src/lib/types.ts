export type AppRole = "admin" | "operator" | "auditor" | "viewer";
export type ControllerType =
  "embedded" | "zerotier" | "mikrotik" | "central_v2" | "central_v1";
export type ManagedNodeType = "local" | "zerotier" | "mikrotik";

export type Permission =
  | "controllers:read"
  | "controllers:write"
  | "networks:read"
  | "networks:write"
  | "devices:read"
  | "devices:write"
  | "users:write"
  | "audit:read"
  | "audit:export"
  | "backup:read"
  | "backup:write";

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: AppRole;
  disabled: boolean;
  lastLoginAt: number | null;
  activeControllerId: string | null;
  activeNodeId: string | null;
  landingPage: "/" | "/controllers" | "/nodes" | "/networks" | "/diagnostics";
  reducedMotion: boolean;
  mfaEnabled: boolean;
}

export interface PublicAppSettings {
  workspaceName: string;
  refreshSeconds: 15 | 30 | 60 | 120;
}

export interface AppSettings extends PublicAppSettings {
  sessionHours: number;
  auditRetentionDays: 0 | 30 | 90 | 180 | 365 | 730;
  ipAllowlistEnabled: boolean;
  ipAllowlist: string[];
}

export interface ControllerConfiguration {
  organizationId?: string;
  networkGroupId?: string;
  [key: string]: unknown;
}

export interface ControllerRecord {
  id: string;
  type: ControllerType;
  name: string;
  baseUrl: string;
  encryptedCredentials: string | null;
  enabled: boolean;
  tlsVerify: boolean;
  embedded: boolean;
  configuration: ControllerConfiguration;
  lastCheckedAt: number | null;
  lastOnline: boolean | null;
  lastAddress: string | null;
  lastVersion: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ManagedNodeRecord {
  id: string;
  controllerId: string | null;
  type: ManagedNodeType;
  name: string;
  baseUrl: string;
  encryptedCredentials: string | null;
  enabled: boolean;
  tlsVerify: boolean;
  local: boolean;
  lastCheckedAt: number | null;
  lastOnline: boolean | null;
  lastAddress: string | null;
  lastVersion: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PublicController extends Omit<
  ControllerRecord,
  "encryptedCredentials"
> {
  capabilities: AdapterCapabilities;
}

export interface PublicManagedNode extends Omit<
  ManagedNodeRecord,
  "encryptedCredentials"
> {
  capabilities: AdapterCapabilities;
}

export interface AdapterCapabilities {
  controllerNetworks: boolean;
  networkGroups: boolean;
  networkCrud: boolean;
  memberCrud: boolean;
  manualMemberAdd: boolean;
  flowRules: boolean;
  tagsAndCapabilities: boolean;
  networkSso: boolean;
  managedRoutes: boolean;
  managedDns: boolean;
  ipAssignment: boolean;
  v4AutoAssignMode: boolean;
  multipleIpPools: boolean;
  ipv6Assignment: boolean;
  customIpv6Pools: boolean;
  multicast: boolean;
  memberIpAssignments: boolean;
  memberDetails: boolean;
  clientNetworks: boolean;
  clientDns: boolean;
  peers: boolean;
  moons: boolean;
  rawConfiguration: boolean;
}

export interface ControllerStatus {
  online: boolean;
  address: string | null;
  version: string | null;
  platform: string;
  details?: Record<string, unknown>;
}

export interface ManagedNetwork {
  id: string;
  name: string;
  comment?: string;
  instance?: string;
  private: boolean;
  disabled?: boolean;
  mtu?: number;
  enableBroadcast?: boolean;
  multicastLimit?: number;
  routes?: Array<{ target: string; via?: string | null }>;
  ipAssignmentPools?: Array<{ ipRangeStart: string; ipRangeEnd: string }>;
  v4AssignMode?: Record<string, boolean>;
  v6AssignMode?: Record<string, boolean>;
  dns?: [] | { domain?: string; servers?: string[] };
  rules?: unknown[];
  capabilities?: unknown[];
  tags?: unknown[];
  revision?: number;
  creationTime?: number;
  memberCount?: number;
  raw?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface NetworkGroup {
  id: string;
  name: string;
  description: string;
  networkCount?: number;
  raw?: Record<string, unknown>;
}

export interface NetworkMember {
  id: string;
  name: string;
  comment?: string;
  authorized: boolean;
  disabled?: boolean;
  activeBridge?: boolean;
  noAutoAssignIps?: boolean;
  ssoExempt?: boolean;
  ipAssignments?: string[];
  capabilities?: unknown[];
  tags?: unknown[];
  creationTime?: number;
  lastAuthorizedTime?: number;
  lastDeauthorizedTime?: number;
  version?: string | null;
  lastSeen?: string;
  raw?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ClientNetwork {
  id: string;
  name: string;
  instance?: string;
  comment?: string;
  disabled?: boolean;
  running?: boolean;
  status: string;
  type?: string;
  mac?: string;
  mtu?: number;
  actualMtu?: number;
  vrf?: string;
  arpTimeout?: string;
  disableRunningCheck?: boolean;
  assignedAddresses?: string[];
  allowManaged?: boolean;
  allowDefault?: boolean;
  allowGlobal?: boolean;
  allowDNS?: boolean;
  raw?: Record<string, unknown>;
}

export interface Moon {
  id: string;
  waiting: boolean;
  timestamp?: number;
  roots?: Array<{
    identity?: string;
    stableEndpoints?: string[];
  }>;
  signature?: string | null;
  updatesMustBeSignedBy?: string | null;
  raw?: Record<string, unknown>;
}

export interface PeerPath {
  address: string;
  active: boolean;
  preferred: boolean;
  expired: boolean;
  lastReceive: number | null;
  lastSend: number | null;
}

export interface ZeroTierPeer {
  address: string;
  instance?: string;
  role: string;
  version: string | null;
  latency: number | null;
  tunneled: boolean;
  paths: PeerPath[];
  raw?: Record<string, unknown>;
}

export interface RouterOsZeroTierInstance {
  id: string;
  name: string;
  comment: string;
  port: number | null;
  interfaces: string[];
  routeDistance: number | null;
  disabled: boolean;
  online: boolean;
  state: string;
  address: string | null;
  identityPublic: string | null;
  moons: string[];
}

export interface RouterOsZeroTierInstanceInput {
  name: string;
  comment?: string;
  port?: number;
  interfaces?: string[];
  routeDistance?: number;
  enabled?: boolean;
}

export interface AuditEntry {
  id: number;
  timestamp: number;
  userId: string | null;
  userEmail: string | null;
  controllerId: string | null;
  controllerName: string | null;
  nodeId: string | null;
  nodeName: string | null;
  action: string;
  method: string;
  target: string;
  status: number;
  ok: boolean;
  detail: string | null;
}

export type OverviewControllerHealth =
  "online" | "degraded" | "offline" | "disabled";

export interface OverviewNetworkSnapshot {
  id: string;
  name: string;
  private: boolean;
  memberCount: number;
  routeCount: number;
}

export interface OverviewControllerSnapshot {
  id: string;
  name: string;
  type: ControllerType;
  embedded: boolean;
  enabled: boolean;
  health: OverviewControllerHealth;
  address: string | null;
  version: string | null;
  platform: string;
  checkedAt: number | null;
  managedNodeCount: number;
  networks: OverviewNetworkSnapshot[];
  stale: boolean;
  error: string | null;
}

export interface OverviewSnapshot {
  generatedAt: number;
  controllers: OverviewControllerSnapshot[];
  totals: {
    controllers: number;
    enabledControllers: number;
    onlineControllers: number;
    networks: number;
    members: number;
    managedNodes: number;
    issues: number;
  };
}

export interface NetworkInventoryItem {
  controllerId: string;
  controllerName: string;
  controllerType: ControllerType;
  controllerEnabled: boolean;
  controllerOnline: boolean | null;
  network: ManagedNetwork;
  lastSyncedAt: number | null;
  stale: boolean;
  error: string | null;
}

export interface InventoryControllerState {
  id: string;
  name: string;
  type: ControllerType;
  enabled: boolean;
  online: boolean | null;
  networkCount: number;
  stale: boolean;
  error: string | null;
  lastSyncedAt: number | null;
}

export interface NetworkInventorySnapshot {
  generatedAt: number;
  items: NetworkInventoryItem[];
  controllers: InventoryControllerState[];
}

export interface NodeInventoryMembership {
  controllerId: string;
  controllerName: string;
  controllerType: ControllerType;
  networkId: string;
  networkName: string;
  member: NetworkMember;
  lastSyncedAt: number | null;
  stale: boolean;
}

export interface ManagedEndpointInventoryItem {
  id: string;
  controllerId: string | null;
  controllerName: string | null;
  type: ManagedNodeType;
  name: string;
  enabled: boolean;
  online: boolean | null;
  address: string | null;
  version: string | null;
  instances: RouterOsZeroTierInstance[];
  joinedNetworks: ClientNetwork[];
  lastSyncedAt: number | null;
  stale: boolean;
  error: string | null;
}

export interface NodeInventoryIdentity {
  id: string;
  address: string | null;
  name: string;
  managed: boolean;
  online: boolean | null;
  endpointIds: string[];
  memberships: NodeInventoryMembership[];
  authorizedMemberships: number;
  pendingMemberships: number;
  controllerCount: number;
  networkCount: number;
  stale: boolean;
}

export interface NodeInventorySnapshot {
  generatedAt: number;
  identities: NodeInventoryIdentity[];
  endpoints: ManagedEndpointInventoryItem[];
  controllers: InventoryControllerState[];
}
