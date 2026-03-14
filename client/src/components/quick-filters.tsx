import { Dispatch } from "react";
import { Clock, Zap, Leaf, Wheat, Milk, Soup, DollarSign, Flame, ListChecks } from "lucide-react";
import { FiltersState, FilterAction } from "@/lib/filters";
import { Badge } from "@/components/ui/badge";

interface QuickFiltersProps {
  filters: FiltersState;
  dispatch: Dispatch<FilterAction>;
}

const quickFilterChips = [
  {
    id: "under-30-min",
    label: "Under 30 min",
    icon: Clock,
    isActive: (f: FiltersState) => f.timeConvenience.includes("Under 30 mins"),
    toggle: { type: "TOGGLE_TIME_CONVENIENCE" as const, payload: "Under 30 mins" },
  },
  {
    id: "high-protein",
    label: "High Protein",
    icon: Zap,
    isActive: (f: FiltersState) => f.dietary.highProtein,
    toggle: { type: "TOGGLE_DIETARY" as const, payload: "highProtein" as const },
  },
  {
    id: "vegan",
    label: "Vegan",
    icon: Leaf,
    isActive: (f: FiltersState) => f.dietary.vegan,
    toggle: { type: "TOGGLE_DIETARY" as const, payload: "vegan" as const },
  },
  {
    id: "gluten-free",
    label: "Gluten-Free",
    icon: Wheat,
    isActive: (f: FiltersState) => f.dietary.glutenFree,
    toggle: { type: "TOGGLE_DIETARY" as const, payload: "glutenFree" as const },
  },
  {
    id: "dairy-free",
    label: "Dairy-Free",
    icon: Milk,
    isActive: (f: FiltersState) => f.dietary.dairyFree,
    toggle: { type: "TOGGLE_DIETARY" as const, payload: "dairyFree" as const },
  },
  {
    id: "few-ingredients",
    label: "5 or Less",
    icon: ListChecks,
    isActive: (f: FiltersState) => f.fewIngredients,
    toggle: { type: "TOGGLE_QUICK_FILTER" as const, payload: "fewIngredients" as const },
  },
  {
    id: "one-pot",
    label: "One-Pot",
    icon: Soup,
    isActive: (f: FiltersState) => f.onePot,
    toggle: { type: "TOGGLE_QUICK_FILTER" as const, payload: "onePot" as const },
  },
  {
    id: "budget-friendly",
    label: "Budget-Friendly",
    icon: DollarSign,
    isActive: (f: FiltersState) => f.budgetFriendly,
    toggle: { type: "TOGGLE_QUICK_FILTER" as const, payload: "budgetFriendly" as const },
  },
  {
    id: "air-fryer",
    label: "Air Fryer",
    icon: Flame,
    isActive: (f: FiltersState) => f.airFryer,
    toggle: { type: "TOGGLE_QUICK_FILTER" as const, payload: "airFryer" as const },
  },
];

export function QuickFilters({ filters, dispatch }: QuickFiltersProps) {
  return (
    <div className="flex gap-2 overflow-x-auto py-2 scrollbar-hide" data-testid="quick-filters-bar">
      {quickFilterChips.map(({ id, label, icon: Icon, isActive, toggle }) => {
        const active = isActive(filters);
        return (
          <Badge
            key={id}
            variant={active ? "default" : "outline"}
            className="cursor-pointer flex-shrink-0 gap-1.5 px-3 py-1.5"
            onClick={() => dispatch(toggle)}
            data-testid={`chip-quick-${id}`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Badge>
        );
      })}
    </div>
  );
}
