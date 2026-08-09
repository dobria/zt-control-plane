import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { adapterFor } from "@/lib/adapters";
import {
  listPublicControllers,
  updateControllerStatus,
} from "@/lib/controller-registry";
import { listPublicNodes } from "@/lib/node-registry";
import { buildOverviewSnapshot } from "@/lib/overview";
import { jsonError } from "@/lib/errors";
import type { OverviewSnapshot } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cacheDurationMs = 20_000;
let cache: {
  registryKey: string;
  expiresAt: number;
  snapshot: OverviewSnapshot;
} | null = null;
let pending: {
  registryKey: string;
  promise: Promise<OverviewSnapshot>;
} | null = null;

function currentRegistryKey() {
  return [
    ...listPublicControllers().map(
      (controller) =>
        `${controller.id}:${controller.updatedAt}:${controller.enabled}`,
    ),
    ...listPublicNodes().map(
      (node) => `${node.id}:${node.updatedAt}:${node.enabled}`,
    ),
  ].join("|");
}

export async function GET() {
  try {
    await requireUser("controllers:read");
    const controllers = listPublicControllers();
    const nodes = listPublicNodes();
    const registryKey = currentRegistryKey();
    const now = Date.now();
    if (cache && cache.registryKey === registryKey && cache.expiresAt > now)
      return NextResponse.json(cache.snapshot, {
        headers: { "cache-control": "private, no-store" },
      });
    if (!pending || pending.registryKey !== registryKey) {
      const promise = buildOverviewSnapshot(
        controllers,
        nodes,
        { adapterFor, onStatus: updateControllerStatus },
        cache?.snapshot,
      );
      pending = { registryKey, promise };
      const clearPending = () => {
        if (pending?.promise === promise) pending = null;
      };
      void promise.then(clearPending, clearPending);
    }
    const snapshot = await pending.promise;
    cache = {
      // Status checks update controller timestamps; cache their final state.
      registryKey: currentRegistryKey(),
      expiresAt: Date.now() + cacheDurationMs,
      snapshot,
    };
    return NextResponse.json(snapshot, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
