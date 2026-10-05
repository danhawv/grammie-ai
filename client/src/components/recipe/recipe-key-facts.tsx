import { Loader2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMinutes } from "@shared/recipe-display";

// The numbers a cook checks first: prep, cook and total time, and a
// servings stepper that rescales the ingredients.

export function RecipeKeyFacts({
  prepMinutes,
  cookMinutes,
  totalMinutes,
  servings,
  onServingsChange,
  scaling,
}: {
  prepMinutes?: number | null;
  cookMinutes?: number | null;
  totalMinutes?: number | null;
  servings: number;
  onServingsChange: (n: number) => void;
  scaling: boolean;
}) {
  const times = [
    { label: "Prep", value: formatMinutes(prepMinutes), testId: "text-prep-time" },
    { label: "Cook", value: formatMinutes(cookMinutes), testId: "text-cook-time" },
    { label: "Total", value: formatMinutes(totalMinutes), testId: "text-total-time" },
  ].filter((t) => t.value);

  return (
    <section aria-label="Times and servings" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border bg-card px-4 py-3">
      {times.length > 0 && (
        <dl className="flex flex-wrap gap-x-6 gap-y-3">
          {times.map((t) => (
            <div key={t.label}>
              <dt className="text-sm text-muted-foreground">{t.label}</dt>
              <dd className="text-lg font-semibold" data-testid={t.testId}>{t.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex items-center gap-3">
        <p id="servings-label" className="text-sm text-muted-foreground">Servings</p>
        <div className="flex items-center gap-2" role="group" aria-labelledby="servings-label">
          <Button
            size="icon"
            variant="outline"
            onClick={() => onServingsChange(servings - 1)}
            disabled={servings <= 1 || scaling}
            aria-label="Fewer servings"
            data-testid="button-decrease-servings"
          >
            <Minus aria-hidden />
          </Button>
          <span className="relative w-10 text-center text-xl font-semibold tabular-nums" aria-live="polite" data-testid="text-servings-count">
            {servings}
            {scaling && <Loader2 className="absolute -right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 motion-safe:animate-spin" aria-label="Updating amounts" />}
          </span>
          <Button
            size="icon"
            variant="outline"
            onClick={() => onServingsChange(servings + 1)}
            disabled={scaling}
            aria-label="More servings"
            data-testid="button-increase-servings"
          >
            <Plus aria-hidden />
          </Button>
        </div>
      </div>
    </section>
  );
}
