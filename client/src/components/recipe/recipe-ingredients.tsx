import { Check } from "lucide-react";
import type { UnitSystem } from "@shared/units";
import { ingredientDisplay } from "@shared/recipe-display";
import { cn } from "@/lib/utils";
import { getEquipmentEmoji } from "./recipe-utils";

// Ingredients with the amount before the name ("4½ lb chicken breast, diced")
// in 18px+ type. Each row is a real checkbox button so cooks can tick things
// off by tap or keyboard.

const UNIT_OPTIONS: [UnitSystem, string][] = [
  ["original", "As written"],
  ["us", "US"],
  ["metric", "Metric"],
];

export function UnitToggle({ value, onChange }: { value: UnitSystem; onChange: (s: UnitSystem) => void }) {
  return (
    <div role="radiogroup" aria-label="Units" className="inline-flex rounded-md border p-0.5" data-testid="unit-system-toggle">
      {UNIT_OPTIONS.map(([v, label]) => {
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(v)}
            className={cn(
              "min-h-11 rounded-[5px] px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent",
            )}
            data-testid={`unit-system-${v}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function RecipeIngredients({
  ingredients,
  equipment,
  unitSystem,
  onUnitSystemChange,
  checked,
  onToggle,
  onClearChecked,
}: {
  ingredients: any[];
  equipment?: string[] | null;
  unitSystem: UnitSystem;
  onUnitSystemChange: (s: UnitSystem) => void;
  checked: Set<number>;
  onToggle: (index: number) => void;
  onClearChecked: () => void;
}) {
  return (
    <section aria-labelledby="ingredients-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="ingredients-heading" className="font-serif text-2xl font-bold">Ingredients</h2>
        <UnitToggle value={unitSystem} onChange={onUnitSystemChange} />
      </div>

      {ingredients.length === 0 ? (
        <p className="text-lg text-muted-foreground">No ingredients listed yet.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {ingredients.map((ingredient: any, index: number) => {
            const d = typeof ingredient === "string"
              ? { amount: "", name: ingredient, preparation: "", optional: false }
              : ingredientDisplay(ingredient, unitSystem);
            const isChecked = checked.has(index);
            return (
              <li key={index}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isChecked}
                  onClick={() => onToggle(index)}
                  className="flex min-h-12 w-full items-start gap-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  data-testid={`ingredient-row-${index}`}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      isChecked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/60",
                    )}
                    data-testid={`checkbox-ingredient-${index}`}
                  >
                    {isChecked && <Check className="h-4 w-4" strokeWidth={3} />}
                  </span>
                  <span
                    className={cn("flex-1 text-lg leading-snug", isChecked && "text-muted-foreground line-through")}
                    data-testid={`text-ingredient-${index}`}
                  >
                    {ingredient.emoji && <span className="mr-1.5" aria-hidden>{ingredient.emoji}</span>}
                    {d.amount && <span className="font-semibold">{d.amount} </span>}
                    {d.name}
                    {d.preparation && <span>, {d.preparation}</span>}
                    {d.optional && <span className="text-base text-muted-foreground"> (optional)</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {checked.size > 0 && (
        <button
          type="button"
          onClick={onClearChecked}
          className="min-h-11 text-sm font-medium text-primary underline-offset-4 hover:underline"
          data-testid="button-clear-checked-ingredients"
        >
          Uncheck all ({checked.size})
        </button>
      )}

      {equipment && equipment.length > 0 && (
        <div className="rounded-lg bg-muted/50 p-4">
          <h3 className="mb-2 text-base font-semibold">You'll need</h3>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {equipment.map((item, idx) => (
              <li key={idx} className="flex items-center gap-1.5 text-base" data-testid={`text-equipment-${idx}`}>
                <span aria-hidden>{getEquipmentEmoji(item)}</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
