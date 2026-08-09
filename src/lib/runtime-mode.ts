export function embeddedZeroTierEnabled() {
  return process.env.EMBEDDED_ZEROTIER === "1";
}
