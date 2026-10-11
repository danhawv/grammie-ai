import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Shown while the server builds the plan. The steps advance on a gentle clock
// (the API doesn't report progress), so the wording stays honest: it says what
// Grammie does, and how long it usually takes.

const STAGES = [
  "Looking through your recipes",
  "Choosing dishes that work well together",
  "Sizing each plate for each person",
  "Making one shopping list",
  "Lining up the cooking day",
];

export function BuildingState({ title = "Building your plan" }: { title?: string }) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setStage((s) => Math.min(STAGES.length - 1, s + 1)), 2200);
    return () => clearInterval(iv);
  }, []);
  return (
    <div className="mx-auto max-w-md py-10" role="status" aria-live="polite">
      <h1 className="font-serif text-3xl font-bold">{title}</h1>
      <p className="mt-2 text-base text-muted-foreground">This usually takes under a minute. You can leave this page; your plan will be waiting under Kitchen → Meal plans.</p>
      <ol className="mt-8 space-y-4">
        {STAGES.map((text, i) => (
          <li key={text} className={cn("flex items-center gap-3 text-lg", i > stage && "text-muted-foreground")}>
            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full border", i < stage && "border-primary bg-primary text-primary-foreground")} aria-hidden>
              {i < stage ? <Check className="h-4 w-4" /> : i === stage ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : null}
            </span>
            <span>{text}{i === stage ? "…" : ""}</span>
            <span className="sr-only">{i < stage ? "(done)" : i === stage ? "(working)" : ""}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
