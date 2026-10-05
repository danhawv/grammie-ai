import { useCallback, useEffect, useRef } from "react";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";

// Delete now, undo for 10 seconds (docs/DESIGN_PRINCIPLES.md §4).
//
// The item disappears from the UI immediately (hide()), and the real delete
// (commit()) only runs once the Undo window closes, so undo never needs a
// server-side restore. Pending deletes are committed if the page unmounts or
// the tab is closed.

const UNDO_MS = 10_000;

interface UndoableOptions {
  /** Shown in the toast, e.g. "Recipe deleted" */
  message: string;
  /** Remove it from the UI right away */
  hide: () => void;
  /** Put it back in the UI */
  restore: () => void;
  /** Perform the real delete; errors restore the item and show a message */
  commit: () => Promise<unknown>;
}

export function useUndoable() {
  const pending = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => void }>());

  const flushAll = useCallback(() => {
    pending.current.forEach(({ timer, run }) => { clearTimeout(timer); run(); });
    pending.current.clear();
  }, []);

  useEffect(() => {
    window.addEventListener("beforeunload", flushAll);
    return () => { window.removeEventListener("beforeunload", flushAll); flushAll(); };
  }, [flushAll]);

  return useCallback((opts: UndoableOptions) => {
    const id = Math.random().toString(36).slice(2);
    opts.hide();
    const run = () => {
      pending.current.delete(id);
      opts.commit().catch(() => {
        opts.restore();
        toast({ title: "Couldn't delete", description: "It's back. Try again in a moment.", variant: "destructive" });
      });
    };
    const timer = setTimeout(run, UNDO_MS);
    pending.current.set(id, { timer, run });
    toast({
      title: opts.message,
      duration: UNDO_MS,
      action: (
        <ToastAction
          altText="Undo"
          onClick={() => {
            const p = pending.current.get(id);
            if (!p) return;
            clearTimeout(p.timer);
            pending.current.delete(id);
            opts.restore();
          }}
        >
          Undo
        </ToastAction>
      ),
    });
  }, []);
}
