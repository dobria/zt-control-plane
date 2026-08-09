import type { PublicManagedNode } from "@/lib/types";

export function resolveActiveNode(
  nodes: PublicManagedNode[],
  controllerId: string | null | undefined,
  preferredNodeId: string | null | undefined,
) {
  if (!controllerId) return null;
  const controllerNodes = nodes.filter(
    (node) => node.controllerId === controllerId && node.enabled,
  );
  return (
    controllerNodes.find((node) => node.id === preferredNodeId) ||
    controllerNodes[0] ||
    null
  );
}
