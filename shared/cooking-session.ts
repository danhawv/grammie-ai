// Pure helpers for cooking mode's saved state (last step and running timers).
// The client stores these in localStorage per recipe; parsing is defensive
// because stored data can be stale, partial or from an older version.

export interface CookingTimer {
  id: string;
  label: string;
  /** Index of the step that started it, for "Step 3" labels and jumping back */
  stepIndex: number;
  /** epoch ms */
  endsAt: number;
  totalSeconds: number;
  done: boolean;
}

export interface SavedStep {
  stepIndex: number;
  /** epoch ms */
  savedAt: number;
}

/** Saved progress is offered for a week; after that it starts fresh */
export const SAVED_STEP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Finished timers are dropped an hour after they ring */
export const DONE_TIMER_MAX_AGE_MS = 60 * 60 * 1000;

export function stepStorageKey(recipeId: string): string {
  return `grammie-cook-step:${recipeId}`;
}

export function timersStorageKey(recipeId: string): string {
  return `grammie-cook-timers:${recipeId}`;
}

/** Returns the step to offer "Resume at step N" for, or null */
export function parseSavedStep(raw: string | null, totalSteps: number, now: number): number | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<SavedStep>;
    const idx = data.stepIndex;
    if (typeof idx !== 'number' || !Number.isInteger(idx)) return null;
    if (idx <= 0 || idx >= totalSteps) return null;
    if (typeof data.savedAt !== 'number' || now - data.savedAt > SAVED_STEP_MAX_AGE_MS) return null;
    return idx;
  } catch {
    return null;
  }
}

/** Restores timers that are still running or rang recently */
export function parseSavedTimers(raw: string | null, now: number): CookingTimer[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter((t): t is CookingTimer =>
        t && typeof t.id === 'string' && typeof t.label === 'string' &&
        typeof t.endsAt === 'number' && typeof t.totalSeconds === 'number' &&
        typeof t.stepIndex === 'number')
      .map((t) => ({ ...t, done: now >= t.endsAt }))
      .filter((t) => !t.done || now - t.endsAt < DONE_TIMER_MAX_AGE_MS);
  } catch {
    return [];
  }
}

/** 272 → "4:32", 3725 → "1:02:05" */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

/** Simple hands-free commands: "next", "back", "repeat", "start timer" */
export type VoiceCommand = 'next' | 'back' | 'repeat' | 'timer';

export function parseVoiceCommand(transcript: string): VoiceCommand | null {
  const t = transcript.toLowerCase().trim();
  if (!t) return null;
  if (/\b(start|set)( the| a)? timer\b/.test(t)) return 'timer';
  if (/\b(repeat|again|read (it|that|step))\b/.test(t)) return 'repeat';
  if (/\b(back|previous|go back)\b/.test(t)) return 'back';
  if (/\b(next|continue|forward)\b/.test(t)) return 'next';
  return null;
}
