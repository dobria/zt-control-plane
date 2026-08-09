export const networkTabs = [
  "members",
  "network",
  "addresses",
  "routes",
  "rules",
  "raw",
] as const;

export type NetworkTab = (typeof networkTabs)[number];

export function networkTab(value: unknown): NetworkTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  return networkTabs.includes(candidate as NetworkTab)
    ? (candidate as NetworkTab)
    : "members";
}
