import {
  getController,
  credentialsFor,
  type CentralCredentials,
  type MikroTikCredentials,
  type ZeroTierCredentials,
} from "@/lib/controller-registry";
import { AppError } from "@/lib/errors";
import { MikroTikAdapter } from "@/lib/adapters/mikrotik";
import { ZeroTierAdapter } from "@/lib/adapters/zerotier";
import { CentralAdapter } from "@/lib/adapters/central";
import { getNode, nodeCredentialsFor } from "@/lib/node-registry";
import type {
  ManagedNodeAdapter,
  NetworkControllerAdapter,
} from "@/lib/adapters/types";

export function controllerAdapterFor(
  controllerId: string,
): NetworkControllerAdapter {
  const controller = getController(controllerId);
  if (!controller)
    throw new AppError("Controller not found.", 404, "CONTROLLER_NOT_FOUND");
  if (!controller.enabled)
    throw new AppError(
      "Controller connection is paused.",
      409,
      "CONTROLLER_DISABLED",
    );
  const credentials = credentialsFor(controller);
  if (controller.type === "central_v1" || controller.type === "central_v2")
    return new CentralAdapter(controller, credentials as CentralCredentials);
  if (controller.type === "mikrotik")
    return new MikroTikAdapter(controller, credentials as MikroTikCredentials);
  return new ZeroTierAdapter(controller, credentials as ZeroTierCredentials);
}

export function nodeAdapterFor(nodeId: string): ManagedNodeAdapter {
  const node = getNode(nodeId);
  if (!node)
    throw new AppError("Managed node not found.", 404, "NODE_NOT_FOUND");
  if (!node.enabled)
    throw new AppError("Managed node is disabled.", 409, "NODE_DISABLED");
  const credentials = nodeCredentialsFor(node);
  if (node.type === "mikrotik")
    return new MikroTikAdapter(
      node,
      credentials as MikroTikCredentials,
      undefined,
      "node",
    );
  return new ZeroTierAdapter(
    node,
    credentials as ZeroTierCredentials,
    undefined,
    "node",
  );
}

export function adapterFor(controllerId: string): NetworkControllerAdapter {
  return controllerAdapterFor(controllerId);
}

export type {
  ManagedNodeAdapter,
  NetworkControllerAdapter,
} from "@/lib/adapters/types";
