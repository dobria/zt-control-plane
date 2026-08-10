import { ValidationError, memberId, optionalText } from "@/lib/validation";
import type { ClientNetwork, ManagedNetwork, NetworkMember } from "@/lib/types";
import { isIP } from "node:net";

function optionalBoolean(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean")
    throw new ValidationError(`${field} must be true or false.`);
  return value;
}

function optionalNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new ValidationError(`${field} must be a number.`);
  if (value < minimum || value > maximum)
    throw new ValidationError(
      `${field} must be between ${minimum} and ${maximum}.`,
    );
  return value;
}

function object(value: unknown, field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ValidationError(`${field} must be an object.`);
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string, maximum = 512) {
  if (!Array.isArray(value))
    throw new ValidationError(`${field} must be an array.`);
  if (value.length > maximum)
    throw new ValidationError(`${field} contains too many entries.`);
  return value;
}

function booleanMap(value: unknown, field: string) {
  const input = object(value, field);
  const result: Record<string, boolean> = {};
  for (const [key, enabled] of Object.entries(input)) {
    if (typeof enabled !== "boolean")
      throw new ValidationError(`${field}.${key} must be true or false.`);
    result[key] = enabled;
  }
  return result;
}

function textArray(value: unknown, field: string, maximum = 256) {
  return array(value, field, maximum).map((item) => {
    if (typeof item !== "string" || !item.trim())
      throw new ValidationError(`${field} must contain non-empty strings.`);
    return item.trim();
  });
}

function ipAddress(value: unknown, field: string) {
  const result = optionalText(value, 80);
  if (!result || !isIP(result))
    throw new ValidationError(`${field} must be a valid IP address.`);
  return result;
}

function traceTarget(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value !== "string")
    throw new ValidationError("Remote trace target must be text.");
  const result = value.trim().toLowerCase();
  if (!result) return "";
  if (!/^[0-9a-f]{10}$/.test(result))
    throw new ValidationError(
      "Remote trace target must contain 10 hexadecimal characters.",
    );
  return result;
}

function cidr(value: unknown, field: string) {
  const result = optionalText(value, 160);
  const [address, prefix, ...extra] = result.split("/");
  const family = isIP(address);
  const parsedPrefix = Number(prefix);
  const maximum = family === 4 ? 32 : family === 6 ? 128 : -1;
  if (
    extra.length ||
    maximum < 0 ||
    !/^\d+$/.test(prefix || "") ||
    !Number.isInteger(parsedPrefix) ||
    parsedPrefix < 0 ||
    parsedPrefix > maximum
  )
    throw new ValidationError(
      `${field} must be a valid IP network in CIDR notation.`,
    );
  return result;
}

function integerArray(value: unknown, field: string, maximum = 4096) {
  return array(value, field, maximum).map((item) => {
    if (!Number.isSafeInteger(item) || Number(item) < 0)
      throw new ValidationError(`${field} must contain non-negative integers.`);
    return Number(item);
  });
}

function tagArray(value: unknown) {
  return array(value, "Tags", 4096).map((item) => {
    const pair = array(item, "Tag", 2);
    if (
      pair.length !== 2 ||
      !pair.every((part) => Number.isSafeInteger(part) && Number(part) >= 0)
    )
      throw new ValidationError(
        "Each tag must contain an integer ID and value.",
      );
    return [Number(pair[0]), Number(pair[1])];
  });
}

function boundedJson(value: unknown, field: string, depth = 0): unknown {
  if (depth > 8) throw new ValidationError(`${field} is nested too deeply.`);
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return value;
  if (typeof value === "string") {
    if (value.length > 2048)
      throw new ValidationError(`${field} contains an oversized string.`);
    return value;
  }
  if (Array.isArray(value))
    return array(value, field, 1024).map((item, index) =>
      boundedJson(item, `${field}[${index}]`, depth + 1),
    );
  const input = object(value, field);
  const entries = Object.entries(input);
  if (entries.length > 64)
    throw new ValidationError(`${field} contains too many properties.`);
  return Object.fromEntries(
    entries.map(([key, item]) => {
      if (!key || key.length > 128)
        throw new ValidationError(`${field} contains an invalid property.`);
      return [key, boundedJson(item, `${field}.${key}`, depth + 1)];
    }),
  );
}

function compiledRules(value: unknown) {
  return array(value, "Rules", 1024).map((entry, index) => {
    object(entry, `Rule ${index + 1}`);
    return boundedJson(entry, `Rule ${index + 1}`);
  });
}

function compiledCapabilities(value: unknown) {
  return array(value, "Capabilities", 256).map((entry, index) => {
    const capability = object(entry, `Capability ${index + 1}`);
    if (!Number.isSafeInteger(capability.id) || Number(capability.id) < 0)
      throw new ValidationError(
        `Capability ${index + 1} must contain a non-negative integer ID.`,
      );
    if (capability.rules !== undefined) compiledRules(capability.rules);
    return boundedJson(capability, `Capability ${index + 1}`);
  });
}

function compiledTags(value: unknown) {
  return array(value, "Tags", 256).map((entry, index) => {
    const tag = object(entry, `Tag ${index + 1}`);
    if (!Number.isSafeInteger(tag.id) || Number(tag.id) < 0)
      throw new ValidationError(
        `Tag ${index + 1} must contain a non-negative integer ID.`,
      );
    if (
      tag.default !== undefined &&
      tag.default !== null &&
      (!Number.isSafeInteger(tag.default) || Number(tag.default) < 0)
    )
      throw new ValidationError(
        `Tag ${index + 1} default must be a non-negative integer or null.`,
      );
    return boundedJson(tag, `Tag ${index + 1}`);
  });
}

export function networkPayload(body: Record<string, unknown>) {
  const result: Partial<ManagedNetwork> = {};
  if (body.name !== undefined) result.name = optionalText(body.name, 128);
  if (body.comment !== undefined)
    result.comment = optionalText(body.comment, 512);
  if (body.instance !== undefined)
    result.instance = optionalText(body.instance, 120);
  for (const [key, label] of [
    ["private", "Private network"],
    ["disabled", "Disabled"],
    ["enableBroadcast", "Broadcast"],
    ["ssoEnabled", "SSO"],
  ] as const) {
    const value = optionalBoolean(body[key], label);
    if (value !== undefined) result[key] = value;
  }
  const mtu = optionalNumber(body.mtu, "MTU", 576, 10_000);
  if (mtu !== undefined) result.mtu = mtu;
  const multicastLimit = optionalNumber(
    body.multicastLimit,
    "Multicast limit",
    0,
    65_535,
  );
  if (multicastLimit !== undefined) result.multicastLimit = multicastLimit;
  if (body.routes !== undefined)
    result.routes = array(body.routes, "Routes", 128).map((entry, index) => {
      const route = object(entry, `Route ${index + 1}`);
      const target = cidr(route.target, `Route ${index + 1} target`);
      const via =
        route.via === null || route.via === undefined || route.via === ""
          ? null
          : ipAddress(route.via, `Route ${index + 1} gateway`);
      return { target, via };
    });
  if (body.ipAssignmentPools !== undefined)
    result.ipAssignmentPools = array(
      body.ipAssignmentPools,
      "IP assignment pools",
      128,
    ).map((entry, index) => {
      const pool = object(entry, `IP pool ${index + 1}`);
      const ipRangeStart = ipAddress(
        pool.ipRangeStart,
        `IP pool ${index + 1} start`,
      );
      const ipRangeEnd = ipAddress(pool.ipRangeEnd, `IP pool ${index + 1} end`);
      if (isIP(ipRangeStart) !== isIP(ipRangeEnd))
        throw new ValidationError(
          `IP pool ${index + 1} must use one address family.`,
        );
      return { ipRangeStart, ipRangeEnd };
    });
  if (body.v4AssignMode !== undefined)
    result.v4AssignMode = booleanMap(body.v4AssignMode, "IPv4 assignment mode");
  if (body.v6AssignMode !== undefined)
    result.v6AssignMode = booleanMap(body.v6AssignMode, "IPv6 assignment mode");
  if (body.dns !== undefined) {
    if (Array.isArray(body.dns) && body.dns.length === 0) result.dns = [];
    else {
      const dns = object(body.dns, "DNS");
      result.dns = {
        domain: optionalText(dns.domain, 253) || undefined,
        servers:
          dns.servers === undefined
            ? undefined
            : textArray(dns.servers, "DNS servers", 16).map((server) =>
                ipAddress(server, "DNS server"),
              ),
      };
    }
  }
  if (body.rules !== undefined) result.rules = compiledRules(body.rules);
  if (body.capabilities !== undefined)
    result.capabilities = compiledCapabilities(body.capabilities);
  if (body.tags !== undefined) result.tags = compiledTags(body.tags);
  for (const key of ["authorizationEndpoint", "clientId"] as const)
    if (body[key] !== undefined) result[key] = optionalText(body[key], 2048);
  if (body.remoteTraceTarget !== undefined)
    result.remoteTraceTarget = traceTarget(body.remoteTraceTarget);
  const remoteTraceLevel = optionalNumber(
    body.remoteTraceLevel,
    "Remote trace level",
    0,
    3,
  );
  if (remoteTraceLevel !== undefined)
    result.remoteTraceLevel = remoteTraceLevel;
  return result;
}

export function memberPayload(body: Record<string, unknown>) {
  const result: Partial<NetworkMember> = {};
  if (body.name !== undefined) result.name = optionalText(body.name, 128);
  if (body.comment !== undefined)
    result.comment = optionalText(body.comment, 512);
  for (const [key, label] of [
    ["authorized", "Authorized"],
    ["disabled", "Disabled"],
    ["activeBridge", "Active bridge"],
    ["noAutoAssignIps", "Disable automatic IP assignment"],
    ["ssoExempt", "SSO exemption"],
  ] as const) {
    const value = optionalBoolean(body[key], label);
    if (value !== undefined) result[key] = value;
  }
  if (body.ipAssignments !== undefined)
    result.ipAssignments = textArray(body.ipAssignments, "IP assignments").map(
      (address) => ipAddress(address, "IP assignment"),
    );
  if (body.capabilities !== undefined)
    result.capabilities = integerArray(body.capabilities, "Capabilities");
  if (body.tags !== undefined) result.tags = tagArray(body.tags);
  const expiry = optionalNumber(
    body.authenticationExpiryTime,
    "Authentication expiry time",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  if (expiry !== undefined) result.authenticationExpiryTime = expiry;
  const traceLevel = optionalNumber(
    body.remoteTraceLevel,
    "Remote trace level",
    0,
    3,
  );
  if (traceLevel !== undefined) result.remoteTraceLevel = traceLevel;
  if (body.remoteTraceTarget !== undefined)
    result.remoteTraceTarget = traceTarget(body.remoteTraceTarget);
  return result;
}

export function clientNetworkPayload(body: Record<string, unknown>) {
  const result: Partial<ClientNetwork> = {};
  if (body.name !== undefined) result.name = optionalText(body.name, 128);
  if (body.instance !== undefined)
    result.instance = optionalText(body.instance, 120);
  if (body.comment !== undefined)
    result.comment = optionalText(body.comment, 512);
  if (body.vrf !== undefined) {
    const vrf = optionalText(body.vrf, 120);
    if (!vrf) throw new ValidationError("VRF is required.");
    result.vrf = vrf;
  }
  if (body.arpTimeout !== undefined) {
    const arpTimeout = optionalText(body.arpTimeout, 64).toLowerCase();
    if (
      !/^(?:auto|(?:\d+(?:ms|[smhdw]))+|\d{1,3}:\d{2}:\d{2}(?:\.\d{1,3})?)$/.test(
        arpTimeout,
      )
    )
      throw new ValidationError(
        "ARP timeout must be auto or a RouterOS time value such as 30s, 5m or 00:00:30.",
      );
    result.arpTimeout = arpTimeout;
  }
  const enabled = optionalBoolean(body.enabled, "Enabled");
  if (enabled !== undefined) result.disabled = !enabled;
  const disableRunningCheck = optionalBoolean(
    body.disableRunningCheck,
    "Disable running check",
  );
  if (disableRunningCheck !== undefined)
    result.disableRunningCheck = disableRunningCheck;
  for (const [key, label] of [
    ["allowManaged", "Managed routes"],
    ["allowDefault", "Default route"],
    ["allowGlobal", "Global addresses"],
    ["allowDNS", "Managed DNS"],
  ] as const) {
    const value = optionalBoolean(body[key], label);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

export function flowPolicyPayload(value: unknown) {
  const input = object(value, "Flow policy");
  const layer2Only = optionalBoolean(input.layer2Only, "Layer 2 filter");
  const restrict = optionalBoolean(input.restrict, "Traffic restriction");
  if (layer2Only === undefined || restrict === undefined)
    throw new ValidationError("Flow policy switches are required.");
  const allowedServices = new Set([
    "ping",
    "dns",
    "http",
    "https",
    "ssh",
    "rdp",
    "smb",
  ]);
  const services = textArray(input.services, "Flow policy services", 7);
  if (services.some((service) => !allowedServices.has(service)))
    throw new ValidationError("Flow policy contains an unsupported service.");
  const exemptMembers = textArray(
    input.exemptMembers,
    "Exempt members",
    512,
  ).map((id) => memberId(id));
  const custom = array(input.custom, "Custom services", 128).map(
    (entry, index) => {
      const service = object(entry, `Custom service ${index + 1}`);
      const protocol = optionalText(service.protocol, 8);
      if (!new Set(["tcp", "udp", "both"]).has(protocol))
        throw new ValidationError(
          `Custom service ${index + 1} has an invalid protocol.`,
        );
      const port = optionalText(service.port, 32);
      const match = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(port);
      const start = Number(match?.[1]);
      const end = Number(match?.[2] || match?.[1]);
      if (!match || start < 1 || end > 65_535 || start > end)
        throw new ValidationError(
          `Custom service ${index + 1} has an invalid port or range.`,
        );
      return {
        name: optionalText(service.name, 120),
        protocol: protocol as "tcp" | "udp" | "both",
        port,
      };
    },
  );
  return { layer2Only, restrict, services, exemptMembers, custom };
}
