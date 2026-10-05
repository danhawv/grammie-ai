import { useCallback, useEffect, useRef, useState } from "react";
import { createAutosaver, type AutosaveState } from "@shared/autosave";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { CookbookPrintProject } from "@shared/schema";
import type { BookDraft } from "./types";

// Autosaves the print builder (layout, template and print specs) to the
// cookbook's print project, a moment after each change. Nothing is saved
// until the person changes something.

const DELAY_MS = 1200;

export function usePrintAutosave(cookbookId: number, initialProjectId: number | undefined) {
  const [state, setState] = useState<AutosaveState>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const projectId = useRef<number | undefined>(initialProjectId);
  useEffect(() => {
    if (initialProjectId && !projectId.current) projectId.current = initialProjectId;
  }, [initialProjectId]);

  const saverRef = useRef<ReturnType<typeof createAutosaver<BookDraft>> | null>(null);
  if (!saverRef.current) {
    saverRef.current = createAutosaver<BookDraft>({
      delayMs: DELAY_MS,
      onState: (s) => {
        setState(s);
        if (s === "saved") setSavedAt(new Date());
      },
      save: async (draft) => {
        // POST upserts on the server, so a first save from two tabs can't fork the book
        const res = projectId.current
          ? await apiRequest("PATCH", `/api/print-projects/${projectId.current}`, draft)
          : await apiRequest("POST", `/api/cookbooks/${cookbookId}/print-projects`, draft);
        const project = (await res.json()) as CookbookPrintProject;
        projectId.current = project.id;
        queryClient.setQueryData<CookbookPrintProject[]>(["/api/cookbooks", cookbookId, "print-projects"], (old) => {
          if (!old?.length) return [project];
          return old.map((p) => (p.id === project.id ? project : p));
        });
      },
    });
  }
  const saver = saverRef.current;

  // Save before leaving the page; warn if a save is still on its way
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!saver.hasUnsaved) return;
      void saver.flush();
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Leaving the editor inside the app: send the last change
      void saver.flush();
    };
  }, [saver]);

  const schedule = useCallback((draft: BookDraft) => saver.schedule(draft), [saver]);
  const flush = useCallback(() => saver.flush(), [saver]);
  const retry = useCallback(() => saver.retry(), [saver]);

  return { state, savedAt, schedule, flush, retry };
}
