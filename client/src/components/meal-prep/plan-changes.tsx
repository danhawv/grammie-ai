import { ArrowLeftRight, CheckCircle2, Clock, CupSoda, Drumstick, Loader2, RotateCcw, Undo2 } from "lucide-react";
import type { AppliedSwap } from "@shared/meal-prep/contract";
import type { PlanChanges, PlanOptionView } from "@shared/meal-prep/api";
import { swapChip, swapKey } from "@shared/meal-prep/callouts";
import { Button } from "@/components/ui/button";
import { formatMinutes } from "@/lib/meal-prep-format";
import { cn } from "@/lib/utils";

// The owner's rule for swaps: every one is called out plainly, with what it
// changed in the recipe and what it did. These pieces show them on the plan
// review (dish cards, "Changes we made"), the approved plan and the option
// cards, and let the owner keep a recipe as written.

/** "Lighter swap" / "More protein swap", as a chip with an icon (never color alone) */
export function SwapChip({ goal, className }: { goal: AppliedSwap["goal"]; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border border-emerald-700/40 bg-emerald-50 px-2.5 py-0.5 text-sm font-medium text-emerald-900 dark:border-emerald-400/40 dark:bg-emerald-950 dark:text-emerald-100", className)}>
      <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
      {swapChip(goal)}
    </span>
  );
}

/** A dish's swaps on its card: chip, the note, what to use instead, and "Keep it as written" */
export function DishSwaps({
  swaps,
  onKeep,
  disabled,
}: {
  swaps: AppliedSwap[];
  onKeep?: (key: string) => void;
  disabled?: boolean;
}) {
  if (!swaps.length) return null;
  return (
    <ul className="mt-2 space-y-2">
      {swaps.map((s) => (
        <li key={s.swapId} className="rounded-md border border-emerald-700/30 bg-emerald-50/60 p-2.5 dark:border-emerald-400/30 dark:bg-emerald-950/40">
          <SwapChip goal={s.goal} />
          <p className="mt-1 text-base">{s.note}</p>
          {s.changes?.map((c) => <p key={c.lineIndex} className="text-sm text-muted-foreground">{c.use}</p>)}
          {onKeep && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-11 px-2 text-primary"
              onClick={() => onKeep(swapKey(s.recipeId, s.swapId))}
              disabled={disabled}
              data-testid={`keep-as-written-${s.recipeId}`}
            >
              <Undo2 aria-hidden /> Keep it as written
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** "Changes we made": every swap and top-up, with what each did */
export function ChangesSection({
  changes,
  keptAsWritten = [],
  titleOf,
  onAllowAgain,
  disabled,
}: {
  changes: PlanChanges;
  /** "recipeId:swapId" the owner turned off, shown so they can be undone */
  keptAsWritten?: string[];
  titleOf?: (recipeId: string) => string;
  onAllowAgain?: (key: string) => void;
  disabled?: boolean;
}) {
  const { swaps, topUps } = changes;
  if (!swaps.length && !topUps.length && !keptAsWritten.length) return null;
  return (
    <section aria-labelledby="changes-heading" className="mb-6 space-y-3 rounded-lg border bg-card p-4">
      <h2 id="changes-heading" className="text-xl font-semibold">Changes we made</h2>
      {swaps.length > 0 && (
        <div className="space-y-2">
          <p className="text-base text-muted-foreground">
            {swaps.length === 1 ? "One recipe uses a swap" : `${swaps.length} recipe swaps`} to help hit the numbers. Everything else is cooked as written.
          </p>
          <ul className="space-y-2">
            {swaps.map((s) => (
              <li key={`${s.recipeId}:${s.swapId}`} className="flex gap-3">
                <ArrowLeftRight className="mt-1 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-base"><span className="font-semibold">{s.dish}:</span> {s.note}</span>
                  {s.changes?.map((c) => <span key={c.lineIndex} className="block text-sm text-muted-foreground">{c.use}</span>)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {topUps.length > 0 && (
        <div className="space-y-2">
          <p className="text-base text-muted-foreground">Added on the side for protein (not in any recipe):</p>
          <ul className="space-y-1">
            {topUps.map((t) => {
              const Icon = t.kind === "shake" ? CupSoda : Drumstick;
              return (
                <li key={`${t.personId}:${t.adjusterId}`} className="flex gap-3 text-base">
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden /> {t.text}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {keptAsWritten.length > 0 && onAllowAgain && (
        <div className="space-y-1 border-t pt-3">
          <p className="text-sm text-muted-foreground">Kept as written at your request:</p>
          <ul className="flex flex-wrap gap-2">
            {keptAsWritten.map((key) => (
              <li key={key}>
                <Button variant="outline" size="sm" className="h-11" onClick={() => onAllowAgain(key)} disabled={disabled}>
                  <RotateCcw aria-hidden /> Allow the swap in {titleOf?.(key.split(":")[0]) ?? "that dish"} again
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** "Protein 104% · Calories 99%" of the prepped meals' share of the targets */
function fitLine(o: PlanOptionView): string | null {
  const parts: string[] = [];
  if (o.proteinPct != null) parts.push(`Protein ${o.proteinPct}%`);
  if (o.kcalPct != null) parts.push(`Calories ${o.kcalPct}%`);
  return parts.length ? `${parts.join(" · ")} of target` : null;
}

/** Up to three plans side by side; picking one makes it the plan */
export function OptionCards({
  options,
  onPick,
  pendingKey,
  disabled,
}: {
  options: PlanOptionView[];
  onPick: (key: PlanOptionView["key"]) => void;
  pendingKey?: string | null;
  disabled?: boolean;
}) {
  if (options.length < 2) return null;
  const none = !options.some((o) => o.chosen);
  return (
    <section aria-labelledby="options-heading" className="mb-6 space-y-3">
      <div>
        <h2 id="options-heading" className="text-xl font-semibold">Pick a plan</h2>
        <p className="text-base text-muted-foreground">
          {none ? "You've changed the dishes, so this is your own mix. Pick one of these to start over from it." : "Grammie made a few different weeks. Each one fits your goals; they differ in the dishes."}
        </p>
      </div>
      <ul className="grid gap-3 md:grid-cols-3">
        {options.map((o) => {
          const fit = fitLine(o);
          return (
            <li key={o.key}>
              <button
                type="button"
                aria-pressed={o.chosen}
                disabled={disabled || o.chosen}
                onClick={() => onPick(o.key)}
                data-testid={`option-${o.key}`}
                className={cn(
                  "flex h-full w-full flex-col gap-2 rounded-lg border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                  o.chosen ? "border-primary bg-primary/5 ring-1 ring-primary" : "bg-card hover:bg-accent/50 disabled:opacity-60",
                )}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="text-lg font-semibold leading-snug">{o.label}</span>
                  {o.chosen ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary"><CheckCircle2 className="h-4 w-4" aria-hidden /> This plan</span>
                  ) : pendingKey === o.key ? (
                    <Loader2 className="h-5 w-5 shrink-0 motion-safe:animate-spin" aria-label="Switching" />
                  ) : null}
                </span>
                <span className="text-sm text-muted-foreground">{o.summary}</span>
                <span className="text-base">{o.dishes.map((d) => d.title).join(" · ")}</span>
                <span className="mt-auto space-y-0.5 pt-1 text-sm">
                  <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 shrink-0" aria-hidden /> About {formatMinutes(o.handsOnMinutes)} hands-on</span>
                  {fit && <span className="block">{fit}</span>}
                  <span className="block">
                    {o.swapCount === 0 ? "No recipe swaps" : `${o.swapCount} recipe ${o.swapCount === 1 ? "swap" : "swaps"}`}
                    {o.topUpCount > 0 ? ` · protein added to ${o.topUpCount} ${o.topUpCount === 1 ? "meal" : "meals"}` : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type CookSwap = Pick<AppliedSwap, "swapId" | "title" | "goal" | "note" | "changes">;

/** For the cook: "Swap in this batch" with exactly what to use instead */
export function CookSwapBox({ swaps, className }: { swaps: CookSwap[] | undefined; className?: string }) {
  if (!swaps?.length) return null;
  return (
    <div className={cn("space-y-1 rounded-md border-2 border-emerald-700/50 bg-emerald-50 p-3 text-emerald-950 dark:border-emerald-400/50 dark:bg-emerald-950 dark:text-emerald-50", className)} role="note">
      {swaps.map((s) => (
        <div key={s.swapId}>
          <SwapChip goal={s.goal} />
          {(s.changes?.length ? s.changes.map((c) => c.use) : [s.title]).map((u) => <p key={u} className="mt-1 font-semibold">{u}</p>)}
          <p className="text-sm">{s.note}</p>
        </div>
      ))}
    </div>
  );
}

/** The recipe's ingredient lines, with swapped ones marked and the replacement under them */
export function IngredientsWithSwaps({ ingredients, swaps, className }: { ingredients: string[]; swaps: CookSwap[] | undefined; className?: string }) {
  const byLine = new Map<number, string>();
  for (const s of swaps ?? []) for (const c of s.changes ?? []) byLine.set(c.lineIndex, c.use);
  return (
    <ul className={cn("list-disc space-y-1 pl-6", className)}>
      {ingredients.map((x, i) => (
        <li key={i}>
          {byLine.has(i) ? (
            <>
              <s className="text-muted-foreground">{x}</s>
              <span className="block font-semibold text-emerald-800 dark:text-emerald-300"><ArrowLeftRight className="mr-1 inline h-4 w-4" aria-hidden />{byLine.get(i)}</span>
            </>
          ) : x}
        </li>
      ))}
    </ul>
  );
}
