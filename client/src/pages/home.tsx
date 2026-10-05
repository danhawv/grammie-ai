import { useState, useMemo, useReducer, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";
import { PaginatedRecipes, RecipeCardData } from "@shared/schema";
import { pluralize } from "@shared/format";
import {
  Search, Camera, Link2, Type, X, BookOpen, ShoppingCart, Trash2, Heart, HeartOff, Share2,
  ArrowUpDown, SlidersHorizontal, MoreHorizontal, CheckSquare, Copy as CopyIcon, SearchX, UserRound, Loader2,
} from "lucide-react";
import { DuplicateRecipesDialog } from "@/components/duplicate-recipes-dialog";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAddRecipe } from "@/contexts/AddRecipeContext";
import { AdvancedFilterSheet } from "@/components/advanced-filter-panel";
import { QuickFilters } from "@/components/quick-filters";
import { CookbookSelect } from "@/components/cookbook-select";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/page-states";
import {
  RecipeCard,
  RecipeCardSkeleton,
  RECIPE_GRID_CLASS,
  contributorName,
  type RecipeCardAction,
} from "@/components/recipe-card";
import { filtersReducer, defaultFilters, countActiveFilters, type FiltersState } from "@/lib/filters";
import { loadHomeState, saveHomeState, restoreFilters } from "@/lib/list-state";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useUndoable } from "@/hooks/use-undoable";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type CollectionFilter = "all" | "yours" | "public" | "shared" | "bookmarked";

const COLLECTIONS: { value: CollectionFilter; label: string; chip: string }[] = [
  { value: "all", label: "All recipes", chip: "All recipes" },
  { value: "yours", label: "My recipes", chip: "My recipes" },
  { value: "shared", label: "Shared with me", chip: "Shared with me" },
  { value: "bookmarked", label: "Favorites", chip: "Favorites" },
  { value: "public", label: "Public recipes", chip: "Public only" },
];

const sortOptions = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "a-z", label: "A to Z" },
  { value: "z-a", label: "Z to A" },
  { value: "quickest", label: "Quickest" },
  { value: "longest", label: "Longest" },
];

const DIETARY_LABELS: Record<string, string> = {
  vegetarian: "Vegetarian", vegan: "Vegan", pescatarian: "Pescatarian",
  glutenFree: "Gluten-free", dairyFree: "Dairy-free", keto: "Keto",
  paleo: "Paleo", lowCarb: "Low carb", highProtein: "High protein",
  lowCalorie: "Low calorie", highFiber: "High fiber", mediterranean: "Mediterranean",
};

const HANDY_FILTERS = [
  { key: "fewIngredients", label: "5 or fewer ingredients" },
  { key: "onePot", label: "One-pot" },
  { key: "budgetFriendly", label: "Budget-friendly" },
  { key: "airFryer", label: "Air fryer" },
] as const;

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message.replace(/^\d{3}:\s*/, "");
  return fallback;
}

function serializeFiltersToParams(f: FiltersState): Record<string, string> {
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

function SortMenu({ sortBy, onSortChange }: { sortBy: string; onSortChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const currentLabel = sortOptions.find((o) => o.value === sortBy)?.label || "Newest first";
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
          {sortOptions.map(({ value, label }) => (
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

/** A filter section inside the Filters sheet, styled like the sheet's own */
function SheetSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-2 rounded-lg border px-4 py-4">
      <h3 className="mb-3 font-serif text-lg font-semibold">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function ToggleButton({ pressed, onClick, children, testId }: { pressed: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <Button variant={pressed ? "default" : "outline"} aria-pressed={pressed} onClick={onClick} className="h-auto max-w-full whitespace-normal text-left" data-testid={testId}>
      {children}
    </Button>
  );
}

export default function Home() {
  const [location] = useLocation();
  return <RecipesHome />;
}

function RecipesHome() {
  // Browsing state survives clicking into a recipe and coming back
  const savedState = useRef(loadHomeState()).current;
  const [filters, dispatch] = useReducer(filtersReducer, defaultFilters, () => restoreFilters(savedState.filters));
  const { openAddRecipe } = useAddRecipe();
  const { user } = useAuth();
  const { toast } = useToast();
  const undoable = useUndoable();

  const [collectionFilter, setCollectionFilter] = useState<CollectionFilter>(
    (savedState.collectionFilter as CollectionFilter) || (user ? "all" : "public"),
  );
  const [selectedCookbookIds, setSelectedCookbookIds] = useState<number[]>(savedState.selectedCookbookIds || []);
  const [selectedCreatorId, setSelectedCreatorId] = useState<string | undefined>(savedState.selectedCreatorId);
  const [sortBy, setSortBy] = useState<string>(savedState.sortBy || "newest");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedRecipeIds, setSelectedRecipeIds] = useState<Set<string>>(new Set());
  const [bulkAddDialogOpen, setBulkAddDialogOpen] = useState(false);
  const [bulkCookbookId, setBulkCookbookId] = useState<string | undefined>();
  // Recipes deleted in this session but still inside their Undo window
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [creatorLabel, setCreatorLabel] = useState<string | null>(null);

  useEffect(() => {
    saveHomeState({
      filters,
      sortBy,
      collectionFilter,
      viewMode: "recipes",
      selectedCookbookIds,
      selectedCreatorId,
    });
  }, [filters, sortBy, collectionFilter, selectedCookbookIds, selectedCreatorId]);

  // Signing in or out changes which collections make sense
  const prevUserRef = useRef<typeof user | undefined>(undefined);
  useEffect(() => {
    const hadUser = !!prevUserRef.current;
    const hasUser = !!user;
    if (!hadUser && hasUser && collectionFilter === "public") setCollectionFilter("all");
    if (hadUser && !hasUser && collectionFilter !== "public" && collectionFilter !== "all") setCollectionFilter("public");
    prevUserRef.current = user;
  }, [user, collectionFilter]);

  const defaultCollection: CollectionFilter = user ? "all" : "public";

  // ---- Data -------------------------------------------------------------

  const queryKey = useMemo(() => {
    const baseParams: Record<string, string> = serializeFiltersToParams(filters);
    if (sortBy !== "newest") baseParams.sortBy = sortBy;
    if (selectedCreatorId) return ["/api/recipes", { ...baseParams, creatorId: selectedCreatorId }];
    if (selectedCookbookIds.length > 0) return ["/api/recipes", { ...baseParams, cookbookIds: selectedCookbookIds.join(",") }];
    switch (collectionFilter) {
      case "yours":
        return ["/api/recipes", { ...baseParams, scope: "my" }];
      case "public":
        return ["/api/recipes", { ...baseParams, scope: "public" }];
      case "shared":
        return ["/api/recipes", { ...baseParams, scope: "shared" }];
      case "bookmarked":
        return ["/api/bookmarks/recipes", baseParams];
      default:
        return user ? ["/api/recipes", baseParams] : ["/api/recipes", { ...baseParams, scope: "public" }];
    }
  }, [filters, sortBy, selectedCreatorId, selectedCookbookIds, collectionFilter, user]);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useInfiniteQuery<PaginatedRecipes>({
    queryKey,
    queryFn: async ({ pageParam = 1, queryKey }) => {
      const path = queryKey[0] as string;
      const params = (queryKey[1] as Record<string, string>) || {};
      if (path === "/api/bookmarks/recipes") {
        const response = await fetch(path, { credentials: "include" });
        if (!response.ok) throw new Error("We couldn't load your favorites.");
        const recipes = await response.json();
        return { recipes, total: recipes.length, page: 1, limit: recipes.length, hasMore: false };
      }
      const queryParams = new URLSearchParams({ ...params, page: String(pageParam), limit: "24" });
      const response = await fetch(`${path}?${queryParams}`, { credentials: "include" });
      if (!response.ok) throw new Error("We couldn't load your recipes.");
      return response.json();
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => (lastPage.hasMore ? pages.length + 1 : undefined),
    refetchInterval: (query) => {
      const pages = query.state.data?.pages;
      if (!pages) return false;
      const processing = pages.some((page) =>
        page.recipes.some(
          (r) =>
            r.enrichmentStatus === "enriching" ||
            r.enrichmentStatus === "extracting" ||
            r.imageGenerationStatus === "pending" ||
            r.imageGenerationStatus === "generating",
        ),
      );
      return processing ? 3000 : false;
    },
    // Keep showing the previous results while new filters load
    placeholderData: (previousData) => previousData,
  });

  // How many recipes the user has saved themselves (drives first run). The
  // "all" list also includes public recipes, so it can't answer this.
  const { data: myRecipes } = useQuery<PaginatedRecipes>({
    queryKey: ["/api/recipes", { scope: "my", limit: "1" }],
    enabled: !!user,
  });
  const isFirstRun = !!user && myRecipes?.total === 0;

  const { data: preferences } = useQuery<{ quickFilters?: { enabled?: string[]; showQuickFilters?: boolean } }>({
    queryKey: ["/api/user/preferences"],
    enabled: !!user,
  });
  const showQuickFilters = preferences?.quickFilters?.showQuickFilters === true;

  const { data: cookbooks = [] } = useQuery<Array<{ id: number; name: string; recipeCount?: number }>>({
    queryKey: ["/api/cookbooks"],
    enabled: !!user,
  });

  const { data: bookmarkedIds = [] } = useQuery<string[]>({
    queryKey: ["/api/bookmarks"],
    enabled: !!user,
  });
  const bookmarkedIdsSet = useMemo(() => new Set(bookmarkedIds), [bookmarkedIds]);

  const recipes = useMemo(
    () => (data?.pages.flatMap((page) => page.recipes) || []).filter((r) => !hiddenIds.has(r.id)),
    [data, hiddenIds],
  );
  const totalResults = Math.max(0, (data?.pages[0]?.total ?? 0) - hiddenIds.size);

  // Remember who a "From …" filter is for, so the chip can say their name
  useEffect(() => {
    if (selectedCreatorId && recipes[0]?.owner?.id === selectedCreatorId) {
      setCreatorLabel(contributorName(recipes[0].owner));
    }
  }, [selectedCreatorId, recipes]);

  // ---- Applied filters --------------------------------------------------

  const chips = useMemo(() => {
    const list: { key: string; label: string; onRemove: () => void }[] = [];
    if (collectionFilter !== defaultCollection) {
      const c = COLLECTIONS.find((x) => x.value === collectionFilter);
      list.push({ key: "collection", label: c?.chip || collectionFilter, onRemove: () => setCollectionFilter(defaultCollection) });
    }
    selectedCookbookIds.forEach((id) =>
      list.push({
        key: `cookbook-${id}`,
        label: cookbooks.find((c) => c.id === id)?.name.trim() || "Cookbook",
        onRemove: () => setSelectedCookbookIds((ids) => ids.filter((x) => x !== id)),
      }),
    );
    if (selectedCreatorId) {
      list.push({ key: "creator", label: `From ${creatorLabel || "one cook"}`, onRemove: () => setSelectedCreatorId(undefined) });
    }
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
  }, [filters, collectionFilter, defaultCollection, selectedCookbookIds, cookbooks, selectedCreatorId, creatorLabel]);

  const appliedCount = chips.length; // search is shown in the search box, not counted
  const isFiltering = appliedCount > 0 || !!filters.search;

  // Removes every filter; the search box has its own clear
  const clearAll = () => {
    const search = filters.search;
    dispatch({ type: "RESET_ALL" });
    if (search) dispatch({ type: "SET_SEARCH", payload: search });
    setCollectionFilter(defaultCollection);
    setSelectedCookbookIds([]);
    setSelectedCreatorId(undefined);
  };

  const chooseCollection = (value: CollectionFilter) => {
    setCollectionFilter(value);
    setSelectedCookbookIds([]);
    setSelectedCreatorId(undefined);
  };

  const toggleCookbook = (id: number) => {
    setSelectedCookbookIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    setCollectionFilter(defaultCollection);
    setSelectedCreatorId(undefined);
  };

  const filterByCreator = (recipe: RecipeCardData) => {
    if (!recipe.owner) return;
    setSelectedCreatorId(recipe.owner.id);
    setCreatorLabel(contributorName(recipe.owner));
    setSelectedCookbookIds([]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ---- Actions ----------------------------------------------------------

  const invalidateRecipes = () =>
    queryClient.invalidateQueries({
      predicate: (q) => {
        const key = q.queryKey[0];
        return typeof key === "string" && (key === "/api/recipes" || key.startsWith("/api/cookbooks") || key === "/api/bookmarks/recipes");
      },
    });

  const deleteRecipes = useCallback(
    (ids: string[], label: string) => {
      undoable({
        message: label,
        hide: () => setHiddenIds((prev) => new Set([...Array.from(prev), ...ids])),
        restore: () =>
          setHiddenIds((prev) => {
            const next = new Set(prev);
            ids.forEach((id) => next.delete(id));
            return next;
          }),
        commit: async () => {
          if (ids.length === 1) await apiRequest("DELETE", `/api/recipes/${ids[0]}`);
          else await apiRequest("DELETE", "/api/recipes/bulk", { recipeIds: ids });
          await invalidateRecipes();
          setHiddenIds((prev) => {
            const next = new Set(prev);
            ids.forEach((id) => next.delete(id));
            return next;
          });
        },
      });
    },
    [undoable],
  );

  const bulkAddToCookbookMutation = useMutation({
    mutationFn: async ({ cookbookId, recipeIds }: { cookbookId: number; recipeIds: string[] }) =>
      apiRequest("POST", "/api/recipes/bulk/add-to-cookbook", { cookbookId, recipeIds }),
    onSuccess: (_d, { recipeIds, cookbookId }) => {
      invalidateRecipes();
      const name = cookbooks.find((c) => c.id === cookbookId)?.name || "the cookbook";
      toast({ title: `Added ${pluralize(recipeIds.length, "recipe")} to ${name}` });
      exitSelectMode();
      setBulkAddDialogOpen(false);
      setBulkCookbookId(undefined);
    },
  });

  const addToGroceryListMutation = useMutation({
    mutationFn: async (recipeIds: string[]) => apiRequest("POST", "/api/grocery-list/recipes/bulk", { recipeIds }),
    onSuccess: (_d, recipeIds) => {
      queryClient.invalidateQueries({ queryKey: ["/api/grocery-list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/grocery-list/by-aisle"] });
      toast({ title: `Added ${pluralize(recipeIds.length, "recipe")} to your grocery list` });
      if (selectMode) exitSelectMode();
    },
    onError: (err) => {
      toast({
        title: "Couldn't add to your grocery list",
        description: errorMessage(err, "Check your connection and try again."),
        variant: "destructive",
      });
    },
  });

  const bookmarkMutation = useMutation({
    mutationFn: async ({ recipeId, isBookmarked }: { recipeId: string; isBookmarked: boolean }) => {
      await apiRequest(isBookmarked ? "DELETE" : "POST", `/api/bookmarks/${recipeId}`);
    },
    onMutate: async ({ recipeId, isBookmarked }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/bookmarks"] });
      const previous = queryClient.getQueryData<string[]>(["/api/bookmarks"]);
      queryClient.setQueryData<string[]>(["/api/bookmarks"], (old = []) =>
        isBookmarked ? old.filter((id) => id !== recipeId) : [...old, recipeId],
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["/api/bookmarks"], ctx.previous);
      toast({ title: "Couldn't update favorites. Try again.", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bookmarks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookmarks/recipes"] });
    },
  });

  const handleShare = async (recipe: RecipeCardData) => {
    const url = `${window.location.origin}/recipe/${recipe.id}`;
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: recipe.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: "Paste it in a message to share this recipe." });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return; // closed the share sheet
      toast({ title: "Couldn't copy the link", variant: "destructive" });
    }
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedRecipeIds(new Set());
  };

  const toggleSelected = (id: string, selected: boolean) =>
    setSelectedRecipeIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });

  const actionsFor = (recipe: RecipeCardData): RecipeCardAction[] => {
    const actions: RecipeCardAction[] = [];
    const isOwn = !!user && recipe.owner?.id === user.id;
    if (user) {
      const fav = bookmarkedIdsSet.has(recipe.id);
      actions.push({
        label: fav ? "Remove from favorites" : "Add to favorites",
        icon: fav ? HeartOff : Heart,
        onSelect: () => bookmarkMutation.mutate({ recipeId: recipe.id, isBookmarked: fav }),
        testId: `button-bookmark-${recipe.id}`,
      });
    }
    actions.push({ label: "Share", icon: Share2, onSelect: () => handleShare(recipe), testId: `button-share-${recipe.id}` });
    if (user) {
      actions.push({
        label: "Add to grocery list",
        icon: ShoppingCart,
        onSelect: () => addToGroceryListMutation.mutate([recipe.id]),
      });
    }
    if (recipe.owner && !isOwn && recipe.owner.id !== selectedCreatorId) {
      actions.push({
        label: `More from ${contributorName(recipe.owner) || "this cook"}`,
        icon: UserRound,
        onSelect: () => filterByCreator(recipe),
      });
    }
    if (isOwn) {
      actions.push({
        label: "Delete",
        icon: Trash2,
        destructive: true,
        separated: true,
        onSelect: () => deleteRecipes([recipe.id], `Deleted "${recipe.title}"`),
        testId: `menu-item-delete-${recipe.id}`,
      });
    }
    return actions;
  };

  const selectedIds = Array.from(selectedRecipeIds);

  // ---- Render -----------------------------------------------------------

  const firstRunPanel = (
    <EmptyState
      icon={Camera}
      title="Add your first family recipe"
      description={
        <>
          Take a photo of a recipe card, a cookbook page or a handwritten note. Grammie reads handwriting, cookbook
          pages and recipe posts, and you'll check everything before it's saved.
        </>
      }
      className="mb-8 border-solid bg-card"
      action={
        <Button size="lg" className="w-full sm:w-auto" onClick={() => openAddRecipe("image")} data-testid="button-snap-first-recipe">
          <Camera aria-hidden /> Snap a recipe card
        </Button>
      }
      secondaryAction={
        <div className="flex w-full flex-wrap justify-center gap-3 sm:w-auto">
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => openAddRecipe("link")} data-testid="button-first-recipe-link">
            <Link2 aria-hidden /> Paste a link
          </Button>
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => openAddRecipe("text")} data-testid="button-first-recipe-text">
            <Type aria-hidden /> Type it in
          </Button>
        </div>
      }
    />
  );

  const filtersSheetSections = (
    <>
      {user && (
        <SheetSection title="Show">
          {COLLECTIONS.filter((c) => c.value !== "public").map((c) => (
            <ToggleButton
              key={c.value}
              pressed={collectionFilter === c.value && selectedCookbookIds.length === 0 && !selectedCreatorId}
              onClick={() => chooseCollection(c.value)}
              testId={`button-collection-${c.value}`}
            >
              {c.label}
            </ToggleButton>
          ))}
        </SheetSection>
      )}
      {user && cookbooks.length > 0 && (
        <SheetSection title="Cookbook">
          {cookbooks.map((c) => (
            <ToggleButton key={c.id} pressed={selectedCookbookIds.includes(c.id)} onClick={() => toggleCookbook(c.id)} testId={`button-filter-cookbook-${c.id}`}>
              <BookOpen aria-hidden /> {c.name}
            </ToggleButton>
          ))}
        </SheetSection>
      )}
      <SheetSection title="Handy">
        {HANDY_FILTERS.map(({ key, label }) => (
          <ToggleButton key={key} pressed={filters[key]} onClick={() => dispatch({ type: "TOGGLE_QUICK_FILTER", payload: key })}>
            {label}
          </ToggleButton>
        ))}
      </SheetSection>
    </>
  );

  const showBrowse = !isFirstRun || totalResults > 0 || isFiltering;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-20 pt-6 md:px-6 md:pb-10">
      {isFirstRun ? (
        <>
          <h1 className="sr-only">Recipes</h1>
          {firstRunPanel}
          {showBrowse && totalResults > 0 && (
            <h2 className="mb-3 font-serif text-2xl font-bold">Recipes shared with you</h2>
          )}
        </>
      ) : (
        <PageHeader
          className="mb-4"
          title="Recipes"
          description={
            isLoading ? <span className="invisible">Loading</span> : isFiltering ? `${pluralize(totalResults, "recipe")} found` : pluralize(totalResults, "recipe")
          }
        />
      )}

      {showBrowse && (
        <>
          {/* Search, Filters, Sort, … — or the select-mode bar */}
          <div className="sticky top-16 z-30 -mx-4 space-y-3 border-b bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
            {selectMode ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center" data-testid="toolbar-bulk-actions">
                <div className="flex items-center gap-2 sm:mr-auto">
                  <p className="mr-auto text-sm font-medium" data-testid="text-selected-count" aria-live="polite">
                    {selectedIds.length === 0 ? "Tap your recipes to select them" : `${pluralize(selectedIds.length, "recipe")} selected`}
                  </p>
                  <Button className="sm:order-last" onClick={exitSelectMode} data-testid="button-clear-selection">
                    Done
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:flex">
                  <Button
                    variant="outline"
                    className="px-2 sm:px-4"
                    onClick={() => setBulkAddDialogOpen(true)}
                    disabled={selectedIds.length === 0}
                    data-testid="button-bulk-add-cookbook"
                  >
                    <BookOpen aria-hidden /> <span className="sm:hidden">Cookbook</span>
                    <span className="hidden sm:inline">Add to cookbook</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="px-2 sm:px-4"
                    onClick={() => addToGroceryListMutation.mutate(selectedIds)}
                    disabled={selectedIds.length === 0 || addToGroceryListMutation.isPending}
                    data-testid="button-bulk-add-grocery"
                  >
                    <ShoppingCart aria-hidden /> <span className="sm:hidden">Groceries</span>
                    <span className="hidden sm:inline">{addToGroceryListMutation.isPending ? "Adding…" : "Add to grocery list"}</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="px-2 text-destructive sm:px-4"
                    onClick={() => {
                      deleteRecipes(selectedIds, `Deleted ${pluralize(selectedIds.length, "recipe")}`);
                      exitSelectMode();
                    }}
                    disabled={selectedIds.length === 0}
                    data-testid="button-bulk-delete"
                  >
                    <Trash2 aria-hidden /> Delete
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="relative">
                  <label htmlFor="recipe-search" className="sr-only">
                    Search recipes
                  </label>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    id="recipe-search"
                    type="search"
                    placeholder="Search recipes, ingredients, or who it's from"
                    value={filters.search}
                    onChange={(e) => dispatch({ type: "SET_SEARCH", payload: e.target.value })}
                    className="h-12 pl-10 text-sm"
                    enterKeyHint="search"
                    data-testid="input-search"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="gap-2 px-3"
                    onClick={() => setFiltersOpen(true)}
                    aria-label={appliedCount ? `Filters, ${appliedCount} applied` : "Filters"}
                    data-testid="button-toggle-filters"
                  >
                    <SlidersHorizontal aria-hidden />
                    Filters
                    {appliedCount > 0 && (
                      <span className="min-w-6 rounded-full bg-primary px-1.5 text-center text-xs font-semibold text-primary-foreground" aria-hidden>
                        {appliedCount}
                      </span>
                    )}
                  </Button>
                  <SortMenu sortBy={sortBy} onSortChange={setSortBy} />
                  {user && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" className="ml-auto" aria-label="More options" title="More options" data-testid="button-recipes-more">
                          <MoreHorizontal className="!h-5 !w-5" aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[14rem]">
                        <DropdownMenuItem className="min-h-11" onSelect={() => setSelectMode(true)} data-testid="menu-select-recipes">
                          <CheckSquare aria-hidden /> Select recipes
                        </DropdownMenuItem>
                        <DropdownMenuItem className="min-h-11" onSelect={() => setDuplicatesOpen(true)} data-testid="button-find-duplicates">
                          <CopyIcon aria-hidden /> Find duplicates
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </>
            )}
          </div>

          {!selectMode && showQuickFilters && (
            <QuickFilters filters={filters} dispatch={dispatch} enabledIds={preferences?.quickFilters?.enabled} />
          )}

          {/* Applied filters, each removable */}
          {!selectMode && chips.length > 0 && (
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
                <Button variant="ghost" onClick={clearAll} data-testid="button-clear-all-chips">
                  Clear all
                </Button>
              )}
            </div>
          )}

          <div className="mt-4">
            {isLoading ? (
              <div className={RECIPE_GRID_CLASS} role="status" aria-label="Loading recipes">
                {Array.from({ length: 8 }).map((_, i) => (
                  <RecipeCardSkeleton key={i} />
                ))}
              </div>
            ) : isError && recipes.length === 0 ? (
              <ErrorState
                title="We couldn't load your recipes"
                description={`${errorMessage(error, "Something went wrong.")} Check your connection and try again.`}
                onRetry={() => refetch()}
              />
            ) : recipes.length > 0 ? (
              <>
                <div className={RECIPE_GRID_CLASS}>
                  {recipes.map((recipe) => {
                    const canSelect = selectMode && !!user && recipe.owner?.id === user.id;
                    return (
                      <RecipeCard
                        key={recipe.id}
                        recipe={recipe}
                        viewerId={user?.id}
                        actions={selectMode ? [] : actionsFor(recipe)}
                        selectable={canSelect}
                        selected={selectedRecipeIds.has(recipe.id)}
                        onSelectedChange={(sel) => toggleSelected(recipe.id, sel)}
                        className={cn(selectMode && !canSelect && "opacity-50")}
                      />
                    );
                  })}
                </div>
                {hasNextPage && (
                  <div className="mt-10 flex flex-col items-center gap-3">
                    {isFetchNextPageError && (
                      <p role="alert" className="text-sm text-destructive">
                        We couldn't load more recipes. Check your connection and try again.
                      </p>
                    )}
                    <Button size="lg" variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage} data-testid="button-load-more">
                      {isFetchingNextPage ? (
                        <>
                          <Loader2 className="motion-safe:animate-spin" aria-hidden /> Loading more…
                        </>
                      ) : isFetchNextPageError ? (
                        "Try again"
                      ) : (
                        "Show more recipes"
                      )}
                    </Button>
                  </div>
                )}
              </>
            ) : isFiltering ? (
              <EmptyState
                icon={SearchX}
                title={collectionFilter === "bookmarked" && chips.length === 1 && !filters.search ? "No favorites yet" : "No recipes match"}
                description={
                  collectionFilter === "bookmarked" && chips.length === 1 && !filters.search
                    ? "Tap the … on any recipe and choose Add to favorites."
                    : filters.search
                      ? `Nothing matches "${filters.search}"${chips.length ? " with these filters" : ""}. Try fewer words, or remove a filter.`
                      : "Try removing a filter to see more recipes."
                }
                action={
                  chips.length > 0 ? (
                    <Button
                      className="h-auto whitespace-normal"
                      onClick={chips.length === 1 ? chips[0].onRemove : clearAll}
                      data-testid="button-empty-clear-filters"
                    >
                      {chips.length === 1 ? `Remove "${chips[0].label}"` : "Remove all filters"}
                    </Button>
                  ) : undefined
                }
                secondaryAction={
                  filters.search ? (
                    <Button variant="outline" onClick={() => dispatch({ type: "SET_SEARCH", payload: "" })} data-testid="button-empty-clear-search">
                      Clear search
                    </Button>
                  ) : undefined
                }
              />
            ) : !user ? (
              <EmptyState
                icon={BookOpen}
                title="No public recipes yet"
                description="Sign in to save your family's recipes."
                action={
                  <Button asChild>
                    <a href="/login">Sign in</a>
                  </Button>
                }
              />
            ) : null}
          </div>
        </>
      )}

      <AdvancedFilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        filters={filters}
        dispatch={dispatch}
        userId={user?.id}
        scope={collectionFilter === "yours" ? "my" : collectionFilter === "public" ? "public" : collectionFilter === "shared" ? "shared" : undefined}
        totalResults={totalResults}
        onReset={clearAll}
        leadingSections={filtersSheetSections}
        activeCountOverride={appliedCount}
      />

      <Dialog
        open={bulkAddDialogOpen}
        onOpenChange={(open) => {
          setBulkAddDialogOpen(open);
          if (open) setBulkCookbookId(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to a cookbook</DialogTitle>
            <DialogDescription>Choose the cookbook for {pluralize(selectedIds.length, "recipe")}.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <CookbookSelect value={bulkCookbookId} onValueChange={setBulkCookbookId} placeholder="Choose a cookbook" allowNone={false} />
            {bulkAddToCookbookMutation.isError && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {errorMessage(bulkAddToCookbookMutation.error, "We couldn't add them.")} Try again.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkAddDialogOpen(false)} disabled={bulkAddToCookbookMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                bulkCookbookId &&
                bulkAddToCookbookMutation.mutate({ cookbookId: parseInt(bulkCookbookId), recipeIds: selectedIds })
              }
              disabled={!bulkCookbookId || bulkAddToCookbookMutation.isPending}
            >
              {bulkAddToCookbookMutation.isPending ? "Adding…" : `Add ${pluralize(selectedIds.length, "recipe")}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DuplicateRecipesDialog open={duplicatesOpen} onClose={() => setDuplicatesOpen(false)} />
    </div>
  );
}
