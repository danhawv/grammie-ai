import { useState, useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { matchStepIngredients } from "@shared/step-ingredients";
import { useUnitSystem } from "@/hooks/use-unit-system";

// Collapsible "ingredients used in this step" list shown under each
// instruction, with quantities pulled from the recipe's full ingredient list.

export function StepIngredients({ stepIngredients, recipeIngredients, stepIndex }: {
  stepIngredients: string[] | null | undefined;
  recipeIngredients: any[];
  stepIndex: number;
}) {
  const [open, setOpen] = useState(false);
  const [unitSystem] = useUnitSystem();
  const matches = useMemo(
    () => matchStepIngredients(stepIngredients, recipeIngredients, unitSystem),
    [stepIngredients, recipeIngredients, unitSystem]
  );

  if (matches.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        data-testid={`step-ingredients-toggle-${stepIndex}`}
      >
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        {matches.length} ingredient{matches.length === 1 ? "" : "s"} in this step
      </button>
      {open && (
        <ul className="mb-1 ml-5 space-y-1 text-base list-disc marker:text-muted-foreground">
          {matches.map((ing, i) => (
            <li key={i} data-testid={`step-${stepIndex}-ingredient-${i}`}>
              {ing.display}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
