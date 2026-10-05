import { useState } from "react";
import { ArrowLeftRight, Sparkles, ThermometerSun, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StepIngredients } from "@/components/step-ingredients";

// Numbered steps in 18px+ type, with each step's time, temperature,
// ingredients and "ready when" cue.

export function RecipeSteps({
  instructions,
  ingredients,
  instructionsGenerated,
  originalInstructions,
}: {
  instructions: any[];
  ingredients: any[];
  instructionsGenerated?: boolean | null;
  originalInstructions?: string[] | null;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const hasOriginal = !!instructionsGenerated && !!originalInstructions && originalInstructions.length > 0;
  const showingOriginal = showOriginal && hasOriginal;

  return (
    <section aria-labelledby="steps-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="steps-heading" className="font-serif text-2xl font-bold">Steps</h2>
        <div className="flex flex-wrap items-center gap-2">
          {instructionsGenerated && (
            <Badge variant="outline" className="gap-1 text-sm" data-testid="badge-instructions-generated">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              {showingOriginal ? "Original" : "AI Generated"}
            </Badge>
          )}
          {hasOriginal && (
            <Button variant="ghost" onClick={() => setShowOriginal(!showOriginal)} data-testid="button-toggle-instructions">
              <ArrowLeftRight aria-hidden />
              {showingOriginal ? "Show AI" : "Show Original"}
            </Button>
          )}
        </div>
      </div>

      {instructions.length === 0 && !showingOriginal ? (
        <p className="text-lg text-muted-foreground">No steps listed yet.</p>
      ) : (
        <ol className="space-y-6">
          {showingOriginal
            ? originalInstructions!.map((text, index) => (
                <li key={index} className="flex gap-4" data-testid={`instruction-original-${index}`}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted font-semibold tabular-nums" aria-hidden>
                    {index + 1}
                  </span>
                  <p className="flex-1 pt-1.5 text-lg leading-relaxed">
                    <span className="sr-only">Step {index + 1}: </span>
                    {text}
                  </p>
                </li>
              ))
            : instructions.map((instruction: any, index: number) => {
                const n = instruction.stepNumber ?? index + 1;
                return (
                  <li key={index} className="flex gap-4" data-testid={`instruction-${index}`}>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary font-semibold tabular-nums text-primary-foreground" aria-hidden>
                      {n}
                    </span>
                    <div className="min-w-0 flex-1 pt-1.5">
                      <p className="text-lg leading-relaxed">
                        <span className="sr-only">Step {n}: </span>
                        {instruction.text}
                      </p>
                      {(instruction.timeMinutes || instruction.temperature) && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {instruction.timeMinutes ? (
                            <Badge variant="secondary" className="gap-1 text-sm">
                              <Timer className="h-3.5 w-3.5" aria-hidden />
                              {instruction.timeMinutes} min
                            </Badge>
                          ) : null}
                          {instruction.temperature && instruction.temperature.value != null && (
                            <Badge variant="secondary" className="gap-1 text-sm">
                              <ThermometerSun className="h-3.5 w-3.5" aria-hidden />
                              {instruction.temperature.value}°{instruction.temperature.scale}
                            </Badge>
                          )}
                        </div>
                      )}
                      <StepIngredients stepIngredients={instruction.ingredients} recipeIngredients={ingredients} stepIndex={index} />
                      {instruction.donenessCue && (
                        <p className="mt-2 text-base text-muted-foreground">
                          <span className="font-medium text-foreground">Ready when:</span> {instruction.donenessCue}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
        </ol>
      )}
    </section>
  );
}
