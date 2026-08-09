import { lookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";

const forbiddenIpv6 = new BlockList();
forbiddenIpv6.addAddress("::", "ipv6");
forbiddenIpv6.addSubnet("fe80::", 10, "ipv6");
forbiddenIpv6.addSubnet("ff00::", 8, "ipv6");
forbiddenIpv6.addAddress("fd00:ec2::254", "ipv6");

function normalizedIpv4(address: string) {
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped?.[1] || address;
}

export function endpointAddressIsForbidden(address: string) {
  const normalized = normalizedIpv4(address);
  if (isIP(normalized) === 4) {
    const octets = normalized.split(".").map(Number);
    return (
      octets[0] === 0 ||
      (octets[0] === 169 && octets[1] === 254) ||
      octets[0] >= 224
    );
  }
  return isIP(normalized) === 6 && forbiddenIpv6.check(normalized, "ipv6");
}

export const restrictedEndpointLookup: LookupFunction = (
  hostname,
  options,
  callback,
) => {
  void lookup(hostname, { ...options, all: true })
    .then((addresses) => {
      if (
        !addresses.length ||
        addresses.some(({ address }) => endpointAddressIsForbidden(address))
      ) {
        const error = Object.assign(
          new Error("The endpoint resolved to a forbidden network address."),
          { code: "EACCES" },
        );
        callback(error, "", 0);
        return;
      }
      if (options.all) {
        callback(null, addresses);
        return;
      }
      callback(null, addresses[0].address, addresses[0].family);
    })
    .catch((error: NodeJS.ErrnoException) => callback(error, "", 0));
};
