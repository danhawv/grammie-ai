import { useState, useMemo, useReducer, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";
import { RecipeCardData, PaginatedRecipes } from "@shared/schema";
import { 
  Search, Upload, Clock, Users, ChefHat, Loader2, AlertTriangle, Trash2, BookOpen, X, 
  LayoutGrid, Folder, Share2, Bookmark, BookmarkCheck, MoreVertical, Heart, HeartOff, Eye, Globe, ShoppingCart, Printer,
  ArrowUpDown, ArrowUpAZ, ArrowDownAZ, CalendarArrowUp, CalendarArrowDown
} from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { LiquidGlassToolbar } from "@/components/liquid-glass-toolbar";
import { MobileFAB } from "@/components/mobile-fab";
import { UploadRecipeModal } from "@/components/upload-recipe-modal";
import { AdvancedFilterTrigger, AdvancedFilterSheet } from "@/components/advanced-filter-panel";
import { QuickFilters } from "@/components/quick-filters";
import { CookbookSelect } from "@/components/cookbook-select";
import { CookbookMultiSelect } from "@/components/cookbook-multi-select";
import { QuickLinkImport } from "@/components/quick-link-import";
import { filtersReducer, defaultFilters, countActiveFilters, type FiltersState } from "@/lib/filters";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import heroImage from "@assets/generated_images/Recipe_app_hero_banner_95a212be.png";
import grammieImage from "@assets/image_1763329917086.png";

const isPlaceholderImage = (imageUrl?: string | null): boolean => {
  return !!imageUrl && imageUrl.startsWith("data:image/svg");
};

const formatTime = (minutes?: number | null): string => {
  if (minutes == null) return "N/A";
  
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  
  if (hours > 0 && mins > 0) {
    return `${hours} hr ${mins} mins`;
  } else if (hours > 0) {
    return `${hours} hr`;
  } else {
    return `${mins} mins`;
  }
};

const parsePrepTime = (timeStr?: string | null): number => {
  if (!timeStr) return 0;
  
  let totalMinutes = 0;
  
  // Match hours (e.g., "1 hour", "2 hours", "1hr", "2hrs")
  const hourMatch = timeStr.match(/(\d+)\s*(hour|hours|hr|hrs)/i);
  if (hourMatch) {
    totalMinutes += parseInt(hourMatch[1]) * 60;
  }
  
  // Match minutes (e.g., "30 minutes", "45 mins", "30min")
  const minuteMatch = timeStr.match(/(\d+)\s*(minute|minutes|min|mins)/i);
  if (minuteMatch) {
    totalMinutes += parseInt(minuteMatch[1]);
  }
  
  // If no match found, try to extract just a number (fallback)
  if (totalMinutes === 0) {
    const numMatch = timeStr.match(/(\d+)/);
    if (numMatch) {
      totalMinutes = parseInt(numMatch[1]);
    }
  }
  
  return totalMinutes;
};

type CollectionFilter = 'all' | 'yours' | 'public' | 'shared' | 'bookmarked';
type ViewMode = 'recipes' | 'cookbooks';
type CookbookViewMode = 'mine' | 'following' | 'public';

const sortOptions = [
  { value: "newest", label: "Newest First", icon: CalendarArrowDown },
  { value: "oldest", label: "Oldest First", icon: CalendarArrowUp },
  { value: "a-z", label: "A - Z", icon: ArrowUpAZ },
  { value: "z-a", label: "Z - A", icon: ArrowDownAZ },
  { value: "quickest", label: "Quickest", icon: Clock },
  { value: "longest", label: "Longest", icon: Clock },
];

function SortPopover({ sortBy, onSortChange }: { sortBy: string; onSortChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const currentLabel = sortOptions.find(o => o.value === sortBy)?.label || "Sort by";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="sm:w-auto sm:px-3 gap-2" data-testid="button-sort">
          <ArrowUpDown className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline">{currentLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-2">
        <RadioGroup value={sortBy} onValueChange={(val) => { onSortChange(val); setOpen(false); }}>
          {sortOptions.map(({ value, label, icon: Icon }) => (
            <label
              key={value}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover-elevate"
              data-testid={`sort-${value}`}
            >
              <RadioGroupItem value={value} data-testid={`radio-sort-${value}`} />
              <Icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </RadioGroup>
      </PopoverContent>
    </Popover>
  );
}

export default function Home() {
  const [filters, dispatch] = useReducer(filtersReducer, defaultFilters);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadInitialMode, setUploadInitialMode] = useState<"image" | "link" | "text">("image");
  const { user } = useAuth();
  const [, navigate] = useLocation();
  
  // View mode toggle between recipes and cookbooks
  const [viewMode, setViewMode] = useState<ViewMode>('recipes');
  const [cookbookViewMode, setCookbookViewMode] = useState<CookbookViewMode>('mine');
  
  // Default to 'public' for guests, 'all' for authenticated users
  const [collectionFilter, setCollectionFilter] = useState<CollectionFilter>(user ? 'all' : 'public');
  const [deleteDialogRecipeId, setDeleteDialogRecipeId] = useState<string | null>(null);
  const [selectedRecipeIds, setSelectedRecipeIds] = useState<Set<string>>(new Set());
  const [selectedCookbookIds, setSelectedCookbookIds] = useState<number[]>([]);
  const [selectedCreatorId, setSelectedCreatorId] = useState<string | undefined>();
  const [bulkAddDialogOpen, setBulkAddDialogOpen] = useState(false);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [bulkCookbookId, setBulkCookbookId] = useState<string | undefined>();
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [sortBy, setSortBy] = useState<string>('newest');
  
  const { toast } = useToast();

  // Track previous auth state to detect transitions
  const prevUserRef = useRef<typeof user | undefined>(undefined);
  
  // React to auth state transitions (not every render)
  useEffect(() => {
    const hadUser = !!prevUserRef.current;
    const hasUser = !!user;
    
    // User just logged in (transition from no-user to user)
    if (!hadUser && hasUser && collectionFilter === 'public') {
      setCollectionFilter('all');
    }
    
    // User just logged out (transition from user to no-user)
    if (hadUser && !hasUser) {
      // Reset to 'public' if on auth-only filters
      if (collectionFilter === 'yours' || collectionFilter === 'shared' || collectionFilter === 'bookmarked') {
        setCollectionFilter('public');
      }
    }
    
    // Update ref for next render
    prevUserRef.current = user;
  }, [user, collectionFilter]);

  // Fetch cookbooks based on view mode
  // For guests, only show public cookbooks
  // For authenticated users, show based on selected tab
  const getCookbookQueryKey = () => {
    // Guests can only see public cookbooks
    if (!user) {
      return ['/api/cookbooks', { scope: 'public' }];
    }
    
    switch (cookbookViewMode) {
      case 'following':
        return ['/api/cookbooks', { scope: 'following' }];
      case 'public':
        return ['/api/cookbooks', { scope: 'public' }];
      default:
        return ['/api/cookbooks'];
    }
  };
  
  const { data: cookbooks = [] } = useQuery<Array<{
    id: number;
    name: string;
    description?: string | null;
    ownerUserId: string;
    isPublic: boolean;
    recipeCount?: number;
  }>>({
    queryKey: getCookbookQueryKey(),
    enabled: viewMode === 'cookbooks', // Always allow fetching when in cookbooks view
  });
  
  // Fetch followed cookbook IDs for quick lookup - only for authenticated users
  const { data: followedCookbookIds = [] } = useQuery<number[]>({
    queryKey: ['/api/cookbooks/following/ids'],
    enabled: !!user && viewMode === 'cookbooks', // Only fetch when user is authenticated and viewing cookbooks
    retry: false, // Don't retry on 401 errors
  });

  const serializeFiltersToParams = (f: FiltersState): Record<string, string> => {
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
    if (f.budgetFriendly) params.budgetFriendly = 'true';
    if (f.fewIngredients) params.fewIngredients = 'true';
    if (f.onePot) params.onePot = 'true';
    if (f.airFryer) params.airFryer = 'true';
    return params;
  };

  const getQueryKey = () => {
    const filterParams = serializeFiltersToParams(filters);
    const baseParams: Record<string, any> = { ...filterParams };
    if (sortBy !== 'newest') baseParams.sortBy = sortBy;

    if (selectedCreatorId) {
      return ['/api/recipes', { ...baseParams, creatorId: selectedCreatorId }];
    }
    
    if (selectedCookbookIds.length > 0) {
      return ['/api/recipes', { ...baseParams, cookbookIds: selectedCookbookIds.join(',') }];
    }
    
    switch (collectionFilter) {
      case 'yours':
        return ['/api/recipes', { ...baseParams, scope: 'my' }];
      case 'public':
        return ['/api/recipes', { ...baseParams, scope: 'public' }];
      case 'shared':
        return ['/api/recipes', { ...baseParams, scope: 'shared' }];
      case 'bookmarked':
        return ['/api/bookmarks/recipes', baseParams];
      default:
        return user ? ['/api/recipes', baseParams] : ['/api/recipes', { ...baseParams, scope: 'public' }];
    }
  };

  const { 
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<PaginatedRecipes>({
    queryKey: getQueryKey(),
    queryFn: async ({ pageParam = 1, queryKey }) => {
      // Use queryKey from context to ensure we have the current values
      const path = queryKey[0] as string;
      const params = (queryKey[1] as Record<string, any>) || {};
      
      // For bookmarked recipes, return non-paginated response wrapped in paginated format
      if (path === '/api/bookmarks/recipes') {
        const response = await fetch(path);
        if (!response.ok) throw new Error('Failed to fetch bookmarked recipes');
        const recipes = await response.json();
        return {
          recipes,
          total: recipes.length,
          page: 1,
          limit: recipes.length,
          hasMore: false,
        };
      }
      
      const queryParams = new URLSearchParams({
        ...params,
        page: String(pageParam),
        limit: '24',
      });
      
      const response = await fetch(`${path}?${queryParams}`);
      if (!response.ok) throw new Error('Failed to fetch recipes');
      return response.json();
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => {
      return lastPage.hasMore ? pages.length + 1 : undefined;
    },
    refetchInterval: (query) => {
      const pages = query.state.data?.pages;
      if (!pages) return false;
      
      // Poll if any recipe across all pages is still processing
      const needsPolling = pages.some(page => 
        page.recipes.some((recipe) =>
          recipe.enrichmentStatus === 'enriching' ||
          recipe.enrichmentStatus === 'extracting' ||
          recipe.imageGenerationStatus === 'pending' ||
          recipe.imageGenerationStatus === 'generating'
        )
      );
      
      return needsPolling ? 3000 : false;
    },
    // Keep showing previous data while fetching new data to prevent loading flashes
    placeholderData: (previousData) => previousData,
  });

  // Flatten all pages into a single recipes array
  const recipes = useMemo(() => {
    return data?.pages.flatMap(page => page.recipes) || [];
  }, [data]);

  const recipesGeneratingImages = useMemo(() => {
    if (!recipes) return new Set<string>();
    return new Set(
      recipes
        .filter((r) => isPlaceholderImage(r.dishImageThumbnail))
        .map((r) => r.id)
    );
  }, [recipes]);

  const filteredRecipes = recipes;

  const totalResults = data?.pages[0]?.total ?? 0;

  const hasActiveFilters = countActiveFilters(filters) > 0;

  const activeFilterChips = useMemo(() => {
    const chips: { label: string; onRemove: () => void }[] = [];
    filters.mealTypes.forEach(v => chips.push({ label: v, onRemove: () => dispatch({ type: "TOGGLE_MEAL_TYPE", payload: v }) }));
    filters.cuisines.forEach(v => chips.push({ label: v, onRemove: () => dispatch({ type: "TOGGLE_CUISINE", payload: v }) }));
    filters.cookingMethods.forEach(v => chips.push({ label: v, onRemove: () => dispatch({ type: "TOGGLE_COOKING_METHOD", payload: v }) }));
    filters.skillLevels.forEach(v => chips.push({ label: v, onRemove: () => dispatch({ type: "TOGGLE_SKILL_LEVEL", payload: v }) }));
    filters.seasons.forEach(v => chips.push({ label: v, onRemove: () => dispatch({ type: "TOGGLE_SEASON", payload: v }) }));
    filters.excludeAllergens.forEach(v => chips.push({ label: `No ${v}`, onRemove: () => dispatch({ type: "TOGGLE_ALLERGEN", payload: v }) }));
    filters.timeConvenience.forEach(v => chips.push({ label: v, onRemove: () => dispatch({ type: "TOGGLE_TIME_CONVENIENCE", payload: v }) }));
    const dietaryLabels: Record<string, string> = {
      vegetarian: "Vegetarian", vegan: "Vegan", pescatarian: "Pescatarian",
      glutenFree: "Gluten-Free", dairyFree: "Dairy-Free", keto: "Keto",
      paleo: "Paleo", lowCarb: "Low Carb", highProtein: "High Protein",
      lowCalorie: "Low Calorie", highFiber: "High Fiber", mediterranean: "Mediterranean",
    };
    for (const [key, value] of Object.entries(filters.dietary)) {
      if (value) chips.push({ label: dietaryLabels[key] || key, onRemove: () => dispatch({ type: "TOGGLE_DIETARY", payload: key as keyof typeof filters.dietary }) });
    }
    if (filters.budgetFriendly) chips.push({ label: "Budget-Friendly", onRemove: () => dispatch({ type: "TOGGLE_QUICK_FILTER", payload: "budgetFriendly" }) });
    if (filters.fewIngredients) chips.push({ label: "5 or Less", onRemove: () => dispatch({ type: "TOGGLE_QUICK_FILTER", payload: "fewIngredients" }) });
    if (filters.onePot) chips.push({ label: "One-Pot", onRemove: () => dispatch({ type: "TOGGLE_QUICK_FILTER", payload: "onePot" }) });
    if (filters.airFryer) chips.push({ label: "Air Fryer", onRemove: () => dispatch({ type: "TOGGLE_QUICK_FILTER", payload: "airFryer" }) });
    if (filters.search) chips.push({ label: `"${filters.search}"`, onRemove: () => dispatch({ type: "SET_SEARCH", payload: "" }) });
    return chips;
  }, [filters]);

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (recipeId: string) => {
      const response = await apiRequest("DELETE", `/api/recipes/${recipeId}`);
      return response;
    },
    onSuccess: () => {
      // Invalidate ALL recipe queries (base and scoped) using predicate
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return key === '/api/recipes';
        }
      });
      toast({
        title: "Recipe deleted successfully",
      });
      setDeleteDialogRecipeId(null);
    },
    onError: async (error: any) => {
      // Extract meaningful error message from Response
      let errorMessage = "An error occurred while deleting the recipe";
      
      if (error instanceof Response) {
        try {
          const errorData = await error.json();
          errorMessage = errorData.message || errorData.error || error.statusText;
        } catch {
          errorMessage = error.statusText || errorMessage;
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast({
        title: `Failed to delete "${recipeToDelete?.title || 'recipe'}"`,
        description: errorMessage,
        variant: "destructive",
      });
      // Keep dialog open so user can retry or cancel
    },
  });

  // Resolve recipe to delete from full recipes list (not filtered) to avoid flickering
  const recipeToDelete = recipes?.find(r => r.id === deleteDialogRecipeId);

  // Bulk add to cookbook mutation
  const bulkAddToCookbookMutation = useMutation({
    mutationFn: async ({ cookbookId, recipeIds }: { cookbookId: number; recipeIds: string[] }) => {
      const response = await apiRequest("POST", "/api/recipes/bulk/add-to-cookbook", { 
        cookbookId, 
        recipeIds 
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && (key === '/api/recipes' || key.startsWith('/api/cookbooks'));
        }
      });
      toast({
        title: "Recipes added to cookbook",
        description: `${selectedRecipeIds.size} recipe${selectedRecipeIds.size > 1 ? 's' : ''} added successfully`,
      });
      setSelectedRecipeIds(new Set());
      setBulkAddDialogOpen(false);
      setBulkCookbookId(undefined);
    },
    onError: async (error: any) => {
      let errorMessage = "An error occurred while adding recipes to cookbook";
      if (error instanceof Response) {
        try {
          const errorData = await error.json();
          errorMessage = errorData.message || errorData.error || error.statusText;
        } catch {
          errorMessage = error.statusText || errorMessage;
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      toast({
        title: "Failed to add recipes to cookbook",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Bulk delete mutation
  const bulkDeleteMutation = useMutation({
    mutationFn: async (recipeIds: string[]) => {
      const response = await apiRequest("DELETE", "/api/recipes/bulk", { recipeIds });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && (key === '/api/recipes' || key.startsWith('/api/cookbooks'));
        }
      });
      toast({
        title: "Recipes deleted successfully",
        description: `${selectedRecipeIds.size} recipe${selectedRecipeIds.size > 1 ? 's' : ''} deleted`,
      });
      setSelectedRecipeIds(new Set());
      setBulkDeleteDialogOpen(false);
    },
    onError: async (error: any) => {
      let errorMessage = "An error occurred while deleting recipes";
      if (error instanceof Response) {
        try {
          const errorData = await error.json();
          errorMessage = errorData.message || errorData.error || error.statusText;
        } catch {
          errorMessage = error.statusText || errorMessage;
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      toast({
        title: "Failed to delete recipes",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Bulk add to grocery list mutation
  const bulkAddToGroceryListMutation = useMutation({
    mutationFn: async (recipeIds: string[]) => {
      const response = await apiRequest("POST", "/api/grocery-list/recipes/bulk", { recipeIds });
      return response;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/grocery-list'] });
      queryClient.invalidateQueries({ queryKey: ['/api/grocery-list/by-aisle'] });
      toast({
        title: "Added to grocery list",
        description: data.message || `${selectedRecipeIds.size} recipe${selectedRecipeIds.size > 1 ? 's' : ''} added to grocery list`,
      });
      setSelectedRecipeIds(new Set());
    },
    onError: async (error: any) => {
      let errorMessage = "An error occurred while adding recipes to grocery list";
      if (error instanceof Response) {
        try {
          const errorData = await error.json();
          errorMessage = errorData.message || errorData.error || error.statusText;
        } catch {
          errorMessage = error.statusText || errorMessage;
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Handlers for multi-select
  const handleToggleRecipe = (recipeId: string) => {
    setSelectedRecipeIds(prev => {
      const next = new Set(prev);
      if (next.has(recipeId)) {
        next.delete(recipeId);
      } else {
        next.add(recipeId);
      }
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedRecipeIds(new Set());
  };

  const handleBulkAddToCookbook = () => {
    if (bulkCookbookId && selectedRecipeIds.size > 0) {
      bulkAddToCookbookMutation.mutate({
        cookbookId: parseInt(bulkCookbookId),
        recipeIds: Array.from(selectedRecipeIds),
      });
    }
  };

  const handleBulkDelete = () => {
    if (selectedRecipeIds.size > 0) {
      bulkDeleteMutation.mutate(Array.from(selectedRecipeIds));
    }
  };

  const handleBulkAddToGroceryList = () => {
    if (selectedRecipeIds.size > 0) {
      bulkAddToGroceryListMutation.mutate(Array.from(selectedRecipeIds));
    }
  };

  // Bookmark query - fetch user's bookmarked recipe IDs
  const { data: bookmarkedIds = [] } = useQuery<string[]>({
    queryKey: ['/api/bookmarks'],
    enabled: !!user,
  });
  
  // Create a Set for quick lookup
  const bookmarkedIdsSet = useMemo(() => new Set(bookmarkedIds), [bookmarkedIds]);

  // Bookmark mutation
  const bookmarkMutation = useMutation({
    mutationFn: async ({ recipeId, isBookmarked }: { recipeId: string; isBookmarked: boolean }) => {
      if (isBookmarked) {
        await apiRequest("DELETE", `/api/bookmarks/${recipeId}`);
      } else {
        await apiRequest("POST", `/api/bookmarks/${recipeId}`);
      }
    },
    onMutate: async ({ recipeId, isBookmarked }) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ['/api/bookmarks'] });
      const previousBookmarks = queryClient.getQueryData<string[]>(['/api/bookmarks']);
      
      queryClient.setQueryData<string[]>(['/api/bookmarks'], (old = []) => {
        if (isBookmarked) {
          return old.filter(id => id !== recipeId);
        } else {
          return [...old, recipeId];
        }
      });
      
      return { previousBookmarks };
    },
    onError: (error, variables, context) => {
      // Rollback on error
      if (context?.previousBookmarks) {
        queryClient.setQueryData(['/api/bookmarks'], context.previousBookmarks);
      }
      toast({
        title: "Failed to update bookmark",
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bookmarks'] });
    },
  });

  // Share handler - copies recipe URL to clipboard
  const handleShare = async (recipeId: string) => {
    const url = `${window.location.origin}/recipe/${recipeId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: "Link copied!",
        description: "Recipe link has been copied to your clipboard",
      });
    } catch (error) {
      toast({
        title: "Failed to copy link",
        variant: "destructive",
      });
    }
  };

  // Bookmark handler
  const handleBookmark = (recipeId: string) => {
    if (!user) {
      toast({
        title: "Sign in required",
        description: "Please sign in to bookmark recipes",
      });
      return;
    }
    const isBookmarked = bookmarkedIdsSet.has(recipeId);
    bookmarkMutation.mutate({ recipeId, isBookmarked });
  };

  // Create a Set for quick lookup of followed cookbook IDs
  const followedCookbookIdsSet = useMemo(() => new Set(followedCookbookIds), [followedCookbookIds]);

  // Cookbook follow mutation
  const cookbookFollowMutation = useMutation({
    mutationFn: async ({ cookbookId, isFollowing }: { cookbookId: number; isFollowing: boolean }) => {
      if (isFollowing) {
        await apiRequest("DELETE", `/api/cookbooks/${cookbookId}/follow`);
      } else {
        await apiRequest("POST", `/api/cookbooks/${cookbookId}/follow`);
      }
    },
    onMutate: async ({ cookbookId, isFollowing }) => {
      await queryClient.cancelQueries({ queryKey: ['/api/cookbooks/following/ids'] });
      const previousFollowing = queryClient.getQueryData<number[]>(['/api/cookbooks/following/ids']);
      
      queryClient.setQueryData<number[]>(['/api/cookbooks/following/ids'], (old = []) => {
        if (isFollowing) {
          return old.filter(id => id !== cookbookId);
        } else {
          return [...old, cookbookId];
        }
      });
      
      return { previousFollowing };
    },
    onError: (error, variables, context) => {
      if (context?.previousFollowing) {
        queryClient.setQueryData(['/api/cookbooks/following/ids'], context.previousFollowing);
      }
      toast({
        title: "Failed to update follow status",
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/cookbooks/following/ids'] });
      queryClient.invalidateQueries({ queryKey: ['/api/cookbooks'] });
    },
  });

  // Share cookbook handler - copies cookbook URL to clipboard
  const handleShareCookbook = async (cookbookId: number) => {
    const url = `${window.location.origin}/cookbook/${cookbookId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: "Link copied!",
        description: "Cookbook link has been copied to your clipboard",
      });
    } catch (error) {
      toast({
        title: "Failed to copy link",
        variant: "destructive",
      });
    }
  };

  // Follow/unfollow cookbook handler
  const handleFollowCookbook = (cookbookId: number) => {
    if (!user) {
      toast({
        title: "Sign in required",
        description: "Please sign in to follow cookbooks",
      });
      return;
    }
    const isFollowing = followedCookbookIdsSet.has(cookbookId);
    cookbookFollowMutation.mutate({ cookbookId, isFollowing });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Liquid Glass Toolbar - Fixed at top */}
      <LiquidGlassToolbar
        searchValue={filters.search}
        onSearchChange={(value) => dispatch({ type: "SET_SEARCH", payload: value })}
        onUploadClick={() => {
          setUploadInitialMode("image");
          setUploadModalOpen(true);
        }}
        onQuickPasteClick={() => {
          setUploadInitialMode("link");
          setUploadModalOpen(true);
        }}
      />

      {/* Hero Section with Clear Glass Overlay */}
      <section 
        className="relative h-[50vh] sm:h-[60vh] max-h-[600px] bg-cover bg-center mt-16 md:mt-16"
        style={{ backgroundImage: `url(${heroImage})` }}
      >
        {/* Dimming Layer */}
        <div className="absolute inset-0 glass-dimming" />

        {/* Clear Glass Content Overlay */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="glass-clear px-6 py-8 md:py-12 rounded-2xl max-w-3xl mx-4 text-center">
            <h1
              className="font-serif text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-3 md:mb-4"
              data-testid="text-hero-title"
            >
              Your Recipe Collection
            </h1>
            <p className="text-base md:text-lg lg:text-xl text-white/95 mb-6 md:mb-8">
              Discover, save, and share delicious recipes with AI-powered extraction
            </p>
            <Button
              size="lg"
              onClick={() => setUploadModalOpen(true)}
              className="bg-primary hover:bg-primary/90 shadow-lg hidden md:inline-flex"
              data-testid="button-upload-hero"
            >
              <Upload className="mr-2 h-5 w-5" strokeWidth={2} />
              Upload Recipe
            </Button>
          </div>
        </div>
      </section>

      {/* Quick Link Import Bar */}
      <div className="max-w-3xl mx-auto px-4 -mt-6 relative z-10">
        <QuickLinkImport />
      </div>

      {/* Main Content Area */}
      <div className="max-w-7xl mx-auto px-4 py-6 md:py-8">
        {/* Consolidated Filter Bar - Single Row */}
        <div className="flex flex-wrap items-center gap-3 sticky top-0 z-30 bg-background py-3 -mx-4 px-4 border-b">
          {/* View Mode Toggle - Available for all users */}
          <div className="flex items-center gap-2">
            <Button
              variant={viewMode === 'recipes' && collectionFilter !== 'bookmarked' && selectedCookbookIds.length === 0 ? 'default' : 'outline'}
              size="icon"
              onClick={() => {
                setViewMode('recipes');
                setCollectionFilter(user ? 'all' : 'public');
                setSelectedCookbookIds([]);
                setSelectedCreatorId(undefined);
              }}
              className="sm:w-auto sm:px-3 gap-2"
              data-testid="button-view-recipes"
            >
              <LayoutGrid className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span className="hidden sm:inline">All Recipes</span>
            </Button>
            {user && (
              <Button
                variant={collectionFilter === 'bookmarked' ? 'default' : 'outline'}
                size="icon"
                onClick={() => {
                  setViewMode('recipes');
                  setCollectionFilter('bookmarked');
                  setSelectedCookbookIds([]);
                  setSelectedCreatorId(undefined);
                }}
                className="sm:w-auto sm:px-3 gap-2"
                data-testid="button-view-bookmarked"
              >
                <Heart className="h-4 w-4 shrink-0" strokeWidth={2} />
                <span className="hidden sm:inline">Favorites</span>
              </Button>
            )}
            <Button
              variant={viewMode === 'cookbooks' ? 'default' : 'outline'}
              size="icon"
              onClick={() => {
                setViewMode('cookbooks');
                setCollectionFilter(user ? 'all' : 'public');
              }}
              className="sm:w-auto sm:px-3 gap-2"
              data-testid="button-view-cookbooks"
            >
              <Folder className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span className="hidden sm:inline">{user ? 'My Cookbooks' : 'Cookbooks'}</span>
            </Button>
          </div>

          {/* Cookbook Multi-Select - only in recipes view for authenticated users */}
          {user && viewMode === 'recipes' && (
            <CookbookMultiSelect
              selectedIds={selectedCookbookIds}
              onSelectionChange={(ids) => {
                setSelectedCookbookIds(ids);
                if (ids.length > 0) {
                  setCollectionFilter('all');
                }
              }}
              testId="select-filter-cookbooks"
            />
          )}
          
          {/* Advanced Filter Trigger - only in recipes view */}
          {viewMode === 'recipes' && (
            <AdvancedFilterTrigger 
              isOpen={advancedFiltersOpen}
              onToggle={() => setAdvancedFiltersOpen(!advancedFiltersOpen)}
              activeCount={countActiveFilters(filters)}
              onReset={() => dispatch({ type: "RESET_ALL" })}
            />
          )}

          {/* Sort dropdown - only in recipes view */}
          {viewMode === 'recipes' && (
            <SortPopover sortBy={sortBy} onSortChange={setSortBy} />
          )}
          
          {/* Active Filter Indicators - on same row when space allows */}
          {viewMode === 'recipes' && (selectedCreatorId || selectedCookbookIds.length > 0) && (
            <div className="flex items-center gap-2 ml-auto">
              {selectedCreatorId && (
                <Badge variant="default" className="text-sm py-1.5 px-3">
                  By: {recipes?.[0]?.owner?.username || recipes?.[0]?.owner?.firstName || 'creator'}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-1.5 h-4 w-4 p-0 hover:bg-transparent"
                    onClick={() => setSelectedCreatorId(undefined)}
                    data-testid="button-clear-creator-filter"
                  >
                    <X className="h-3 w-3" strokeWidth={2} />
                  </Button>
                </Badge>
              )}
              {selectedCookbookIds.length > 0 && (
                <Badge variant="secondary" className="text-sm py-1.5 px-3">
                  {selectedCookbookIds.length === 1 
                    ? cookbooks.find(c => c.id === selectedCookbookIds[0])?.name || 'Cookbook'
                    : `${selectedCookbookIds.length} cookbooks`}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-1.5 h-4 w-4 p-0 hover:bg-transparent"
                    onClick={() => setSelectedCookbookIds([])}
                    data-testid="button-clear-cookbook-filter"
                  >
                    <X className="h-3 w-3" strokeWidth={2} />
                  </Button>
                </Badge>
              )}
            </div>
          )}
        </div>
        
        {viewMode === 'recipes' && (
          <AdvancedFilterSheet
            open={advancedFiltersOpen}
            onOpenChange={setAdvancedFiltersOpen}
            filters={filters}
            dispatch={dispatch}
            userId={user?.id}
            scope={collectionFilter === 'yours' ? 'my' : collectionFilter === 'public' ? 'public' : collectionFilter === 'shared' ? 'shared' : undefined}
            totalResults={totalResults}
            onReset={() => dispatch({ type: "RESET_ALL" })}
          />
        )}

        {viewMode === 'recipes' && (
          <QuickFilters 
            filters={filters} 
            dispatch={dispatch}
          />
        )}

        {/* Active Filter Chips + Results Count */}
        {viewMode === 'recipes' && activeFilterChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-3" data-testid="filter-chips-row">
            {activeFilterChips.map((chip, i) => (
              <Badge
                key={`${chip.label}-${i}`}
                variant="secondary"
                className="gap-1.5 pr-1"
                data-testid={`chip-filter-${i}`}
              >
                {chip.label}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 p-0 hover:bg-transparent no-default-hover-elevate"
                  onClick={chip.onRemove}
                  data-testid={`button-remove-chip-${i}`}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground text-xs"
              onClick={() => dispatch({ type: "RESET_ALL" })}
              data-testid="button-clear-all-chips"
            >
              Clear all
            </Button>
          </div>
        )}

        {/* Results count */}
        {viewMode === 'recipes' && !isLoading && (
          <div className="flex items-center gap-2 mt-4 text-sm text-muted-foreground" data-testid="results-count">
            {hasActiveFilters || filters.search ? (
              <span>Showing {totalResults} {totalResults === 1 ? 'recipe' : 'recipes'}</span>
            ) : (
              <span>{totalResults} {totalResults === 1 ? 'recipe' : 'recipes'}</span>
            )}
          </div>
        )}

        {/* Cookbooks View */}
        {viewMode === 'cookbooks' && (
          <>
            {/* Cookbook View Mode Tabs - only show for authenticated users */}
            {user && (
              <div className="flex items-center gap-2 mt-6 mb-4">
                <Button
                  variant={cookbookViewMode === 'mine' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setCookbookViewMode('mine')}
                  data-testid="button-cookbooks-mine"
                >
                  <BookOpen className="h-4 w-4 mr-1.5" strokeWidth={2} />
                  My Cookbooks
                </Button>
                <Button
                  variant={cookbookViewMode === 'following' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setCookbookViewMode('following')}
                  data-testid="button-cookbooks-following"
                >
                  <Heart className="h-4 w-4 mr-1.5" strokeWidth={2} />
                  Following
                </Button>
                <Button
                  variant={cookbookViewMode === 'public' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setCookbookViewMode('public')}
                  data-testid="button-cookbooks-public"
                >
                  <Globe className="h-4 w-4 mr-1.5" strokeWidth={2} />
                  Discover
                </Button>
              </div>
            )}
            
            {/* Guest heading for public cookbooks view */}
            {!user && (
              <div className="flex items-center gap-2 mt-6 mb-4">
                <Globe className="h-5 w-5 text-primary" strokeWidth={2} />
                <h2 className="text-lg font-semibold">Public Cookbooks</h2>
              </div>
            )}
            
            {/* Cookbook Cards Grid */}
            {cookbooks && cookbooks.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {cookbooks.map((cookbook) => {
                  const isOwn = cookbook.ownerUserId === user?.id;
                  const isFollowing = followedCookbookIdsSet.has(cookbook.id);
                  
                  return (
                    <Card
                      key={cookbook.id}
                      className="overflow-hidden hover-elevate transition-transform border border-card-border"
                      data-testid={`card-cookbook-${cookbook.id}`}
                    >
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between mb-4">
                          <div 
                            className="cursor-pointer flex-1"
                            onClick={() => {
                              setViewMode('recipes');
                              setSelectedCookbookIds([cookbook.id]);
                            }}
                          >
                            <BookOpen className="h-10 w-10 text-primary" strokeWidth={2} />
                          </div>
                          <div className="flex items-center gap-1">
                            <Badge variant="secondary" className="text-xs">
                              {cookbook.recipeCount || 0} recipes
                            </Badge>
                            {cookbook.isPublic && (
                              <Badge variant="outline" className="text-xs">
                                <Globe className="h-3 w-3 mr-1" strokeWidth={2} />
                                Public
                              </Badge>
                            )}
                          </div>
                        </div>
                        
                        <div 
                          className="cursor-pointer"
                          onClick={() => {
                            setViewMode('recipes');
                            setSelectedCookbookIds([cookbook.id]);
                          }}
                        >
                          <h3 className="font-serif text-xl font-bold mb-2">
                            {cookbook.name}
                          </h3>
                          {cookbook.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
                              {cookbook.description}
                            </p>
                          )}
                        </div>
                        
                        {/* Action Buttons */}
                        <div className="flex items-center gap-2 pt-3 border-t border-border">
                          {/* Share button - available for public cookbooks */}
                          {cookbook.isPublic && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleShareCookbook(cookbook.id);
                              }}
                              className="flex-1"
                              data-testid={`button-share-cookbook-${cookbook.id}`}
                            >
                              <Share2 className="h-4 w-4 mr-1.5" strokeWidth={2} />
                              Share
                            </Button>
                          )}
                          
                          {/* Follow button - for other users' public cookbooks */}
                          {!isOwn && cookbook.isPublic && (
                            <Button
                              variant={isFollowing ? 'default' : 'outline'}
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleFollowCookbook(cookbook.id);
                              }}
                              className="flex-1"
                              data-testid={`button-follow-cookbook-${cookbook.id}`}
                            >
                              {isFollowing ? (
                                <>
                                  <HeartOff className="h-4 w-4 mr-1.5" strokeWidth={2} />
                                  Unfollow
                                </>
                              ) : (
                                <>
                                  <Heart className="h-4 w-4 mr-1.5" strokeWidth={2} />
                                  Follow
                                </>
                              )}
                            </Button>
                          )}
                          
                          {/* View button */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setViewMode('recipes');
                              setSelectedCookbookIds([cookbook.id]);
                            }}
                            className={!cookbook.isPublic && !isOwn ? 'flex-1' : ''}
                            data-testid={`button-view-cookbook-${cookbook.id}`}
                          >
                            <Eye className="h-4 w-4 mr-1.5" strokeWidth={2} />
                            View
                          </Button>
                          
                          {/* Print button - for cookbook owners */}
                          {isOwn && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/cookbook/${cookbook.id}/print`);
                              }}
                              data-testid={`button-print-cookbook-${cookbook.id}`}
                            >
                              <Printer className="h-4 w-4 mr-1.5" strokeWidth={2} />
                              Print
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12">
                <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" strokeWidth={1.5} />
                <h3 className="text-lg font-medium mb-2">
                  {!user ? 'No public cookbooks yet' :
                   cookbookViewMode === 'mine' ? 'No cookbooks yet' : 
                   cookbookViewMode === 'following' ? 'Not following any cookbooks' :
                   'No public cookbooks to discover'}
                </h3>
                <p className="text-muted-foreground">
                  {!user ? 'Sign in to create and follow cookbooks' :
                   cookbookViewMode === 'mine' ? 'Create your first cookbook to organize recipes' :
                   cookbookViewMode === 'following' ? 'Follow other users\' public cookbooks to see them here' :
                   'Check back later for new public cookbooks'}
                </p>
              </div>
            )}
          </>
        )}

        {/* Recipes Grid */}
        {viewMode === 'recipes' && isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mt-8">
            {[...Array(8)].map((_, i) => (
              <Card key={i} className="overflow-hidden">
                <Skeleton className="aspect-[4/3] w-full" />
                <CardContent className="p-6">
                  <Skeleton className="h-6 w-3/4 mb-2" />
                  <Skeleton className="h-4 w-full mb-4" />
                  <div className="flex gap-3">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : viewMode === 'recipes' && filteredRecipes.length > 0 ? (
          <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mt-8">
            {filteredRecipes.map((recipe) => (
              <div key={recipe.id} className="relative group">
                {/* Multi-select checkbox */}
                {user && recipe.owner?.id === user.id && (
                  <div className="absolute top-3 left-3 z-10">
                    <Checkbox
                      checked={selectedRecipeIds.has(recipe.id)}
                      onCheckedChange={() => handleToggleRecipe(recipe.id)}
                      className="bg-white/90 backdrop-blur-sm border-white/50 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                      data-testid={`checkbox-recipe-${recipe.id}`}
                    />
                  </div>
                )}
                
                <Link href={`/recipe/${recipe.id}`}>
                <Card 
                  className="overflow-hidden hover-elevate transition-all cursor-pointer border border-card-border h-full"
                  data-testid={`card-recipe-${recipe.id}`}
                >
                  {/* Recipe Image */}
                  <div className="relative aspect-[4/3] overflow-hidden">
                    <img
                      src={isPlaceholderImage(recipe.dishImageThumbnail) ? grammieImage : (recipe.dishImageThumbnail || grammieImage)}
                      alt={recipe.title}
                      loading="lazy"
                      className={`w-full h-full transition-transform group-hover:scale-105 ${isPlaceholderImage(recipe.dishImageThumbnail) ? 'object-contain bg-muted p-4' : 'object-cover'}`}
                      data-testid={`img-recipe-${recipe.id}`}
                    />
                    
                    {/* Glass overlay with icon actions */}
                    <div className="absolute top-3 right-3 flex gap-2">
                      {/* Icon actions - using glass-clear for visibility */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-9 h-9 glass-clear hover:glass-regular transition-all"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleShare(recipe.id);
                        }}
                        aria-label="Share recipe"
                        data-testid={`button-share-${recipe.id}`}
                      >
                        <Share2 className="h-4 w-4 text-white" strokeWidth={2} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`w-9 h-9 glass-clear hover:glass-regular transition-all ${bookmarkedIdsSet.has(recipe.id) ? 'text-primary' : ''}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleBookmark(recipe.id);
                        }}
                        aria-label={bookmarkedIdsSet.has(recipe.id) ? "Remove bookmark" : "Bookmark recipe"}
                        data-testid={`button-bookmark-${recipe.id}`}
                      >
                        {bookmarkedIdsSet.has(recipe.id) ? (
                          <BookmarkCheck className="h-4 w-4 text-primary" strokeWidth={2} />
                        ) : (
                          <Bookmark className="h-4 w-4 text-white" strokeWidth={2} />
                        )}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="w-9 h-9 glass-clear hover:glass-regular transition-all"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            aria-label="More options"
                            data-testid={`button-more-${recipe.id}`}
                          >
                            <MoreVertical className="h-4 w-4 text-white" strokeWidth={2} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {user && recipe.owner?.id === user.id && (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setDeleteDialogRecipeId(recipe.id);
                              }}
                              data-testid={`menu-item-delete-${recipe.id}`}
                            >
                              <Trash2 className="h-4 w-4 mr-2" strokeWidth={2} />
                              Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    
                    {/* Status badges */}
                    <div className="absolute top-3 left-3 flex flex-col gap-2">
                      {recipe.enrichmentStatus === 'enriching' && (
                        <Badge 
                          variant="secondary" 
                          className="bg-background/90 backdrop-blur-sm text-foreground gap-1.5"
                          data-testid={`badge-enriching-${recipe.id}`}
                        >
                          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                          Enriching...
                        </Badge>
                      )}
                      
                      {recipe.enrichmentStatus === 'extracting' && (
                        <Badge 
                          variant="secondary" 
                          className="bg-background/90 backdrop-blur-sm text-foreground gap-1.5"
                          data-testid={`badge-extracting-${recipe.id}`}
                        >
                          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                          Extracting...
                        </Badge>
                      )}
                      
                      {recipe.enrichmentStatus === 'failed' && (
                        <Badge 
                          variant="destructive" 
                          className="bg-destructive/90 backdrop-blur-sm text-destructive-foreground gap-1.5"
                          data-testid={`badge-failed-${recipe.id}`}
                        >
                          <AlertTriangle className="h-3 w-3" strokeWidth={2} />
                          Enrichment failed
                        </Badge>
                      )}
                    </div>
                    
                  </div>
                  
                  {/* Card Content */}
                  <CardContent className="p-4 md:p-6">
                    <h3
                      className="font-serif text-lg md:text-xl font-bold text-foreground mb-3 line-clamp-2"
                      data-testid={`text-recipe-title-${recipe.id}`}
                    >
                      {recipe.title}
                    </h3>
                    <div className="flex flex-wrap gap-3 text-sm text-muted-foreground mb-4">
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" strokeWidth={2} />
                        <span data-testid={`text-recipe-time-${recipe.id}`}>
                          {formatTime(recipe.totalTimeMinutes)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Users className="h-4 w-4" strokeWidth={2} />
                        <span
                          data-testid={`text-recipe-servings-${recipe.id}`}
                        >
                          {recipe.servings} servings
                        </span>
                      </div>
                    </div>
                    {/* Owner and Cookbook badges */}
                    <div className="flex flex-wrap gap-2">
                      {/* Creator badge */}
                      {recipe.owner && (
                        <Badge
                          variant="secondary"
                          className="text-xs cursor-pointer hover-elevate"
                          data-testid={`badge-creator-${recipe.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSelectedCreatorId(recipe.owner!.id);
                            setSelectedCookbookIds([]);
                          }}
                        >
                          {recipe.owner.username || 
                           (recipe.owner.firstName && recipe.owner.lastName 
                             ? `${recipe.owner.firstName} ${recipe.owner.lastName}`
                             : recipe.owner.firstName || 
                               recipe.owner.lastName || 
                               'Anonymous')}
                        </Badge>
                      )}
                      
                      {/* Cookbook badge - show first cookbook if any */}
                      {recipe.cookbooks && recipe.cookbooks.length > 0 && (
                        <Badge
                          variant="outline"
                          className="text-xs cursor-pointer hover-elevate"
                          data-testid={`badge-cookbook-${recipe.cookbooks[0].id}-${recipe.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSelectedCookbookIds([recipe.cookbooks![0].id]);
                            setSelectedCreatorId(undefined);
                          }}
                        >
                          <BookOpen className="h-3 w-3 mr-1" strokeWidth={2} />
                          {recipe.cookbooks[0].name}
                          {recipe.cookbooks.length > 1 && ` +${recipe.cookbooks.length - 1}`}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
              </div>
            ))}
          </div>
          
          {/* Load More button */}
          {hasNextPage && (
            <div className="flex justify-center mt-12">
              <Button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                size="lg"
                className="touch-target"
                data-testid="button-load-more"
              >
                {isFetchingNextPage ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={2} />
                    Loading more...
                  </>
                ) : (
                  <>
                    Load More Recipes
                  </>
                )}
              </Button>
            </div>
          )}
          </>
        ) : viewMode === 'recipes' ? (
          <div className="text-center py-16">
            <ChefHat className="h-24 w-24 text-muted-foreground mx-auto mb-6" strokeWidth={1.5} />
            <h3 className="text-2xl font-serif font-semibold mb-2">
              No recipes found
            </h3>
            <p className="text-muted-foreground mb-6">
              {filters.search || hasActiveFilters
                ? "Try adjusting your search or filters"
                : "Start by uploading your first recipe"}
            </p>
            <Button
              onClick={() => setUploadModalOpen(true)}
              className="touch-target"
              data-testid="button-upload-first-recipe"
            >
              <Upload className="mr-2 h-4 w-4" strokeWidth={2} />
              Upload Recipe
            </Button>
          </div>
        ) : null}
      </div>

      {/* Mobile FAB - Floating Action Button for upload (mobile only) */}
      <MobileFAB onClick={() => setUploadModalOpen(true)} />

      <UploadRecipeModal
        open={uploadModalOpen}
        onOpenChange={setUploadModalOpen}
        initialMode={uploadInitialMode}
      />

      {/* Bulk action toolbar - floating at bottom with glass effect */}
      {user && selectedRecipeIds.size > 0 && (
        <div 
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 glass-regular border glass-border rounded-lg shadow-lg p-4 safe-bottom"
          data-testid="toolbar-bulk-actions"
        >
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium" data-testid="text-selected-count">
              {selectedRecipeIds.size} recipe{selectedRecipeIds.size > 1 ? 's' : ''} selected
            </span>
            <Button
              variant="default"
              size="sm"
              onClick={() => setBulkAddDialogOpen(true)}
              disabled={bulkAddToCookbookMutation.isPending}
              className="touch-target"
              data-testid="button-bulk-add-cookbook"
            >
              <BookOpen className="h-4 w-4 mr-2" strokeWidth={2} />
              <span className="hidden sm:inline">Add to Cookbook</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleBulkAddToGroceryList}
              disabled={bulkAddToGroceryListMutation.isPending}
              className="touch-target"
              data-testid="button-bulk-add-grocery"
            >
              <ShoppingCart className="h-4 w-4 mr-2" strokeWidth={2} />
              <span className="hidden sm:inline">{bulkAddToGroceryListMutation.isPending ? "Adding..." : "Add to List"}</span>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setBulkDeleteDialogOpen(true)}
              disabled={bulkDeleteMutation.isPending}
              className="touch-target"
              data-testid="button-bulk-delete"
            >
              <Trash2 className="h-4 w-4 mr-2" strokeWidth={2} />
              <span className="hidden sm:inline">Delete</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearSelection}
              className="touch-target"
              data-testid="button-clear-selection"
            >
              <X className="h-4 w-4 mr-2" strokeWidth={2} />
              <span className="hidden sm:inline">Clear</span>
            </Button>
          </div>
        </div>
      )}

      {/* Bulk add to cookbook dialog */}
      <Dialog open={bulkAddDialogOpen} onOpenChange={(open) => {
        setBulkAddDialogOpen(open);
        if (open) {
          setBulkCookbookId(undefined);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to Cookbook</DialogTitle>
            <DialogDescription>
              Select a cookbook to add {selectedRecipeIds.size} recipe{selectedRecipeIds.size > 1 ? 's' : ''} to.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <CookbookSelect
              value={bulkCookbookId}
              onValueChange={setBulkCookbookId}
              placeholder="Select a cookbook"
              allowNone={false}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setBulkAddDialogOpen(false);
                setBulkCookbookId(undefined);
              }}
              disabled={bulkAddToCookbookMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleBulkAddToCookbook}
              disabled={!bulkCookbookId || bulkAddToCookbookMutation.isPending}
            >
              {bulkAddToCookbookMutation.isPending ? "Adding..." : "Add to Cookbook"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk delete confirmation dialog */}
      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Recipes</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedRecipeIds.size} recipe{selectedRecipeIds.size > 1 ? 's' : ''}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground border border-destructive-border"
              onClick={(e) => {
                e.preventDefault();
                handleBulkDelete();
              }}
              disabled={bulkDeleteMutation.isPending}
            >
              {bulkDeleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteDialogRecipeId} onOpenChange={(open) => !open && setDeleteDialogRecipeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Recipe</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete '{recipeToDelete?.title}'? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground border border-destructive-border"
              onClick={(e) => {
                e.preventDefault();
                if (deleteDialogRecipeId) {
                  deleteMutation.mutate(deleteDialogRecipeId);
                }
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
