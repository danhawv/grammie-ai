import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { UploadRecipeModal } from "@/components/upload-recipe-modal";

// One "Add recipe" entry point for the whole app (docs/DESIGN_PRINCIPLES.md):
// the tab bar, header, empty states and anything else call openAddRecipe().

type Mode = "image" | "link" | "text";

const AddRecipeContext = createContext<{ openAddRecipe: (mode?: Mode) => void }>({
  openAddRecipe: () => {},
});

export function AddRecipeProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("image");
  const openAddRecipe = useCallback((m: Mode = "image") => {
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
