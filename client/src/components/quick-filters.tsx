import { Dispatch } from "react";
import { Clock, Zap, Leaf, Wheat, Milk, Carrot, type LucideIcon } from "lucide-react";
import { FiltersState, FilterAction } from "@/lib/filters";
import { cn } from "@/lib/utils";

// The optional row of one-tap filters on Recipes. It only shows when the
// user turns on Settings > "Show Quick Filters", and it shows the chips they
// picked there. Ids match the Settings page's filter ids.

interface QuickChip {
  id: string;
  label: string;
  icon: LucideIcon;
  isActive: (f: FiltersState) => boolean;
  toggle: FilterAction;
}

const time = (id: string, label: string, value: string): QuickChip => ({
  id,
  label,
  icon: Clock,
  isActive: (f) => f.timeConvenience.includes(value),
  toggle: { type: "TOGGLE_TIME_CONVENIENCE", payload: value },
});

const diet = (id: string, label: string, icon: LucideIcon, key: keyof FiltersState["dietary"]): QuickChip => ({
  id,
  label,
  icon,
  isActive: (f) => f.dietary[key],
  toggle: { type: "TOGGLE_DIETARY", payload: key },
});

export const QUICK_FILTER_CHIPS: QuickChip[] = [
  time("under-15-mins", "Under 15 min", "Under 15 mins"),
  time("under-30-mins", "Under 30 min", "Under 30 mins"),
  time("under-1-hour", "Under 1 hour", "Under 1 hour"),
  diet("vegetarian", "Vegetarian", Carrot, "vegetarian"),
  diet("vegan", "Vegan", Leaf, "vegan"),
  diet("gluten-free", "Gluten-free", Wheat, "glutenFree"),
  diet("dairy-free", "Dairy-free", Milk, "dairyFree"),
  diet("high-protein", "High protein", Zap, "highProtein"),
];

interface QuickFiltersProps {
  filters: FiltersState;
  dispatch: Dispatch<FilterAction>;
  /** Chip ids chosen in Settings; unknown ids (e.g. old collection ids) are ignored */
  enabledIds?: string[];
}

export function QuickFilters({ filters, dispatch, enabledIds }: QuickFiltersProps) {
  const chips = enabledIds ? QUICK_FILTER_CHIPS.filter((c) => enabledIds.includes(c.id)) : QUICK_FILTER_CHIPS;
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 py-2" role="group" aria-label="Quick filters" data-testid="quick-filters-bar">
      {chips.map(({ id, label, icon: Icon, isActive, toggle }) => {
        const active = isActive(filters);
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            onClick={() => dispatch(toggle)}
            className={cn(
              "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors",
              active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent",
            )}
            data-testid={`chip-quick-${id}`}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
