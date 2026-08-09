"use client";

import { useEffect, useRef } from "react";
import { startAutoRefreshScheduler } from "@/lib/auto-refresh";

interface AutoRefreshOptions {
  enabled?: boolean;
  intervalMs?: number;
  runImmediately?: boolean;
  refreshKey?: unknown;
}

export function useAutoRefresh(
  refresh: (signal: AbortSignal) => Promise<void> | void,
  {
    enabled = true,
    intervalMs = 30_000,
    runImmediately = true,
    refreshKey,
  }: AutoRefreshOptions = {},
) {
  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    return startAutoRefreshScheduler({
      refresh: (signal) => refreshRef.current(signal),
      intervalMs,
      runImmediately,
      runtime: {
        isHidden: () => document.visibilityState === "hidden",
        schedule: (callback, delay) => window.setInterval(callback, delay),
        cancel: (handle) => window.clearInterval(handle as number),
        subscribe: (event, callback) => {
          const target = event === "visibilitychange" ? document : window;
          target.addEventListener(event, callback);
          return () => target.removeEventListener(event, callback);
        },
      },
    });
  }, [enabled, intervalMs, refreshKey, runImmediately]);
}
