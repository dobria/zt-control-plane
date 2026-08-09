import type { ControllerType } from "@/lib/types";

export function controllerSwitchDestination(
  pathname: string,
  controllerId: string,
  controllerType: ControllerType,
) {
  if (pathname.startsWith("/networks/"))
    return `/networks?controller=${encodeURIComponent(controllerId)}`;
  if (/^\/controllers\/[^/]+\/nodes/.test(pathname))
    return controllerType === "central_v1" || controllerType === "central_v2"
      ? `/networks?controller=${encodeURIComponent(controllerId)}`
      : `/controllers/${controllerId}/nodes`;
  return null;
}
