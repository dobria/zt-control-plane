export type InstanceWorkspaceView =
  "overview" | "controlled" | "joined" | "peers" | "settings";

const views = new Set<InstanceWorkspaceView>([
  "overview",
  "controlled",
  "joined",
  "peers",
  "settings",
]);

export function normalizeInstanceWorkspaceView(
  value: string | null | undefined,
): InstanceWorkspaceView {
  return views.has(value as InstanceWorkspaceView)
    ? (value as InstanceWorkspaceView)
    : "overview";
}

export function instanceWorkspaceQuery(
  current: { toString(): string },
  instance: string,
  view: InstanceWorkspaceView,
) {
  const query = new URLSearchParams(current.toString());
  if (instance) query.set("instance", instance);
  else query.delete("instance");
  query.set("view", view);
  return query.toString();
}
