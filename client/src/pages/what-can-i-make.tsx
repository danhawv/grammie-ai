import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  ChefHat,
  Package,
  Clock,
  Users,
  ArrowRight,
  Sparkles,
  ShoppingBag,
  ShoppingCart,
  Loader2,
  RefreshCw,
  AlertCircle,
  Lightbulb,
  X
} from 'lucide-react';
import { Link } from 'wouter';
import grammieImage from "@assets/image_1763329917086.png";

interface RecipeMatch {
  recipe: {
    id: string;
    dishName: string;
    dishImage?: string;
    prepTime?: number;
    cookTime?: number;
    servings?: number;
    cuisine?: string;
    difficulty?: string;
  };
  matchedIngredients: string[];
  missingIngredients: string[];
  matchPercentage: number;
  substitutions?: { ingredient: string; suggestions: string[]; notes?: string }[];
  expiringItemsUsed?: number;
  insufficientIngredients?: { ingredient: string; have: string; need: string }[];
  totalCookTime?: number;
}

interface WhatCanIMakeResponse {
  readyToCook: RecipeMatch[];
  almostReady: RecipeMatch[];
  needMoreIngredients: RecipeMatch[];
  pantryItemCount?: number;
  message?: string;
  appliedFilters?: {
    dietaryRestrictions: string[];
    dislikedIngredients: string[];
  };
  availableCuisines?: string[];
}

function ProgressBar({ value, className }: { value: number; className?: string }) {
  const colorClass = value === 100
    ? 'bg-green-500'
    : value >= 70
      ? 'bg-amber-500'
      : 'bg-primary';

  return (
    <div className={`h-2 w-full rounded-full bg-muted overflow-hidden ${className || ''}`}>
      <div
        className={`h-full rounded-full transition-all ${colorClass}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

function RecipeCard({
  match,
  showSubstitutions = false,
  onAddMissing,
  isAddingMissing,
}: {
  match: RecipeMatch;
  showSubstitutions?: boolean;
  onAddMissing?: (recipeId: string, missingIngredients: string[]) => void;
  isAddingMissing?: boolean;
}) {
  const [isLoadingSubstitutions, setIsLoadingSubstitutions] = useState(false);
  const [substitutions, setSubstitutions] = useState(match.substitutions);

  const fetchSubstitutions = async () => {
    if (match.missingIngredients.length === 0 || substitutions) return;

    setIsLoadingSubstitutions(true);
    try {
      const response = await apiRequest('POST', '/api/recipes/substitutions', { ingredients: match.missingIngredients });
      const data = await response.json();
      setSubstitutions(data.substitutions);
    } catch (error) {
      console.error('Failed to fetch substitutions:', error);
    } finally {
      setIsLoadingSubstitutions(false);
    }
  };

  const { recipe, matchedIngredients, missingIngredients, matchPercentage, expiringItemsUsed, insufficientIngredients, totalCookTime } = match;

  return (
    <Card className="hover-elevate overflow-hidden" data-testid={`recipe-card-${recipe.id}`}>
      <CardContent className="p-0">
        <Link href={`/recipe/${recipe.id}`}>
          <div className="flex gap-3 p-3">
            {recipe.dishImage && !recipe.dishImage.startsWith('data:image/svg') ? (
              <img
                src={recipe.dishImage}
                alt={recipe.dishName}
                className="w-24 h-24 rounded-md object-cover flex-shrink-0"
                loading="lazy"
              />
            ) : (
              <div className="w-24 h-24 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                <img src={grammieImage} alt="Grammie" className="w-12 h-12 object-contain opacity-50" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-sm line-clamp-2">{recipe.dishName}</h3>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                {(totalCookTime || recipe.prepTime) && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {totalCookTime || (recipe.prepTime! + (recipe.cookTime || 0))} min
                  </span>
                )}
                {recipe.servings && (
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {recipe.servings}
                  </span>
                )}
              </div>

              {/* Progress bar for match percentage */}
              <div className="flex items-center gap-2 mt-2">
                <ProgressBar value={matchPercentage} className="flex-1" />
                <span className="text-xs font-medium whitespace-nowrap">{matchPercentage}%</span>
              </div>

              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {recipe.cuisine && (
                  <Badge variant="outline" className="text-xs">
                    {recipe.cuisine}
                  </Badge>
                )}
                {expiringItemsUsed != null && expiringItemsUsed > 0 && (
                  <Badge variant="destructive" className="text-xs">
                    Uses {expiringItemsUsed} expiring
                  </Badge>
                )}
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground self-center flex-shrink-0" />
          </div>
        </Link>

        {/* Insufficient ingredient warnings */}
        {insufficientIngredients && insufficientIngredients.length > 0 && (
          <div className="px-3 pb-2">
            {insufficientIngredients.map((item, idx) => (
              <p key={idx} className="text-xs text-amber-600 dark:text-amber-400">
                ⚠ Need {item.need} {item.ingredient}, have {item.have}
              </p>
            ))}
          </div>
        )}

        {missingIngredients.length > 0 && showSubstitutions && (
          <div className="border-t px-3 py-2 bg-muted/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">
                Missing {missingIngredients.length} ingredient{missingIngredients.length > 1 ? 's' : ''}
              </span>
              <div className="flex items-center gap-1">
                {onAddMissing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={(e) => {
                      e.preventDefault();
                      onAddMissing(recipe.id, missingIngredients);
                    }}
                    disabled={isAddingMissing}
                    data-testid="button-add-to-list"
                  >
                    {isAddingMissing ? (
                      <Loader2 className="w-3 h-3 animate-spin mr-1" />
                    ) : (
                      <ShoppingCart className="w-3 h-3 mr-1" />
                    )}
                    Add to list
                  </Button>
                )}
                {!substitutions && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={fetchSubstitutions}
                    disabled={isLoadingSubstitutions}
                    data-testid="button-get-substitutions"
                  >
                    {isLoadingSubstitutions ? (
                      <Loader2 className="w-3 h-3 animate-spin mr-1" />
                    ) : (
                      <Lightbulb className="w-3 h-3 mr-1" />
                    )}
                    Get substitutions
                  </Button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {missingIngredients.map((ing, idx) => (
                <Badge key={idx} variant="outline" className="text-xs bg-background">
                  {ing}
                </Badge>
              ))}
            </div>
            {substitutions && substitutions.length > 0 && (
              <div className="mt-2 space-y-1">
                <span className="text-xs font-medium flex items-center gap-1 text-primary">
                  <Sparkles className="w-3 h-3" /> Substitution ideas:
                </span>
                {substitutions.map((sub, idx) => (
                  <div key={idx} className="text-xs text-muted-foreground">
                    <span className="font-medium">{sub.ingredient}:</span>{' '}
                    {sub.suggestions.join(', ')}
                    {sub.notes && <span className="italic ml-1">({sub.notes})</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({ type }: { type: 'no-pantry' | 'no-matches' }) {
  if (type === 'no-pantry') {
    return (
      <div className="text-center py-12">
        <Package className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Your pantry is empty</h2>
        <p className="text-muted-foreground mb-6 max-w-md mx-auto">
          Add items to your pantry to see which recipes you can make with ingredients you already have.
        </p>
        <Button asChild data-testid="button-go-to-pantry">
          <Link href="/pantry">
            <ShoppingBag className="w-4 h-4 mr-2" />
            Go to Pantry
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="text-center py-12">
      <AlertCircle className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
      <h2 className="text-xl font-semibold mb-2">No matching recipes</h2>
      <p className="text-muted-foreground mb-6 max-w-md mx-auto">
        Try adding more items to your pantry or adjusting your dietary preferences in settings.
      </p>
      <div className="flex gap-3 justify-center flex-wrap">
        <Button asChild variant="outline" data-testid="button-add-more-items">
          <Link href="/pantry">Add more items</Link>
        </Button>
        <Button asChild data-testid="button-upload-recipe">
          <Link href="/">Browse recipes</Link>
        </Button>
        <Button asChild variant="default" data-testid="button-ai-create">
          <Link href="/recipe-creator">
            <Sparkles className="w-4 h-4 mr-2" />
            Create with AI
          </Link>
        </Button>
      </div>
    </div>
  );
}

function applyFilters(
  recipes: RecipeMatch[],
  {
    cuisineFilter,
    maxCookTime,
    missingOneOnly,
    expiringOnly,
  }: {
    cuisineFilter: string | null;
    maxCookTime: number | null;
    missingOneOnly: boolean;
    expiringOnly: boolean;
  }
): RecipeMatch[] {
  return recipes.filter((m) => {
    if (cuisineFilter && m.recipe.cuisine !== cuisineFilter) return false;

    const cook = m.totalCookTime ?? ((m.recipe.prepTime ?? 0) + (m.recipe.cookTime ?? 0));
    if (maxCookTime !== null) {
      if (maxCookTime === 30 && cook >= 30) return false;
      if (maxCookTime === 60 && (cook < 30 || cook > 60)) return false;
    }

    if (missingOneOnly && m.missingIngredients.length !== 1) return false;
    if (expiringOnly && (!m.expiringItemsUsed || m.expiringItemsUsed <= 0)) return false;

    return true;
  });
}

function sortRecipes(recipes: RecipeMatch[], sortBy: 'match' | 'cookTime' | 'expiring'): RecipeMatch[] {
  const sorted = [...recipes];
  switch (sortBy) {
    case 'match':
      sorted.sort((a, b) => b.matchPercentage - a.matchPercentage);
      break;
    case 'cookTime': {
      const getCook = (m: RecipeMatch) => m.totalCookTime ?? ((m.recipe.prepTime ?? 0) + (m.recipe.cookTime ?? 0));
      sorted.sort((a, b) => getCook(a) - getCook(b));
      break;
    }
    case 'expiring':
      sorted.sort((a, b) => (b.expiringItemsUsed ?? 0) - (a.expiringItemsUsed ?? 0));
      break;
  }
  return sorted;
}

export default function WhatCanIMakePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('ready');

  // Sort & filter state
  const [sortBy, setSortBy] = useState<'match' | 'cookTime' | 'expiring'>('match');
  const [cuisineFilter, setCuisineFilter] = useState<string | null>(null);
  const [maxCookTime, setMaxCookTime] = useState<number | null>(null);
  const [missingOneOnly, setMissingOneOnly] = useState(false);
  const [expiringOnly, setExpiringOnly] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useQuery<WhatCanIMakeResponse>({
    queryKey: ['/api/recipes/what-can-i-make', { sort: sortBy }],
    staleTime: 60000,
  });

  const addMissingMutation = useMutation({
    mutationFn: async ({ recipeId, missingIngredients }: { recipeId: string; missingIngredients: string[] }) => {
      return apiRequest('POST', `/api/recipes/${recipeId}/add-missing-to-grocery`, { missingIngredients });
    },
    onSuccess: (_, { missingIngredients }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/grocery-list'] });
      queryClient.invalidateQueries({ queryKey: ['/api/grocery-list/by-aisle'] });
      toast({ title: 'Added to grocery list', description: `${missingIngredients.length} missing ingredient${missingIngredients.length > 1 ? 's' : ''} added` });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to add items', variant: 'destructive' });
    },
  });

  const filtersActive = cuisineFilter !== null || maxCookTime !== null || missingOneOnly || expiringOnly;

  const clearFilters = () => {
    setCuisineFilter(null);
    setMaxCookTime(null);
    setMissingOneOnly(false);
    setExpiringOnly(false);
  };

  const filterOpts = { cuisineFilter, maxCookTime, missingOneOnly, expiringOnly };

  // Client-side filtering & sorting
  const { filteredReady, filteredAlmost, filteredMore } = useMemo(() => {
    const { readyToCook = [], almostReady = [], needMoreIngredients = [] } = data || {};
    return {
      filteredReady: sortRecipes(applyFilters(readyToCook, filterOpts), sortBy),
      filteredAlmost: sortRecipes(applyFilters(almostReady, filterOpts), sortBy),
      filteredMore: sortRecipes(applyFilters(needMoreIngredients, filterOpts), sortBy),
    };
  }, [data, sortBy, cuisineFilter, maxCookTime, missingOneOnly, expiringOnly]);

  const { readyToCook = [], almostReady = [], needMoreIngredients = [] } = data || {};

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto text-primary mb-4" />
          <p className="text-muted-foreground">Analyzing your pantry...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-16 h-16 mx-auto text-destructive mb-4" />
        <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
        <p className="text-muted-foreground mb-6">Failed to load recipe suggestions</p>
        <Button onClick={() => refetch()} data-testid="button-retry">
          <RefreshCw className="w-4 h-4 mr-2" />
          Try again
        </Button>
      </div>
    );
  }

  if (data?.message && data.pantryItemCount === undefined) {
    return <EmptyState type="no-pantry" />;
  }

  const totalMatches = readyToCook.length + almostReady.length + needMoreIngredients.length;

  if (totalMatches === 0) {
    return <EmptyState type="no-matches" />;
  }

  const totalFiltered = filteredReady.length + filteredAlmost.length + filteredMore.length;

  // Tab label helpers
  const tabLabel = (label: string, filtered: number, total: number) => {
    if (filtersActive) {
      return `${label} (${filtered}/${total})`;
    }
    return `${label} (${total})`;
  };

  const handleAddMissing = (recipeId: string, missingIngredients: string[]) => {
    addMissingMutation.mutate({ recipeId, missingIngredients });
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ChefHat className="w-7 h-7" />
            What Can I Make?
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data?.pantryItemCount} items in your pantry
            {data?.appliedFilters?.dietaryRestrictions?.length ? (
              <> · Filtered by: {data.appliedFilters.dietaryRestrictions.join(', ')}</>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" data-testid="button-ai-create-header">
            <Link href="/recipe-creator">
              <Sparkles className="w-4 h-4 mr-1" />
              Create
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Sort & Filter Controls */}
      <div className="mb-4 space-y-3">
        <div className="flex items-center gap-3">
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as 'match' | 'cookTime' | 'expiring')}>
            <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="sort-select">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="match">Best Match</SelectItem>
              <SelectItem value="cookTime">Quickest</SelectItem>
              <SelectItem value="expiring">Uses Expiring</SelectItem>
            </SelectContent>
          </Select>
          {filtersActive && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters} data-testid="button-clear-filters">
              <X className="w-3 h-3 mr-1" />
              Clear filters
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={missingOneOnly ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setMissingOneOnly(!missingOneOnly)}
            data-testid="filter-missing-one"
          >
            Missing 1
          </Button>
          <Button
            variant={maxCookTime === 30 ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setMaxCookTime(maxCookTime === 30 ? null : 30)}
            data-testid="filter-under-30"
          >
            &lt; 30 min
          </Button>
          <Button
            variant={maxCookTime === 60 ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setMaxCookTime(maxCookTime === 60 ? null : 60)}
            data-testid="filter-30-60"
          >
            30-60 min
          </Button>
          <Button
            variant={expiringOnly ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setExpiringOnly(!expiringOnly)}
            data-testid="filter-expiring"
          >
            Expiring
          </Button>
          {data?.availableCuisines?.map((cuisine) => (
            <Button
              key={cuisine}
              variant={cuisineFilter === cuisine ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setCuisineFilter(cuisineFilter === cuisine ? null : cuisine)}
              data-testid={`filter-cuisine-${cuisine.toLowerCase()}`}
            >
              {cuisine}
            </Button>
          ))}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full grid grid-cols-3 mb-4">
          <TabsTrigger value="ready" className="text-xs sm:text-sm" data-testid="tab-ready-to-cook">
            {tabLabel('Ready', filteredReady.length, readyToCook.length)}
          </TabsTrigger>
          <TabsTrigger value="almost" className="text-xs sm:text-sm" data-testid="tab-almost-ready">
            {tabLabel('Almost', filteredAlmost.length, almostReady.length)}
          </TabsTrigger>
          <TabsTrigger value="more" className="text-xs sm:text-sm" data-testid="tab-need-more">
            {tabLabel('Need More', filteredMore.length, needMoreIngredients.length)}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ready" className="space-y-3 mt-0">
          {filteredReady.length === 0 ? (
            filtersActive && readyToCook.length > 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No recipes match your filters</p>
                <Button variant="ghost" className="mt-2" onClick={clearFilters} data-testid="button-clear-filters-ready">
                  Clear filters
                </Button>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>No recipes you can make with current pantry items.</p>
                <p className="text-sm mt-1">Check the "Almost Ready" tab for recipes missing just 1-2 ingredients!</p>
              </div>
            )
          ) : (
            filteredReady.map((match) => (
              <RecipeCard key={match.recipe.id} match={match} onAddMissing={handleAddMissing} isAddingMissing={addMissingMutation.isPending} />
            ))
          )}
        </TabsContent>

        <TabsContent value="almost" className="space-y-3 mt-0">
          {filteredAlmost.length === 0 ? (
            filtersActive && almostReady.length > 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No recipes match your filters</p>
                <Button variant="ghost" className="mt-2" onClick={clearFilters} data-testid="button-clear-filters-almost">
                  Clear filters
                </Button>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>No recipes missing just 1-2 ingredients.</p>
              </div>
            )
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-3">
                These recipes are missing just 1-2 ingredients. Click "Get substitutions" to see what you could use instead!
              </p>
              {filteredAlmost.map((match) => (
                <RecipeCard key={match.recipe.id} match={match} showSubstitutions onAddMissing={handleAddMissing} isAddingMissing={addMissingMutation.isPending} />
              ))}
            </>
          )}
        </TabsContent>

        <TabsContent value="more" className="space-y-3 mt-0">
          {filteredMore.length === 0 ? (
            filtersActive && needMoreIngredients.length > 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No recipes match your filters</p>
                <Button variant="ghost" className="mt-2" onClick={clearFilters} data-testid="button-clear-filters-more">
                  Clear filters
                </Button>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>No additional recipe suggestions.</p>
              </div>
            )
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-3">
                You have at least half the ingredients for these recipes.
              </p>
              {filteredMore.map((match) => (
                <RecipeCard key={match.recipe.id} match={match} showSubstitutions onAddMissing={handleAddMissing} isAddingMissing={addMissingMutation.isPending} />
              ))}
            </>
          )}
        </TabsContent>
      </Tabs>

      <div className="mt-8 pt-6 border-t">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            <Link href="/settings" className="text-primary hover:underline">
              Manage dietary preferences
            </Link>
            {' · '}
            <Link href="/pantry" className="text-primary hover:underline">
              Update pantry
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
