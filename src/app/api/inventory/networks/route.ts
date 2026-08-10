import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { controllerAdapterFor, nodeAdapterFor } from "@/lib/adapters";
import {
  listPublicControllers,
  updateControllerStatus,
} from "@/lib/controller-registry";
import { buildNetworkInventory } from "@/lib/inventory";
import { jsonError } from "@/lib/errors";
import type { NetworkInventorySnapshot } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cache: { expiresAt: number; snapshot: NetworkInventorySnapshot } | null =
  null;
let pending: Promise<NetworkInventorySnapshot> | null = null;

export async function GET(request: Request) {
  try {
    await requireUser("networks:read");
    const force = new URL(request.url).searchParams.get("refresh") === "1";
    if (!force && cache && cache.expiresAt > Date.now())
      return NextResponse.json(cache.snapshot, {
        headers: { "cache-control": "private, no-store" },
      });
    if (!pending) {
      pending = buildNetworkInventory(listPublicControllers(), {
        controllerAdapterFor,
        nodeAdapterFor,
        onControllerStatus: updateControllerStatus,
      }).finally(() => {
        pending = null;
      });
    }
    const snapshot = await pending;
    cache = { expiresAt: Date.now() + 20_000, snapshot };
    return NextResponse.json(snapshot, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
