export type AutoRefreshEvent = "focus" | "online" | "visibilitychange";

export interface AutoRefreshRuntime {
  isHidden(): boolean;
  schedule(callback: () => void, intervalMs: number): unknown;
  cancel(handle: unknown): void;
  subscribe(event: AutoRefreshEvent, callback: () => void): () => void;
}

export interface AutoRefreshSchedulerOptions {
  refresh(signal: AbortSignal): Promise<void> | void;
  intervalMs: number;
  runImmediately?: boolean;
  runtime: AutoRefreshRuntime;
}

export function startAutoRefreshScheduler({
  refresh,
  intervalMs,
  runImmediately = true,
  runtime,
}: AutoRefreshSchedulerOptions) {
  const controller = new AbortController();
  let running = false;

  async function run() {
    if (running || controller.signal.aborted || runtime.isHidden()) return;
    running = true;
    try {
      await refresh(controller.signal);
    } finally {
      running = false;
    }
  }

  function trigger() {
    // Pages surface their own refresh errors. This catch prevents an unexpected
    // callback failure from becoming an unhandled browser promise rejection.
    void run().catch(() => undefined);
  }

  const unsubscribers = (
    ["focus", "online", "visibilitychange"] as AutoRefreshEvent[]
  ).map((event) => runtime.subscribe(event, trigger));
  const timer = runtime.schedule(trigger, Math.max(1_000, intervalMs));
  if (runImmediately) trigger();

  return () => {
    controller.abort();
    runtime.cancel(timer);
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}
