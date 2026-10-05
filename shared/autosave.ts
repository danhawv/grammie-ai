// Debounced autosave (docs/DESIGN_PRINCIPLES.md rule 5, "Nothing is lost").
// Each change schedules a save of the latest value; saves never overlap, a
// change made during a save is saved right after it, and a failed save stays
// pending so the next change or a retry() sends it again.

export type AutosaveState = "idle" | "pending" | "saving" | "saved" | "error";

export interface Autosaver<T> {
  /** Record a change; it's saved after delayMs of quiet */
  schedule(value: T): void;
  /** Save any pending change now and wait for it */
  flush(): Promise<void>;
  /** Try a failed save again */
  retry(): Promise<void>;
  /** Drop pending work (on unmount after flush) */
  dispose(): void;
  readonly hasUnsaved: boolean;
}

export function createAutosaver<T>(opts: {
  delayMs: number;
  save: (value: T) => Promise<void>;
  onState?: (state: AutosaveState) => void;
}): Autosaver<T> {
  let latest: T | undefined;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let failed = false;
  let disposed = false;

  const set = (s: AutosaveState) => { if (!disposed) opts.onState?.(s); };
  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };

  const run = async (): Promise<void> => {
    clearTimer();
    if (inFlight) { await inFlight; if (dirty && !failed) return run(); return; }
    if (!dirty || latest === undefined) return;
    const value = latest;
    dirty = false;
    failed = false;
    set("saving");
    inFlight = (async () => {
      try {
        await opts.save(value);
        set(dirty ? "pending" : "saved");
      } catch {
        dirty = true;
        failed = true;
        set("error");
      }
    })();
    try { await inFlight; } finally { inFlight = null; }
    // Changes that arrived during the save go out next (after the usual pause)
    if (dirty && !failed && !disposed && !timer) timer = setTimeout(() => { void run(); }, opts.delayMs);
  };

  return {
    schedule(value: T) {
      if (disposed) return;
      latest = value;
      dirty = true;
      failed = false;
      if (!inFlight) set("pending");
      clearTimer();
      timer = setTimeout(() => { void run(); }, opts.delayMs);
    },
    flush: () => run(),
    retry() { failed = false; return run(); },
    dispose() { disposed = true; clearTimer(); },
    get hasUnsaved() { return dirty || !!inFlight; },
  };
}
