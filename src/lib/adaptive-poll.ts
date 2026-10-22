export interface PollController {
  refresh(): void;
  stop(): void;
}

/** Schedule after completion, never on an interval: slow requests cannot overlap. */
export function startAdaptivePoll({
  load,
  onError,
  delay = 8000,
  maxDelay = 60000,
}: {
  load: () => Promise<boolean>;
  onError?: (error: unknown) => void;
  delay?: number;
  maxDelay?: number;
}): PollController {
  let stopped = false;
  let pending = false;
  let requested = false;
  let interval = delay;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const available = () => !document.hidden && navigator.onLine !== false;
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = () => {
    clear();
    if (!stopped && available()) timer = setTimeout(() => void run(), interval);
  };
  async function run() {
    clear();
    if (stopped || !available()) return;
    if (pending) {
      requested = true;
      return;
    }
    requested = false;
    pending = true;
    try {
      const changed = await load();
      interval = changed ? delay : Math.min(maxDelay, interval * 2);
    } catch (error) {
      interval = Math.min(maxDelay, interval * 2);
      if (!stopped) onError?.(error);
    } finally {
      pending = false;
      if (!stopped && requested && available()) {
        requested = false;
        void run();
      } else schedule();
    }
  }
  const refresh = () => {
    if (stopped) return;
    interval = delay;
    void run();
  };
  const stateChanged = () => {
    clear();
    if (available()) refresh();
  };
  document.addEventListener('visibilitychange', stateChanged);
  window.addEventListener('focus', stateChanged);
  window.addEventListener('online', stateChanged);
  window.addEventListener('offline', stateChanged);
  void run();
  return {
    refresh,
    stop() {
      stopped = true;
      requested = false;
      clear();
      document.removeEventListener('visibilitychange', stateChanged);
      window.removeEventListener('focus', stateChanged);
      window.removeEventListener('online', stateChanged);
      window.removeEventListener('offline', stateChanged);
    },
  };
}
