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
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        data-testid={`step-ingredients-toggle-${stepIndex}`}
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        {matches.length} ingredient{matches.length === 1 ? "" : "s"} in this step
      </button>
      {open && (
        <ul className="mt-2 ml-5 space-y-1 text-sm text-muted-foreground list-disc marker:text-border">
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
