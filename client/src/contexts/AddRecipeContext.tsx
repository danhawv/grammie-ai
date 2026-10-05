import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { UploadRecipeModal } from "@/components/upload-recipe-modal";

// One "Add recipe" entry point for the whole app (docs/DESIGN_PRINCIPLES.md):
// the tab bar, header, empty states and anything else call openAddRecipe().
// No mode opens the three choices; a mode jumps straight to that choice.

export type AddRecipeMode = "image" | "link" | "text";

const AddRecipeContext = createContext<{ openAddRecipe: (mode?: AddRecipeMode) => void }>({
  openAddRecipe: () => {},
});

export function AddRecipeProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AddRecipeMode | undefined>(undefined);
  const openAddRecipe = useCallback((m?: AddRecipeMode) => {
    setMode(m);
    setOpen(true);
  }, []);
  return (
    <AddRecipeContext.Provider value={{ openAddRecipe }}>
      {children}
      <UploadRecipeModal open={open} onOpenChange={setOpen} initialMode={mode} />
    </AddRecipeContext.Provider>
  );
}

export const useAddRecipe = () => useContext(AddRecipeContext);
