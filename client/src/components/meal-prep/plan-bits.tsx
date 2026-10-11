import { useMemo } from "react";
import { AlertTriangle, Check, Refrigerator, Snowflake, Utensils, X } from "lucide-react";
import type { DayFit, Plate, PrepSetup } from "@shared/meal-prep/contract";
import { SLOT_LABELS } from "@/lib/meal-prep-api";
import {
  dayBars,
  describePlate,
  eatByText,
  eatingDate,
  formatDay,
  personWeek,
  plateKey,
  type FitTone,
  type MacroBar,
  type PlateNames,
} from "@/lib/meal-prep-format";
import { cn } from "@/lib/utils";
import { titleFor } from "./cook-data";

// Display pieces shared by the plan review, cook mode and the packet.

/** Plate wording from the plan's recipe titles, with friendly fallbacks */
export function usePlanNames(titles: Record<string, string> | undefined): PlateNames {
  return useMemo(() => ({ recipeTitle: (id: string) => titleFor(titles ?? {}, id) }), [titles]);
}

const TONE: Record<FitTone, { bar: string; text: string; icon: typeof Check }> = {
  good: { bar: "bg-green-600 dark:bg-green-500", text: "text-green-800 dark:text-green-300", icon: Check },
  close: { bar: "bg-amber-500", text: "text-amber-800 dark:text-amber-300", icon: AlertTriangle },
  off: { bar: "bg-red-600 dark:bg-red-500", text: "text-red-800 dark:text-red-300", icon: X },
};

/** One macro as a fill bar with words, so color is never the only signal */
export function MacroFillBar({ bar, approx }: { bar: MacroBar; approx?: boolean }) {
  const tone = TONE[bar.tone];
  const Icon = tone.icon;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{bar.label}</span>
        <span className={cn("inline-flex items-center gap-1", tone.text)}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {bar.verdict}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${Math.max(4, bar.fill * 100)}%` }} />
      </div>
      <p className="text-sm text-muted-foreground tabular-nums">{approx ? "≈ " : ""}{bar.amount}</p>
    </div>
  );
}

/** A person-day's fit: protein first; calories and the rest after */
export function DayFitBars({ fit, approx, compact }: { fit: DayFit; approx?: boolean; compact?: boolean }) {
  const bars = dayBars(fit);
  if (!bars.length) return null;
  const shown = compact ? bars.slice(0, 2) : bars;
  return (
    <div className={cn("grid gap-3", shown.length > 1 && "sm:grid-cols-2")}>
      {shown.map((b) => <MacroFillBar key={b.key} bar={b} approx={approx} />)}
    </div>
  );
}

export function StorageBadge({ storage }: { storage: Plate["storage"] }) {
  const Icon = storage === "freezer" ? Snowflake : storage === "fridge" ? Refrigerator : Utensils;
  const label = storage === "freezer" ? "Freezer" : storage === "fridge" ? "Fridge" : "Make fresh";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-sm",
        storage === "freezer" ? "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200" : "bg-secondary",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}

export function DishPhoto({ src, className }: { src?: string | null; className?: string }) {
  if (src) {
    return <img src={src} alt="" className={cn("rounded-md object-cover", className)} loading="lazy" />;
  }
  return (
    <div className={cn("flex items-center justify-center rounded-md bg-secondary text-muted-foreground", className)} aria-hidden>
      <Utensils className="h-6 w-6" />
    </div>
  );
}

/** One person's week: a card per day with the fit bars and what's on each plate */
export function PersonWeek({
  setup,
  plates,
  fit,
  personId,
  names,
  rough,
}: {
  setup: PrepSetup;
  plates: Plate[];
  fit: DayFit[];
  personId: string;
  names: PlateNames;
  /** plate keys whose numbers are rough estimates */
  rough: Set<string>;
}) {
  const week = personWeek(plates, personId, setup.days);
  return (
    <ol className="space-y-3">
      {week.map(({ day, plates: dayPlates }) => {
        const date = eatingDate(setup, day);
        const dayFit = fit.find((f) => f.personId === personId && f.day === day);
        const approx = dayPlates.some((p) => rough.has(plateKey(p)));
        return (
          <li key={day} className="rounded-lg border bg-card p-4">
            <h4 className="mb-3 text-lg font-semibold">{formatDay(date)}</h4>
            {dayPlates.length === 0 ? (
              <p className="text-base text-muted-foreground">Nothing prepped this day.</p>
            ) : (
              <ul className="space-y-3">
                {/* Plates stay in words; the numbers live in the day's bars below */}
                {dayPlates.map((p) => (
                  <li key={p.slot} className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">{SLOT_LABELS[p.slot]}</p>
                    <p className="text-base">{describePlate(p, names)}</p>
                    <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <StorageBadge storage={p.storage} />
                      <span>{eatByText(p.eatBy, setup.session.date)}</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {dayFit && dayFit.target && (
              <div className="mt-4 border-t pt-3">
                {/* DayFit.target is already scaled to the prepped meals' share of the day */}
                <p className="mb-2 text-sm font-medium text-muted-foreground">From the prepped meals</p>
                <DayFitBars fit={dayFit} approx={approx} />
                {approx && <p className="mt-2 text-sm text-muted-foreground">≈ One dish's numbers are a rough estimate.</p>}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
