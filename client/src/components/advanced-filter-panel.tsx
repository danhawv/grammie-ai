import { Dispatch, useMemo } from "react";
import { SlidersHorizontal, X, RotateCcw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { FiltersState, FilterAction, defaultFilters, countActiveFilters } from "@/lib/filters";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";

interface AdvancedFilterPanelProps {
  filters: FiltersState;
  dispatch: Dispatch<FilterAction>;
  filterCounts?: FilterCounts | null;
}

interface FilterCounts {
  mealTypes?: Record<string, number>;
  cuisines?: Record<string, number>;
  cookingMethods?: Record<string, number>;
  skillLevels?: Record<string, number>;
  seasons?: Record<string, number>;
  timeConvenience?: Record<string, number>;
  allergens?: Record<string, number>;
  dietary?: Record<string, number>;
}

function getCount(counts: Record<string, number> | undefined, label: string): number | undefined {
  if (!counts) return undefined;
  if (counts[label] !== undefined) return counts[label];
  const lower = label.toLowerCase();
  for (const [key, val] of Object.entries(counts)) {
    if (key.toLowerCase() === lower) return val;
  }
  return undefined;
}

interface AdvancedFilterTriggerProps {
  isOpen: boolean;
  onToggle: () => void;
  activeCount: number;
  onReset: () => void;
}

export function AdvancedFilterTrigger({ isOpen, onToggle, activeCount, onReset }: AdvancedFilterTriggerProps) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        className="sm:w-auto sm:px-3 gap-2"
        onClick={onToggle}
        data-testid="button-toggle-filters"
      >
        <SlidersHorizontal className="h-4 w-4 shrink-0" />
        <span className="hidden sm:inline">Filters</span>
        {activeCount > 0 && (
          <span className="bg-primary text-primary-foreground text-xs font-medium px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
            {activeCount}
          </span>
        )}
      </Button>
      
      {activeCount > 0 && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onReset}
          className="sm:w-auto sm:px-3 gap-1.5 text-muted-foreground"
          data-testid="button-reset-all-filters"
        >
          <RotateCcw className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline">Reset</span>
        </Button>
      )}
    </div>
  );
}

interface AdvancedFilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: FiltersState;
  dispatch: Dispatch<FilterAction>;
  userId?: string;
  scope?: string;
  totalResults: number;
  onReset: () => void;
}

function serializeFiltersForCounts(f: FiltersState): Record<string, string> {
  const params: Record<string, string> = {};
  if (f.mealTypes.length > 0) params.mealTypes = f.mealTypes.join(',');
  if (f.cuisines.length > 0) params.cuisines = f.cuisines.join(',');
  if (f.cookingMethods.length > 0) params.cookingMethods = f.cookingMethods.join(',');
  if (f.skillLevels.length > 0) params.skillLevels = f.skillLevels.join(',');
  if (f.seasons.length > 0) params.seasons = f.seasons.join(',');
  if (f.excludeAllergens.length > 0) params.excludeAllergens = f.excludeAllergens.join(',');
  if (f.timeConvenience.length > 0) params.timeConvenience = f.timeConvenience.join(',');
  if (f.search) params.search = f.search;
  for (const [key, value] of Object.entries(f.dietary)) {
    if (value) params[`dietary_${key}`] = 'true';
  }
  return params;
}

export function AdvancedFilterSheet({ open, onOpenChange, filters, dispatch, userId, scope, totalResults, onReset }: AdvancedFilterSheetProps) {
  const filterParams = useMemo(() => serializeFiltersForCounts(filters), [filters]);
  const activeCount = countActiveFilters(filters);

  const { data: filterCounts } = useQuery<FilterCounts>({
    queryKey: ['/api/recipes/filter-counts', filterParams, scope],
    queryFn: async () => {
      const params = new URLSearchParams(filterParams);
      if (scope) params.set('scope', scope);
      const res = await fetch(`/api/recipes/filter-counts?${params}`);
      if (!res.ok) return {};
      return res.json();
    },
    enabled: open,
    staleTime: 10000,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col p-0 sm:max-w-md" data-testid="sheet-advanced-filters">
        <SheetHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <SheetTitle data-testid="text-sheet-title">Filters</SheetTitle>
              {activeCount > 0 && (
                <Badge variant="secondary" className="text-xs" data-testid="badge-active-filter-count">
                  {activeCount}
                </Badge>
              )}
            </div>
            {activeCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onReset}
                className="text-muted-foreground gap-1.5"
                data-testid="button-sheet-reset-filters"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </Button>
            )}
          </div>
          <SheetDescription className="sr-only">Filter recipes by meal type, time, dietary preferences, cuisine, and cooking style</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4" data-testid="sheet-filter-content">
          <MealTypeSection filters={filters} dispatch={dispatch} filterCounts={filterCounts} />

          <Accordion type="multiple" className="w-full space-y-2 mt-2">
            <TimeConvenienceSection filters={filters} dispatch={dispatch} filterCounts={filterCounts} />
            <DietaryAllergensSection filters={filters} dispatch={dispatch} filterCounts={filterCounts} />
            <CuisineSeasonSection filters={filters} dispatch={dispatch} filterCounts={filterCounts} />
            <CookingStyleSection filters={filters} dispatch={dispatch} filterCounts={filterCounts} />
          </Accordion>
        </div>

        <SheetFooter className="px-6 py-4 border-t flex-shrink-0">
          <Button
            className="w-full"
            onClick={() => onOpenChange(false)}
            data-testid="button-show-results"
          >
            Show {totalResults} {totalResults === 1 ? 'Result' : 'Results'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function MealTypeSection({ filters, dispatch, filterCounts }: AdvancedFilterPanelProps) {
  const mealCounts = filterCounts?.mealTypes;

  return (
    <div className="border rounded-lg px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="font-serif text-lg font-semibold">Meal Type</h3>
          {filters.mealTypes.length > 0 && (
            <Badge variant="secondary" className="text-xs">{filters.mealTypes.length}</Badge>
          )}
        </div>
        {filters.mealTypes.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch({ type: "RESET_SECTION", payload: "mealTypes" })}
            className="text-muted-foreground h-8"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {["Breakfast", "Lunch", "Dinner", "Snack", "Dessert", "Appetizer", "Side Dish", "Beverage", "Sauce", "Dip", "Marinade", "Rub"].map((meal) => {
          const count = getCount(mealCounts, meal);
          return (
            <Button
              key={meal}
              variant={filters.mealTypes.includes(meal) ? "default" : "outline"}
              size="sm"
              onClick={() => dispatch({ type: "TOGGLE_MEAL_TYPE", payload: meal })}
              data-testid={`button-meal-${meal.toLowerCase().replace(/\s+/g, '-')}`}
            >
              {meal}
              {count !== undefined && (
                <span className="ml-1 opacity-60">({count})</span>
              )}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function TimeConvenienceSection({ filters, dispatch, filterCounts }: AdvancedFilterPanelProps) {
  const sectionActiveCount = filters.timeConvenience.length;
  const timeCounts = filterCounts?.timeConvenience;

  const timeOptions = [
    "Under 15 mins",
    "Under 30 mins",
    "Under 1 hour",
    "2+ hours",
  ];

  return (
    <AccordionItem value="time-convenience" className="border rounded-lg px-4">
      <div className="flex items-center justify-between">
        <AccordionTrigger className="hover:no-underline flex-1" data-testid="accordion-time-convenience">
          <div className="flex items-center gap-2">
            <h3 className="font-serif text-lg font-semibold">Time</h3>
            {sectionActiveCount > 0 && (
              <Badge variant="secondary" className="text-xs">{sectionActiveCount}</Badge>
            )}
          </div>
        </AccordionTrigger>
        {sectionActiveCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              dispatch({ type: "RESET_SECTION", payload: "timeConvenience" });
            }}
            className="text-muted-foreground h-8"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <AccordionContent className="pt-4 pb-6">
        <div className="flex flex-wrap gap-2">
          {timeOptions.map((time) => {
            const count = getCount(timeCounts, time);
            return (
              <Button
                key={time}
                variant={filters.timeConvenience.includes(time) ? "default" : "outline"}
                size="sm"
                onClick={() => dispatch({ type: "TOGGLE_TIME_CONVENIENCE", payload: time })}
                data-testid={`button-time-${time.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
              >
                {time}
                {count !== undefined && (
                  <span className="ml-1 opacity-60">({count})</span>
                )}
              </Button>
            );
          })}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function DietaryAllergensSection({ filters, dispatch, filterCounts }: AdvancedFilterPanelProps) {
  const sectionActiveCount = useMemo(() => {
    let count = 0;
    Object.values(filters.dietary).forEach((v) => { if (v) count++; });
    count += filters.excludeAllergens.length;
    return count;
  }, [filters.dietary, filters.excludeAllergens]);

  const resetSection = () => {
    dispatch({ type: "RESET_SECTION", payload: "dietary" });
    dispatch({ type: "RESET_SECTION", payload: "excludeAllergens" });
  };

  const dietaryCounts = filterCounts?.dietary;

  return (
    <AccordionItem value="dietary-allergens" className="border rounded-lg px-4">
      <div className="flex items-center justify-between">
        <AccordionTrigger className="hover:no-underline flex-1" data-testid="accordion-dietary-allergens">
          <div className="flex items-center gap-2">
            <h3 className="font-serif text-lg font-semibold">Dietary & Allergens</h3>
            {sectionActiveCount > 0 && (
              <Badge variant="secondary" className="text-xs">{sectionActiveCount}</Badge>
            )}
          </div>
        </AccordionTrigger>
        {sectionActiveCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              resetSection();
            }}
            className="text-muted-foreground h-8"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <AccordionContent className="pt-4 pb-6">
        <div className="space-y-6">
          <div>
            <Label className="text-sm font-medium mb-3 block">Dietary Preferences</Label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { key: "vegetarian" as const, label: "Vegetarian" },
                { key: "vegan" as const, label: "Vegan" },
                { key: "pescatarian" as const, label: "Pescatarian" },
                { key: "glutenFree" as const, label: "Gluten-Free" },
                { key: "dairyFree" as const, label: "Dairy-Free" },
                { key: "keto" as const, label: "Keto" },
                { key: "paleo" as const, label: "Paleo" },
                { key: "lowCarb" as const, label: "Low Carb" },
                { key: "highProtein" as const, label: "High Protein" },
                { key: "lowCalorie" as const, label: "Low Calorie" },
                { key: "highFiber" as const, label: "High Fiber" },
                { key: "mediterranean" as const, label: "Mediterranean" },
              ].map(({ key, label }) => {
                const count = getCount(dietaryCounts, key);
                return (
                  <div key={key} className="flex items-center space-x-2">
                    <Checkbox
                      id={`diet-${key}`}
                      checked={filters.dietary[key]}
                      onCheckedChange={() => dispatch({ type: "TOGGLE_DIETARY", payload: key })}
                      data-testid={`checkbox-diet-${key}`}
                    />
                    <Label htmlFor={`diet-${key}`} className="text-sm font-normal cursor-pointer">
                      {label}
                      {count !== undefined && (
                        <span className="ml-1 text-muted-foreground">({count})</span>
                      )}
                    </Label>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <Label className="text-sm font-medium mb-3 block">Exclude Allergens</Label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {["Nuts", "Dairy", "Eggs", "Gluten", "Soy", "Shellfish", "Fish", "Sesame"].map((allergen) => (
                <div key={allergen} className="flex items-center space-x-2">
                  <Checkbox
                    id={`allergen-${allergen}`}
                    checked={filters.excludeAllergens.includes(allergen)}
                    onCheckedChange={() => dispatch({ type: "TOGGLE_ALLERGEN", payload: allergen })}
                    data-testid={`checkbox-allergen-${allergen.toLowerCase()}`}
                  />
                  <Label htmlFor={`allergen-${allergen}`} className="text-sm font-normal cursor-pointer">
                    {allergen}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function CuisineSeasonSection({ filters, dispatch, filterCounts }: AdvancedFilterPanelProps) {
  const sectionActiveCount = useMemo(() => {
    return filters.cuisines.length + filters.seasons.length;
  }, [filters.cuisines, filters.seasons]);

  const resetSection = () => {
    dispatch({ type: "RESET_SECTION", payload: "cuisines" });
    dispatch({ type: "RESET_SECTION", payload: "seasons" });
  };

  const cuisineOptions = [
    "Italian", "Mexican", "Asian", "Chinese", "Japanese", "Korean", "Thai", "Vietnamese",
    "Indian", "French", "Mediterranean", "Greek", "American", "Southern", "Caribbean",
    "Middle Eastern", "African", "British", "German",
  ];

  const cuisineCounts = filterCounts?.cuisines;
  const seasonCounts = filterCounts?.seasons;

  return (
    <AccordionItem value="cuisine-season" className="border rounded-lg px-4">
      <div className="flex items-center justify-between">
        <AccordionTrigger className="hover:no-underline flex-1" data-testid="accordion-meal-cuisine">
          <div className="flex items-center gap-2">
            <h3 className="font-serif text-lg font-semibold">Cuisine & Season</h3>
            {sectionActiveCount > 0 && (
              <Badge variant="secondary" className="text-xs">{sectionActiveCount}</Badge>
            )}
          </div>
        </AccordionTrigger>
        {sectionActiveCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              resetSection();
            }}
            className="text-muted-foreground h-8"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <AccordionContent className="pt-4 pb-6">
        <div className="space-y-6">
          <div>
            <Label className="text-sm font-medium mb-3 block">Cuisine</Label>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {cuisineOptions.map((cuisine) => {
                const count = getCount(cuisineCounts, cuisine);
                return (
                  <div key={cuisine} className="flex items-center space-x-2">
                    <Checkbox
                      id={`cuisine-${cuisine}`}
                      checked={filters.cuisines.includes(cuisine)}
                      onCheckedChange={() => dispatch({ type: "TOGGLE_CUISINE", payload: cuisine })}
                      data-testid={`checkbox-cuisine-${cuisine.toLowerCase().replace(/\s+/g, '-')}`}
                    />
                    <Label htmlFor={`cuisine-${cuisine}`} className="text-sm font-normal cursor-pointer">
                      {cuisine}
                      {count !== undefined && (
                        <span className="ml-1 text-muted-foreground">({count})</span>
                      )}
                    </Label>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <Label className="text-sm font-medium mb-3 block">Season</Label>
            <div className="flex flex-wrap gap-2">
              {["Spring", "Summer", "Fall", "Winter"].map((season) => {
                const count = getCount(seasonCounts, season);
                return (
                  <Button
                    key={season}
                    variant={filters.seasons.includes(season) ? "default" : "outline"}
                    size="sm"
                    onClick={() => dispatch({ type: "TOGGLE_SEASON", payload: season })}
                    data-testid={`button-season-${season.toLowerCase()}`}
                  >
                    {season}
                    {count !== undefined && (
                      <span className="ml-1 opacity-60">({count})</span>
                    )}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function CookingStyleSection({ filters, dispatch, filterCounts }: AdvancedFilterPanelProps) {
  const sectionActiveCount = useMemo(() => {
    return filters.cookingMethods.length + filters.skillLevels.length;
  }, [filters.cookingMethods, filters.skillLevels]);

  const resetSection = () => {
    dispatch({ type: "RESET_SECTION", payload: "cookingMethods" });
    dispatch({ type: "RESET_SECTION", payload: "skillLevels" });
  };

  const methodCounts = filterCounts?.cookingMethods;
  const skillCounts = filterCounts?.skillLevels;

  return (
    <AccordionItem value="cooking-style" className="border rounded-lg px-4">
      <div className="flex items-center justify-between">
        <AccordionTrigger className="hover:no-underline flex-1" data-testid="accordion-cooking-style">
          <div className="flex items-center gap-2">
            <h3 className="font-serif text-lg font-semibold">Cooking Style</h3>
            {sectionActiveCount > 0 && (
              <Badge variant="secondary" className="text-xs">{sectionActiveCount}</Badge>
            )}
          </div>
        </AccordionTrigger>
        {sectionActiveCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              resetSection();
            }}
            className="text-muted-foreground h-8"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <AccordionContent className="pt-4 pb-6">
        <div className="space-y-6">
          <div>
            <Label className="text-sm font-medium mb-3 block">Cooking Method</Label>
            <div className="flex flex-wrap gap-2">
              {["Baking", "Grilling", "Frying", "Roasting", "Saut\u00e9ing", "Steaming", "Slow Cooking", "No-Cook"].map((method) => {
                const count = getCount(methodCounts, method);
                return (
                  <Button
                    key={method}
                    variant={filters.cookingMethods.includes(method) ? "default" : "outline"}
                    size="sm"
                    onClick={() => dispatch({ type: "TOGGLE_COOKING_METHOD", payload: method })}
                    data-testid={`button-method-${method.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                  >
                    {method}
                    {count !== undefined && (
                      <span className="ml-1 opacity-60">({count})</span>
                    )}
                  </Button>
                );
              })}
            </div>
          </div>

          <div>
            <Label className="text-sm font-medium mb-3 block">Skill Level</Label>
            <div className="flex flex-wrap gap-2">
              {["Beginner", "Intermediate", "Advanced"].map((level) => {
                const count = getCount(skillCounts, level);
                return (
                  <Button
                    key={level}
                    variant={filters.skillLevels.includes(level) ? "default" : "outline"}
                    size="sm"
                    onClick={() => dispatch({ type: "TOGGLE_SKILL_LEVEL", payload: level })}
                    data-testid={`button-skill-${level.toLowerCase()}`}
                  >
                    {level}
                    {count !== undefined && (
                      <span className="ml-1 opacity-60">({count})</span>
                    )}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
