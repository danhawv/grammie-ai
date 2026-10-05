import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, getQueryFn, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import type { UserPreferences } from "@shared/food-profile";

// The signed-in user's saved preferences (Food profile, Display, …), and an
// autosaver for the Me page. Readers should interpret the object with
// getFoodProfile() / getDisplayPrefs() from @shared/food-profile.

export const PREFERENCES_QUERY_KEY = ["/api/user/preferences"] as const;
const PREFERENCES_URL = "/api/user/preferences";

export function usePreferences() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const query = useQuery<UserPreferences | null>({
    queryKey: PREFERENCES_QUERY_KEY,
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

  return {
    preferences: query.data ?? null,
    isSignedIn: isAuthenticated,
    isLoading: authLoading || (isAuthenticated && query.isLoading),
    isError: query.isError,
    refetch: query.refetch,
  };
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";

function mergePatch(a: Partial<UserPreferences>, b: Partial<UserPreferences>): Partial<UserPreferences> {
  const out = { ...a, ...b };
  if (a.display || b.display) out.display = { ...a.display, ...b.display };
  return out;
}

/**
 * Debounced autosave: queue() any subset of preference keys; they are merged
 * and sent as one partial PUT after `delay` ms of quiet. Saves run one at a
 * time, failures keep the changes queued for Retry, and anything still queued
 * is sent when the page unmounts or the tab closes.
 */
export function useAutosavePreferences(delay = 700) {
  const pending = useRef<Partial<UserPreferences>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");

  const hasPending = () => Object.keys(pending.current).length > 0;

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (running.current) {
      await running.current;
      if (!hasPending()) return;
    }
    if (!hasPending()) return;

    const patch = pending.current;
    pending.current = {};
    setStatus("saving");
    running.current = (async () => {
      try {
        const res = await apiRequest("PUT", PREFERENCES_URL, patch);
        const saved = (await res.json()) as UserPreferences;
        // Server copy plus anything typed while this save was in flight
        queryClient.setQueryData(PREFERENCES_QUERY_KEY, saved);
        setStatus(hasPending() ? "saving" : "saved");
      } catch {
        pending.current = mergePatch(patch, pending.current);
        setStatus("error");
      } finally {
        running.current = null;
      }
    })();
    await running.current;
    if (hasPending() && !timer.current) {
      timer.current = setTimeout(() => { void flush(); }, delay);
    }
  }, [delay]);

  const queue = useCallback((patch: Partial<UserPreferences>) => {
    pending.current = mergePatch(pending.current, patch);
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, delay);
  }, [delay, flush]);

  // Don't lose the last edit when leaving the page or closing the tab
  useEffect(() => {
    const sendNow = () => {
      if (!hasPending()) return;
      const body = JSON.stringify(pending.current);
      pending.current = {};
      try {
        void fetch(PREFERENCES_URL, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body,
          credentials: "include",
          keepalive: true,
        }).then(() => queryClient.invalidateQueries({ queryKey: PREFERENCES_QUERY_KEY }));
      } catch { /* best effort */ }
    };
    window.addEventListener("pagehide", sendNow);
    return () => {
      window.removeEventListener("pagehide", sendNow);
      if (timer.current) clearTimeout(timer.current);
      sendNow();
    };
  }, []);

  return { queue, flush, status };
}
