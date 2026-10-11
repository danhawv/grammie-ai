import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { mealPrepApi, mealPrepKeys } from "@/lib/meal-prep-api";
import { formatDay } from "@/lib/meal-prep-format";
import { planStatusText } from "./plan-status";

// The main action on Kitchen → Meal plans: start (or pick back up) a meal
// prep plan. The older week-by-week plans stay listed below it.

export function MealPrepEntryCard() {
  const plans = useQuery({ queryKey: mealPrepKeys.plans, queryFn: mealPrepApi.listPlans, retry: false });
  const open = (plans.data ?? []).filter((p) => p.status === "draft" || p.status === "approved");
  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-6" aria-labelledby="meal-prep-entry">
      <h2 id="meal-prep-entry" className="font-serif text-2xl font-bold">Cook once, eat all week</h2>
      <p className="mt-1 text-base text-muted-foreground">
        Grammie picks dishes from your recipes, sizes each plate for each person's goals, and plans one shopping trip and one cooking session.
      </p>
      {open.length > 0 && (
        <ul className="mt-4 space-y-2">
          {open.map((p) => (
            <li key={p.id}>
              <Link
                href={`/meal-prep/${p.id}`}
                className="flex min-h-14 items-center gap-3 rounded-lg border bg-card px-4 py-2 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold">
                    {p.status === "draft" ? "Finish reviewing" : "Open"} the plan{p.sessionDate ? ` for ${formatDay(p.sessionDate)}` : ""}
                  </span>
                  <span className="block text-sm text-muted-foreground">{planStatusText(p)}{p.dishes.length > 0 ? ` · ${p.dishes.join(" · ")}` : ""}</span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Button asChild size="lg" className="mt-4 w-full sm:w-auto" data-testid="button-plan-meal-prep">
        <Link href="/meal-prep"><Sparkles aria-hidden /> Plan my meal prep</Link>
      </Button>
    </section>
  );
}
