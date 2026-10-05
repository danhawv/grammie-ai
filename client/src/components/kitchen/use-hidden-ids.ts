import { useCallback, useState } from "react";

/**
 * Ids hidden from a list while their delete waits out the Undo window
 * (see useUndoable). Filtering at render time keeps hidden rows hidden even
 * if the query refetches before the real delete runs.
 */
export function useHiddenIds() {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const hide = useCallback((ids: string[]) => {
    setHidden((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);
  const show = useCallback((ids: string[]) => {
    setHidden((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);
  return { hidden, hide, show };
}
