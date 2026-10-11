// Private pictures (family photos, original cards, bulk import photos) are
// served from /api routes that need sign-in. In a browser the cookie goes
// along with every <img>, so their URLs stay as they are. In the iPhone/iPad
// app an <img> can't carry sign-in, so the URL gets a short-lived signed pass
// from the server (server/lib/image-pass.ts).

import { useSyncExternalStore } from "react";
import { apiFetch, apiUrl, isNativeApp } from "./platform";

type Pass = { pass: string; expiresAt: number };

let current: Pass | null = null;
let loading: Promise<void> | null = null;
let retryAfter = 0;
const listeners = new Set<() => void>();

// Ask again an hour before it runs out
const REFRESH_MS = 60 * 60 * 1000;

function fresh(p: Pass | null): p is Pass {
  return !!p && p.expiresAt - Date.now() > REFRESH_MS;
}

function load(): void {
  if (loading || Date.now() < retryAfter) return;
  loading = (async () => {
    try {
      const res = await apiFetch("/api/image-pass");
      if (!res.ok) throw new Error(String(res.status));
      current = (await res.json()) as Pass;
      listeners.forEach((l) => l());
    } catch {
      retryAfter = Date.now() + 30_000; // signed out or offline: try again later
    } finally {
      loading = null;
    }
  })();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): string | null {
  if (!isNativeApp()) return null;
  if (!fresh(current)) load();
  return current && current.expiresAt > Date.now() ? current.pass : null;
}

/** The current pass in the app (null in a browser); re-renders when it changes */
export function useImagePass(): string | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/** URL for a private picture at an /api path, given useImagePass()'s value */
export function privateImageUrl(path: string, pass: string | null): string {
  if (!pass) return apiUrl(path);
  return `${apiUrl(path)}${path.includes("?") ? "&" : "?"}pass=${encodeURIComponent(pass)}`;
}

/** Forget the pass (after signing out) */
export function clearImagePass(): void {
  current = null;
  retryAfter = 0;
  listeners.forEach((l) => l());
}
