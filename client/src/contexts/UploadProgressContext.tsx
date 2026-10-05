import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ImportStatus } from "@shared/import-review";
import {
  addToCookbook,
  apiErrorMessage,
  createUploadSession,
  dismissImportReview,
  retryImport,
  uploadBatchPhoto,
} from "@/lib/import-api";

// Tracks recipe imports in the background (docs/DESIGN_PRINCIPLES.md §6.9):
// each item moves Sending… → Reading… → Needs a look → Saved, or fails with a
// reason and Retry. Rendered by JobStatus on the processing page; the alerts
// button shows the count. "Needs a look" also comes from the server, so it
// survives reloads and other devices.

export type ImportKind = "photo" | "link" | "social" | "text" | "creator" | "shared";

export interface ImportItem {
  /** Local key; equals recipeId once the server has one */
  key: string;
  recipeId?: string;
  title: string;
  kind: ImportKind;
  status: ImportStatus;
  error?: string;
  thumbnail?: string | null;
  startedAt: number;
}

interface UploadProgressContextValue {
  imports: ImportItem[];
  counts: { active: number; needsReview: number; failed: number };
  /** Track an import the server already accepted */
  addRecipe: (recipeId: string, title?: string, opts?: { kind?: ImportKind; thumbnail?: string | null }) => void;
  /** Batch: each photo becomes its own recipe; uploads continue in the background */
  startPhotoBatch: (photos: Array<{ blob: Blob; thumbnail?: string | null }>, opts?: { cookbookId?: string }) => void;
  retry: (key: string) => Promise<void>;
  markReviewed: (recipeId: string) => void;
  /** Remove from the list; for "Needs a look" items this also means "not now" */
  dismiss: (key: string) => void;
  clearFinished: () => void;
}

const STORAGE_KEY = "recipe-import-progress-v2";
const PLACEHOLDER_TITLES = new Set(["Your Recipe", "Failed to Extract Recipe", ""]);

const UploadProgressContext = createContext<UploadProgressContextValue | null>(null);

function loadStored(): ImportItem[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as ImportItem[]) : [];
    // Uploads that never reached the server can't resume after a reload
    return parsed.map((i) =>
      i.status === "uploading"
        ? { ...i, status: "failed" as const, error: "The upload stopped when the page closed. Add the photo again." }
        : i,
    );
  } catch {
    return [];
  }
}

const bestTitle = (server: string | null | undefined, current: string) =>
  server && !PLACEHOLDER_TITLES.has(server.trim()) ? server : current;

export function UploadProgressProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ImportItem[]>(loadStored);
  const queryClient = useQueryClient();
  // Photos kept in memory so a failed upload can be retried without re-picking
  const pendingBlobs = useRef(new Map<string, { blob: Blob; sessionId?: string; index: number; cookbookId?: string }>());
  const dismissedIds = useRef(new Set<string>());

  useEffect(() => {
    try {
      if (items.length) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage full or blocked: progress still works for this page */
    }
  }, [items]);

  const patch = useCallback((key: string, changes: Partial<ImportItem>) => {
    setItems((prev) => prev.map((i) => (i.key === key || (i.recipeId && i.recipeId === key) ? { ...i, ...changes } : i)));
  }, []);

  const refreshRecipes = useCallback(() => {
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "/api/recipes" });
  }, [queryClient]);

  const addRecipe = useCallback<UploadProgressContextValue["addRecipe"]>((recipeId, title = "Your Recipe", opts = {}) => {
    setItems((prev) => {
      if (prev.some((i) => i.recipeId === recipeId)) return prev;
      return [
        { key: recipeId, recipeId, title, kind: opts.kind ?? "shared", status: "reading", thumbnail: opts.thumbnail ?? null, startedAt: Date.now() },
        ...prev,
      ];
    });
  }, []);

  const uploadOne = useCallback(async (key: string) => {
    const pending = pendingBlobs.current.get(key);
    if (!pending) return;
    patch(key, { status: "uploading", error: undefined });
    try {
      const recipeId = await uploadBatchPhoto(pending.blob, pending.sessionId, pending.index);
      pendingBlobs.current.delete(key);
      setItems((prev) => prev.map((i) => (i.key === key ? { ...i, key: recipeId, recipeId, status: "reading" } : i)));
      await addToCookbook(pending.cookbookId, recipeId);
      refreshRecipes();
    } catch (err) {
      patch(key, { status: "failed", error: apiErrorMessage(err, "The photo didn't upload. Check your connection and try again.") });
    }
  }, [patch, refreshRecipes]);

  const startPhotoBatch = useCallback<UploadProgressContextValue["startPhotoBatch"]>((photos, opts = {}) => {
    const stamp = Date.now();
    const keys = photos.map((_, i) => `local-${stamp}-${i}`);
    setItems((prev) => [
      ...photos.map((p, i) => ({
        key: keys[i],
        title: `Recipe ${i + 1} of ${photos.length}`,
        kind: "photo" as const,
        status: "uploading" as const,
        thumbnail: p.thumbnail ?? null,
        startedAt: stamp + (photos.length - i),
      })),
      ...prev,
    ]);
    void (async () => {
      let sessionId: string | undefined;
      try {
        sessionId = await createUploadSession(photos.length);
      } catch {
        // The session only groups the batch; uploads work without it
      }
      // One at a time keeps phones on slow connections from timing out
      for (let i = 0; i < photos.length; i++) {
        pendingBlobs.current.set(keys[i], { blob: photos[i].blob, sessionId, index: i, cookbookId: opts.cookbookId });
        await uploadOne(keys[i]);
      }
    })();
  }, [uploadOne]);

  const retry = useCallback(async (key: string) => {
    if (pendingBlobs.current.has(key)) return uploadOne(key);
    const item = items.find((i) => i.key === key);
    if (!item?.recipeId) return;
    patch(key, { status: "reading", error: undefined });
    try {
      await retryImport(item.recipeId);
    } catch (err) {
      patch(key, { status: "failed", error: apiErrorMessage(err, "Couldn't start again. Try again in a minute.") });
    }
  }, [items, patch, uploadOne]);

  const markReviewed = useCallback((recipeId: string) => {
    patch(recipeId, { status: "saved" });
    queryClient.invalidateQueries({ queryKey: ["/api/recipe-imports/pending"] });
  }, [patch, queryClient]);

  const dismiss = useCallback((key: string) => {
    const item = items.find((i) => i.key === key);
    if (item?.recipeId && (item.status === "needs_review" || item.status === "failed")) {
      dismissedIds.current.add(item.recipeId);
      dismissImportReview(item.recipeId).catch(() => {});
    }
    pendingBlobs.current.delete(key);
    setItems((prev) => prev.filter((i) => i.key !== key));
  }, [items]);

  const clearFinished = useCallback(() => {
    setItems((prev) => prev.filter((i) => i.status !== "saved"));
  }, []);

  // Poll the items still being read (light endpoint: no images)
  const readingIds = items.filter((i) => i.status === "reading" && i.recipeId).map((i) => i.recipeId!);
  useQuery({
    queryKey: ["/api/recipe-imports/status", readingIds.join(",")],
    enabled: readingIds.length > 0,
    refetchInterval: 3000,
    queryFn: async () => {
      const res = await fetch(`/api/recipe-imports/status?ids=${encodeURIComponent(readingIds.join(","))}`, { credentials: "include" });
      if (!res.ok) return null;
      const data = (await res.json()) as { items: Array<{ recipeId: string; title: string; status: ImportStatus; error: string | null }> };
      let changed = false;
      setItems((prev) =>
        prev.map((i) => {
          const s = data.items.find((d) => d.recipeId === i.recipeId);
          if (!s || i.status !== "reading") return i;
          const title = bestTitle(s.title, i.title);
          if (s.status === i.status && title === i.title) return i;
          if (s.status !== i.status) changed = true;
          return { ...i, status: s.status, title, error: s.error ?? undefined };
        }),
      );
      if (changed) refreshRecipes();
      return data;
    },
  });

  // Imports still waiting for a look, from earlier sessions or other devices
  const { data: pending } = useQuery({
    queryKey: ["/api/recipe-imports/pending"],
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const res = await fetch("/api/recipe-imports/pending", { credentials: "include" });
      if (!res.ok) return null;
      return (await res.json()) as {
        tracking: boolean;
        items: Array<{ recipeId: string; title: string; sourceType: ImportKind; thumbnail: string | null; createdAt: string; status: ImportStatus; error: string | null }>;
      };
    },
  });

  useEffect(() => {
    if (!pending?.items?.length) return;
    setItems((prev) => {
      const known = new Set(prev.map((i) => i.recipeId).filter(Boolean));
      const added = pending.items
        .filter((p) => !known.has(p.recipeId) && !dismissedIds.current.has(p.recipeId))
        .map<ImportItem>((p) => ({
          key: p.recipeId,
          recipeId: p.recipeId,
          title: bestTitle(p.title, "Your recipe"),
          kind: p.sourceType,
          status: p.status,
          error: p.error ?? undefined,
          thumbnail: p.thumbnail,
          startedAt: new Date(p.createdAt).getTime(),
        }));
      return added.length ? [...prev, ...added] : prev;
    });
  }, [pending]);

  const value = useMemo<UploadProgressContextValue>(() => {
    const sorted = [...items].sort((a, b) => b.startedAt - a.startedAt);
    return {
      imports: sorted,
      counts: {
        active: items.filter((i) => i.status === "uploading" || i.status === "reading").length,
        needsReview: items.filter((i) => i.status === "needs_review").length,
        failed: items.filter((i) => i.status === "failed").length,
      },
      addRecipe,
      startPhotoBatch,
      retry,
      markReviewed,
      dismiss,
      clearFinished,
    };
  }, [items, addRecipe, startPhotoBatch, retry, markReviewed, dismiss, clearFinished]);

  return <UploadProgressContext.Provider value={value}>{children}</UploadProgressContext.Provider>;
}

export function useUploadProgress() {
  const context = useContext(UploadProgressContext);
  if (!context) throw new Error("useUploadProgress must be used within UploadProgressProvider");
  return context;
}
