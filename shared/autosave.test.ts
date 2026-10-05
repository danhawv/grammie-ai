import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaver, type AutosaveState } from "./autosave";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(saveImpl?: (v: number) => Promise<void>) {
  const saved: number[] = [];
  const states: AutosaveState[] = [];
  const save = vi.fn(saveImpl ?? (async (v: number) => { saved.push(v); }));
  const a = createAutosaver<number>({ delayMs: 1000, save, onState: (s) => states.push(s) });
  return { a, save, saved, states };
}

describe("createAutosaver", () => {
  it("debounces bursts into one save of the latest value", async () => {
    const { a, save, saved, states } = setup();
    a.schedule(1); a.schedule(2); a.schedule(3);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved).toEqual([3]);
    expect(states.at(-1)).toBe("saved");
    expect(a.hasUnsaved).toBe(false);
  });

  it("never saves before a change", async () => {
    const { save } = setup();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
  });

  it("saves a change made during a save right after it, without overlap", async () => {
    let release!: () => void;
    let active = 0, maxActive = 0;
    const saved: number[] = [];
    const { a } = setup(async (v) => {
      active++; maxActive = Math.max(maxActive, active);
      if (v === 1) await new Promise<void>((r) => { release = r; });
      saved.push(v); active--;
    });
    a.schedule(1);
    await vi.advanceTimersByTimeAsync(1000);
    a.schedule(2);
    await vi.advanceTimersByTimeAsync(1000);
    release();
    await vi.advanceTimersByTimeAsync(2000);
    expect(saved).toEqual([1, 2]);
    expect(maxActive).toBe(1);
  });

  it("keeps a failed save pending and retries", async () => {
    let fail = true;
    const saved: number[] = [];
    const { a, states } = setup(async (v) => { if (fail) throw new Error("x"); saved.push(v); });
    a.schedule(5);
    await vi.advanceTimersByTimeAsync(1000);
    expect(states.at(-1)).toBe("error");
    expect(a.hasUnsaved).toBe(true);
    fail = false;
    await a.retry();
    expect(saved).toEqual([5]);
    expect(states.at(-1)).toBe("saved");
  });

  it("flush saves immediately", async () => {
    const { a, saved } = setup();
    a.schedule(9);
    await a.flush();
    expect(saved).toEqual([9]);
  });
});
