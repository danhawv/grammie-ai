import { useState } from "react";
import { ArrowUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { FilterAction, FiltersState } from "@/lib/filters";

// Search/filter building blocks shared by the Recipes page and the cookbook
// page, so filtering works and looks the same everywhere.

export const sortOptions = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "a-z", label: "A to Z" },
  { value: "z-a", label: "Z to A" },
  { value: "quickest", label: "Quickest" },
  { value: "longest", label: "Longest" },
];

export const DIETARY_LABELS: Record<string, string> = {
  vegetarian: "Vegetarian", vegan: "Vegan", pescatarian: "Pescatarian",
  glutenFree: "Gluten-free", dairyFree: "Dairy-free", keto: "Keto",
  paleo: "Paleo", lowCarb: "Low carb", highProtein: "High protein",
  lowCalorie: "Low calorie", highFiber: "High fiber", mediterranean: "Mediterranean",
};

export const HANDY_FILTERS = [
  { key: "fewIngredients", label: "5 or fewer ingredients" },
  { key: "onePot", label: "One-pot" },
  { key: "budgetFriendly", label: "Budget-friendly" },
  { key: "airFryer", label: "Air fryer" },
] as const;


export function serializeFiltersToParams(f: FiltersState): Record<string, string> {
  const params: Record<string, string> = {};
  if (f.mealTypes.length > 0) params.mealTypes = f.mealTypes.join(",");
  if (f.cuisines.length > 0) params.cuisines = f.cuisines.join(",");
  if (f.cookingMethods.length > 0) params.cookingMethods = f.cookingMethods.join(",");
  if (f.skillLevels.length > 0) params.skillLevels = f.skillLevels.join(",");
  if (f.seasons.length > 0) params.seasons = f.seasons.join(",");
  if (f.excludeAllergens.length > 0) params.excludeAllergens = f.excludeAllergens.join(",");
  if (f.timeConvenience.length > 0) params.timeConvenience = f.timeConvenience.join(",");
  if (f.search) params.search = f.search;
  for (const [key, value] of Object.entries(f.dietary)) {
    if (value) params[`dietary_${key}`] = "true";
  }
  if (f.budgetFriendly) params.budgetFriendly = "true";
  if (f.fewIngredients) params.fewIngredients = "true";
  if (f.onePot) params.onePot = "true";
  if (f.airFryer) params.airFryer = "true";
  return params;
}

export function SortMenu({
  sortBy,
  onSortChange,
  options = sortOptions,
}: {
  sortBy: string;
  onSortChange: (value: string) => void;
  options?: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const currentLabel = options.find((o) => o.value === sortBy)?.label || options[0].label;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2 px-3" aria-label={`Sort: ${currentLabel}`} data-testid="button-sort">
          <ArrowUpDown aria-hidden />
          <span>
            Sort<span className="hidden sm:inline">: {currentLabel}</span>
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <RadioGroup
          value={sortBy}
          onValueChange={(val) => {
            onSortChange(val);
            setOpen(false);
          }}
          aria-label="Sort recipes"
        >
          {options.map(({ value, label }) => (
            <label
              key={value}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-accent"
              data-testid={`sort-${value}`}
            >
              <RadioGroupItem value={value} data-testid={`radio-sort-${value}`} />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </RadioGroup>
      </PopoverContent>
    </Popover>
  );
}

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

/** One removable chip per applied filter (search is shown in its own box) */
export function filterChips(filters: FiltersState, dispatch: (a: FilterAction) => void): FilterChip[] {
  const list: FilterChip[] = [];
  const add = (key: string, label: string, onRemove: () => void) => list.push({ key, label, onRemove });
  filters.mealTypes.forEach((v) => add(`meal-${v}`, v, () => dispatch({ type: "TOGGLE_MEAL_TYPE", payload: v })));
  filters.timeConvenience.forEach((v) => add(`time-${v}`, v, () => dispatch({ type: "TOGGLE_TIME_CONVENIENCE", payload: v })));
  for (const [key, value] of Object.entries(filters.dietary)) {
    if (value) add(`diet-${key}`, DIETARY_LABELS[key] || key, () => dispatch({ type: "TOGGLE_DIETARY", payload: key as keyof FiltersState["dietary"] }));
  }
  filters.excludeAllergens.forEach((v) => add(`allergen-${v}`, `No ${v}`, () => dispatch({ type: "TOGGLE_ALLERGEN", payload: v })));
  filters.cuisines.forEach((v) => add(`cuisine-${v}`, v, () => dispatch({ type: "TOGGLE_CUISINE", payload: v })));
  filters.seasons.forEach((v) => add(`season-${v}`, v, () => dispatch({ type: "TOGGLE_SEASON", payload: v })));
  filters.cookingMethods.forEach((v) => add(`method-${v}`, v, () => dispatch({ type: "TOGGLE_COOKING_METHOD", payload: v })));
  filters.skillLevels.forEach((v) => add(`skill-${v}`, v, () => dispatch({ type: "TOGGLE_SKILL_LEVEL", payload: v })));
  HANDY_FILTERS.forEach(({ key, label }) => {
    if (filters[key]) add(key, label, () => dispatch({ type: "TOGGLE_QUICK_FILTER", payload: key }));
  });
  return list;
}

export function FilterChipsRow({ chips, onClearAll }: { chips: FilterChip[]; onClearAll: () => void }) {
  if (chips.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="filter-chips-row" aria-label="Applied filters">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.onRemove}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 pl-4 pr-3 text-sm font-medium text-foreground hover:bg-primary/15"
          aria-label={`Remove filter: ${chip.label}`}
          data-testid={`chip-filter-${chip.key}`}
        >
          {chip.label}
          <X className="h-4 w-4" aria-hidden />
        </button>
      ))}
      {chips.length > 1 && (
        <Button variant="ghost" onClick={onClearAll} data-testid="button-clear-all-chips">
          Clear all
        </Button>
      )}
    </div>
  );
}
