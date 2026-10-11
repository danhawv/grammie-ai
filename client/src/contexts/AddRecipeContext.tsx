import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { UploadRecipeModal } from "@/components/upload-recipe-modal";

// One "Add recipe" entry point for the whole app (docs/DESIGN_PRINCIPLES.md):
// the tab bar, header, empty states and anything else call openAddRecipe().
// No mode opens the three choices; a mode jumps straight to that choice.

export type AddRecipeMode = "image" | "link" | "text";

/** Something to start the sheet with: a link (imported right away), photos or pasted text */
export interface AddRecipePrefill {
  link?: string;
  files?: File[];
  text?: string;
}

const ADD_RECIPE_EVENT = "grammie:add-recipe";

/**
 * Opens the Add recipe sheet from outside React (the app's share sheet
 * hand-off in client/src/native/share-intake.ts)
 */
export function requestAddRecipe(mode: AddRecipeMode, prefill?: AddRecipePrefill): void {
  if (!listening) {
    // The app is still starting (opened by the share): hand it over on mount
    pending = { mode, prefill };
    return;
  }
  window.dispatchEvent(new CustomEvent(ADD_RECIPE_EVENT, { detail: { mode, prefill } }));
}

let listening = false;
let pending: { mode: AddRecipeMode; prefill?: AddRecipePrefill } | null = null;

const AddRecipeContext = createContext<{ openAddRecipe: (mode?: AddRecipeMode, prefill?: AddRecipePrefill) => void }>({
  openAddRecipe: () => {},
});

export function AddRecipeProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AddRecipeMode | undefined>(undefined);
  const [prefill, setPrefill] = useState<AddRecipePrefill | undefined>(undefined);
  const openAddRecipe = useCallback((m?: AddRecipeMode, p?: AddRecipePrefill) => {
    setMode(m);
    setPrefill(p);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onRequest = (e: Event) => {
      const { mode: m, prefill: p } = (e as CustomEvent<{ mode: AddRecipeMode; prefill?: AddRecipePrefill }>).detail;
      openAddRecipe(m, p);
    };
    window.addEventListener(ADD_RECIPE_EVENT, onRequest);
    listening = true;
    if (pending) {
      openAddRecipe(pending.mode, pending.prefill);
      pending = null;
    }
    return () => {
      listening = false;
      window.removeEventListener(ADD_RECIPE_EVENT, onRequest);
    };
  }, [openAddRecipe]);

  return (
    <AddRecipeContext.Provider value={{ openAddRecipe }}>
      {children}
      <UploadRecipeModal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setPrefill(undefined);
        }}
        initialMode={mode}
        prefill={prefill}
      />
    </AddRecipeContext.Provider>
  );
}

export const useAddRecipe = () => useContext(AddRecipeContext);
