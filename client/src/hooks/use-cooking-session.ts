import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CookingTimer,
  parseSavedStep,
  parseSavedTimers,
  parseVoiceCommand,
  stepStorageKey,
  timersStorageKey,
  type VoiceCommand,
} from "@shared/cooking-session";

// State for cooking mode that outlives a single visit: the last step a cook
// reached, timers that keep running between steps (and while cooking mode is
// closed), keeping the screen awake, and optional hands-free commands.

function readStorage(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage unavailable; progress just isn't remembered */ }
}

// ---------- Last step ----------

export function readSavedStep(recipeId: string | undefined, totalSteps: number): number | null {
  if (!recipeId) return null;
  return parseSavedStep(readStorage(stepStorageKey(recipeId)), totalSteps, Date.now());
}

export function saveStep(recipeId: string | undefined, stepIndex: number) {
  if (!recipeId) return;
  writeStorage(stepStorageKey(recipeId), stepIndex > 0 ? JSON.stringify({ stepIndex, savedAt: Date.now() }) : null);
}

export function clearSavedStep(recipeId: string | undefined) {
  if (recipeId) writeStorage(stepStorageKey(recipeId), null);
}

// ---------- Timers ----------

export function playTimerChime() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.25, 0.5].forEach((delay, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = i === 2 ? 1046 : 880;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.22);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.25);
    });
  } catch {
    // audio unavailable; the visual alert still shows
  }
}

export interface CookingTimers {
  timers: CookingTimer[];
  now: number;
  start: (opts: { label: string; seconds: number; stepIndex: number }) => void;
  dismiss: (id: string) => void;
}

/** Timers persist per recipe in localStorage and keep ticking until dismissed */
export function useCookingTimers(recipeId: string | undefined): CookingTimers {
  const load = (id: string | undefined) => ({
    key: id,
    timers: id ? parseSavedTimers(readStorage(timersStorageKey(id)), Date.now()) : [],
  });
  // Timers are stored with the recipe they belong to, so switching recipes
  // never writes one recipe's timers under another's key.
  const [state, setState] = useState(() => load(recipeId));
  const [now, setNow] = useState(() => Date.now());
  const timers = state.key === recipeId ? state.timers : [];

  useEffect(() => {
    if (state.key !== recipeId) setState(load(recipeId));
  }, [recipeId, state.key]);

  useEffect(() => {
    if (!state.key) return;
    writeStorage(timersStorageKey(state.key), state.timers.length ? JSON.stringify(state.timers) : null);
  }, [state]);

  const setTimers = useCallback((fn: (prev: CookingTimer[]) => CookingTimer[]) => {
    setState((s) => {
      const next = fn(s.timers);
      return next === s.timers ? s : { ...s, timers: next };
    });
  }, []);

  // Tick while anything is running; chime when a timer crosses zero
  const anyRunning = timers.some((t) => !t.done);
  const timersRef = useRef(timers);
  timersRef.current = timers;
  useEffect(() => {
    if (!anyRunning) return;
    const iv = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (!timersRef.current.some((timer) => !timer.done && t >= timer.endsAt)) return;
      playTimerChime();
      setTimers((prev) => prev.map((timer) => (!timer.done && t >= timer.endsAt ? { ...timer, done: true } : timer)));
    }, 500);
    return () => clearInterval(iv);
  }, [anyRunning, setTimers]);

  const start = useCallback(({ label, seconds, stepIndex }: { label: string; seconds: number; stepIndex: number }) => {
    const t = Date.now();
    setNow(t);
    setTimers((prev) => [
      ...prev,
      { id: `${t}-${Math.random().toString(36).slice(2, 7)}`, label, stepIndex, endsAt: t + seconds * 1000, totalSeconds: seconds, done: false },
    ]);
  }, [setTimers]);

  const dismiss = useCallback((id: string) => setTimers((prev) => prev.filter((t) => t.id !== id)), [setTimers]);

  return { timers, now, start, dismiss };
}

// ---------- Screen stays on ----------

export type WakeLockStatus = "on" | "off" | "unsupported" | "blocked";

const KEEP_AWAKE_KEY = "grammie-keep-screen-on";

/** Remembered per browser: whether cooking mode keeps the screen on (default yes) */
export function useKeepAwakePreference(): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => readStorage(KEEP_AWAKE_KEY) !== "false");
  const update = useCallback((v: boolean) => {
    setValue(v);
    writeStorage(KEEP_AWAKE_KEY, v ? null : "false");
  }, []);
  return [value, update];
}

/** Keeps the screen awake while active; re-requests when the tab comes back into view */
export function useWakeLock(active: boolean): WakeLockStatus {
  const supported = typeof navigator !== "undefined" && "wakeLock" in navigator;
  const [status, setStatus] = useState<WakeLockStatus>(supported ? "off" : "unsupported");

  useEffect(() => {
    if (!supported) { setStatus("unsupported"); return; }
    if (!active) { setStatus("off"); return; }
    let lock: any = null;
    let cancelled = false;

    const acquire = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const next = await (navigator as any).wakeLock.request("screen");
        if (cancelled) { next.release().catch(() => {}); return; }
        lock = next;
        setStatus("on");
        next.addEventListener("release", () => {
          if (!cancelled) setStatus("off");
        });
      } catch {
        // Battery saver or a permissions policy can refuse it
        if (!cancelled) setStatus("blocked");
      }
    };

    acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release?.().catch(() => {});
    };
  }, [active, supported]);

  return status;
}

// ---------- Hands-free commands ----------

function getRecognitionCtor(): any {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function voiceCommandsSupported(): boolean {
  return !!getRecognitionCtor();
}

/**
 * Listens for "next", "back", "repeat" and "start timer" while enabled.
 * Restarts after the browser's natural pauses; stops for good on errors such
 * as a denied microphone and reports it.
 */
export function useVoiceCommands(enabled: boolean, onCommand: (cmd: VoiceCommand) => void): { listening: boolean; error: string | null } {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handler = useRef(onCommand);
  handler.current = onCommand;

  useEffect(() => {
    const Ctor = getRecognitionCtor();
    if (!enabled || !Ctor) { setListening(false); return; }
    setError(null);
    let stopped = false;
    let rec: any;
    try {
      rec = new Ctor();
    } catch {
      setError("Voice commands aren't available in this browser.");
      return;
    }
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const cmd = parseVoiceCommand(e.results[i][0]?.transcript ?? "");
        if (cmd) handler.current(cmd);
      }
    };
    rec.onstart = () => setListening(true);
    rec.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        stopped = true;
        setError("Grammie can't use the microphone. Allow it in your browser settings to use voice commands.");
      }
    };
    rec.onend = () => {
      setListening(false);
      if (!stopped) {
        try { rec.start(); } catch { /* already starting */ }
      }
    };
    try { rec.start(); } catch { /* ignore */ }
    return () => {
      stopped = true;
      try { rec.abort(); } catch { /* ignore */ }
      setListening(false);
    };
  }, [enabled]);

  return { listening, error };
}

/** Reads text aloud for "repeat"; no-op when speech isn't available */
export function speak(text: string) {
  try {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  } catch { /* ignore */ }
}
