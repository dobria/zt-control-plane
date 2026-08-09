import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  startAutoRefreshScheduler,
  type AutoRefreshEvent,
  type AutoRefreshRuntime,
} from "@/lib/auto-refresh";

function fakeRuntime() {
  let hidden = false;
  let scheduled: (() => void) | null = null;
  let interval = 0;
  let cancelled = false;
  const listeners = new Map<AutoRefreshEvent, Set<() => void>>();
  const runtime: AutoRefreshRuntime = {
    isHidden: () => hidden,
    schedule(callback, intervalMs) {
      scheduled = callback;
      interval = intervalMs;
      return "timer";
    },
    cancel(handle) {
      assert.equal(handle, "timer");
      cancelled = true;
    },
    subscribe(event, callback) {
      const entries = listeners.get(event) || new Set();
      entries.add(callback);
      listeners.set(event, entries);
      return () => entries.delete(callback);
    },
  };
  return {
    runtime,
    interval: () => interval,
    cancelled: () => cancelled,
    setHidden(value: boolean) {
      hidden = value;
    },
    tick() {
      scheduled?.();
    },
    emit(event: AutoRefreshEvent) {
      for (const listener of listeners.get(event) || []) listener();
    },
    listenerCount() {
      return [...listeners.values()].reduce(
        (total, entries) => total + entries.size,
        0,
      );
    },
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("automatic refresh scheduler", () => {
  it("uses the configured interval and refreshes immediately", async () => {
    const fake = fakeRuntime();
    let calls = 0;
    const stop = startAutoRefreshScheduler({
      refresh: () => {
        calls += 1;
      },
      intervalMs: 15_000,
      runtime: fake.runtime,
    });
    await settle();
    assert.equal(fake.interval(), 15_000);
    assert.equal(calls, 1);

    fake.tick();
    await settle();
    assert.equal(calls, 2);
    stop();
    assert.equal(fake.cancelled(), true);
    assert.equal(fake.listenerCount(), 0);
  });

  it("pauses while hidden and refreshes when visibility returns", async () => {
    const fake = fakeRuntime();
    fake.setHidden(true);
    let calls = 0;
    const stop = startAutoRefreshScheduler({
      refresh: () => {
        calls += 1;
      },
      intervalMs: 30_000,
      runtime: fake.runtime,
    });
    await settle();
    fake.tick();
    fake.emit("focus");
    await settle();
    assert.equal(calls, 0);

    fake.setHidden(false);
    fake.emit("visibilitychange");
    await settle();
    assert.equal(calls, 1);
    fake.emit("online");
    await settle();
    assert.equal(calls, 2);
    stop();
  });

  it("prevents overlapping refresh requests and aborts on cleanup", async () => {
    const fake = fakeRuntime();
    let calls = 0;
    const state: {
      receivedSignal?: AbortSignal;
      release?: () => void;
    } = {};
    const stop = startAutoRefreshScheduler({
      refresh: async (signal) => {
        calls += 1;
        state.receivedSignal = signal;
        await new Promise<void>((resolve) => {
          state.release = resolve;
        });
      },
      intervalMs: 60_000,
      runtime: fake.runtime,
    });
    await settle();
    fake.tick();
    fake.emit("focus");
    assert.equal(calls, 1);

    state.release?.();
    await settle();
    fake.tick();
    await settle();
    assert.equal(calls, 2);
    stop();
    assert.equal(state.receivedSignal?.aborted, true);
    state.release?.();
  });

  it("can defer the first refresh when a page already loaded its data", async () => {
    const fake = fakeRuntime();
    let calls = 0;
    const stop = startAutoRefreshScheduler({
      refresh: () => {
        calls += 1;
      },
      intervalMs: 120_000,
      runImmediately: false,
      runtime: fake.runtime,
    });
    await settle();
    assert.equal(calls, 0);
    fake.tick();
    await settle();
    assert.equal(calls, 1);
    stop();
  });
});
