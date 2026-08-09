import { BlockList, isIP } from "node:net";
import { AppError } from "@/lib/errors";
import { ValidationError } from "@/lib/validation";

const MAX_RULES = 100;
const MAX_RULE_LENGTH = 80;

interface HeaderReader {
  get(name: string): string | null;
}

function addressType(version: number) {
  return version === 4 ? "ipv4" : "ipv6";
}

export function normalizeIpAccessRule(value: unknown) {
  if (typeof value !== "string")
    throw new ValidationError(
      "Every access-list entry must be an IP address or CIDR network.",
    );
  const input = value.trim().toLowerCase();
  if (!input) return "";
  if (input.length > MAX_RULE_LENGTH)
    throw new ValidationError("An access-list entry is too long.");

  const parts = input.split("/");
  if (parts.length > 2)
    throw new ValidationError(`Invalid IP access rule: ${input}`);
  const address = parts[0];
  const version = isIP(address);
  if (!version)
    throw new ValidationError(`Invalid IP address in access rule: ${input}`);

  if (parts.length === 1) return address;
  if (!/^\d{1,3}$/.test(parts[1]))
    throw new ValidationError(`Invalid CIDR prefix in access rule: ${input}`);
  const prefix = Number(parts[1]);
  const maximum = version === 4 ? 32 : 128;
  if (prefix < 0 || prefix > maximum)
    throw new ValidationError(
      `CIDR prefix must be between 0 and ${maximum}: ${input}`,
    );

  // Let Node's stable network parser perform the final subnet validation.
  const validator = new BlockList();
  validator.addSubnet(address, prefix, addressType(version));
  return `${address}/${prefix}`;
}

export function normalizeIpAccessRules(value: unknown) {
  if (!Array.isArray(value))
    throw new ValidationError(
      "The IP access list must be an array of addresses or CIDR networks.",
    );
  if (value.length > MAX_RULES)
    throw new ValidationError(
      `The IP access list supports up to ${MAX_RULES} entries.`,
    );
  const unique = new Set<string>();
  for (const entry of value) {
    const normalized = normalizeIpAccessRule(entry);
    if (normalized) unique.add(normalized);
  }
  return [...unique];
}

export function trustedClientIp(headers: HeaderReader) {
  if (process.env.TRUST_PROXY !== "1") return null;
  const forwarded = headers.get("x-forwarded-for");
  const candidate = forwarded
    ? forwarded.split(",")[0].trim()
    : headers.get("x-real-ip")?.trim() || "";
  return isIP(candidate) ? candidate.toLowerCase() : null;
}

export function ipMatchesAccessList(address: string, rules: string[]) {
  const version = isIP(address);
  if (!version) return false;
  const list = new BlockList();
  for (const entry of rules) {
    const normalized = normalizeIpAccessRule(entry);
    if (!normalized) continue;
    const [network, prefix] = normalized.split("/");
    const networkVersion = isIP(network);
    if (prefix === undefined)
      list.addAddress(network, addressType(networkVersion));
    else list.addSubnet(network, Number(prefix), addressType(networkVersion));
  }
  return list.check(address, addressType(version));
}

export function validateIpAccessConfiguration(input: {
  enabled: boolean;
  rules: unknown;
  clientIp: string | null;
  trustedProxy: boolean;
}) {
  const rules = normalizeIpAccessRules(input.rules);
  if (!input.enabled) return rules;
  if (!input.trustedProxy)
    throw new ValidationError(
      "Enable TRUST_PROXY behind a trusted reverse proxy before activating the IP access list.",
    );
  if (!rules.length)
    throw new ValidationError(
      "Add at least one IP address or CIDR network before activating the access list.",
    );
  if (!input.clientIp || !ipMatchesAccessList(input.clientIp, rules))
    throw new AppError(
      "Your current IP address must be included before the access list can be activated.",
      400,
      "IP_ALLOWLIST_LOCKOUT",
    );
  return rules;
}

export function ipAllowlistBypassed() {
  return process.env.IP_ALLOWLIST_BYPASS === "1";
}
