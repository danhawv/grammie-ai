import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { 
  ChefHat, 
  Package, 
  Clock, 
  Users, 
  ArrowRight, 
  Sparkles, 
  ShoppingBag,
  Loader2,
  RefreshCw,
  AlertCircle,
  Lightbulb
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
}

function RecipeCard({ match, showSubstitutions = false }: { match: RecipeMatch; showSubstitutions?: boolean }) {
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

  const { recipe, matchedIngredients, missingIngredients, matchPercentage } = match;

  return (
    <Card className="hover-elevate overflow-hidden" data-testid={`recipe-card-${recipe.id}`}>
      <CardContent className="p-0">
        <Link href={`/recipe/${recipe.id}`}>
          <div className="flex gap-3 p-3">
            {recipe.dishImage && !recipe.dishImage.startsWith('data:image/svg') ? (
              <img
                src={recipe.dishImage}
                alt={recipe.dishName}
                className="w-20 h-20 rounded-md object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-20 h-20 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                <img src={grammieImage} alt="Grammie" className="w-10 h-10 object-contain opacity-50" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-sm line-clamp-2">{recipe.dishName}</h3>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                {recipe.prepTime && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {recipe.prepTime + (recipe.cookTime || 0)} min
                  </span>
                )}
                {recipe.servings && (
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {recipe.servings}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant={matchPercentage === 100 ? "default" : "secondary"} className="text-xs">
                  {matchPercentage}% match
                </Badge>
                {recipe.cuisine && (
                  <Badge variant="outline" className="text-xs">
                    {recipe.cuisine}
                  </Badge>
                )}
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground self-center flex-shrink-0" />
          </div>
        </Link>
        
        {missingIngredients.length > 0 && showSubstitutions && (
          <div className="border-t px-3 py-2 bg-muted/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">
                Missing {missingIngredients.length} ingredient{missingIngredients.length > 1 ? 's' : ''}
              </span>
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
      <div className="flex gap-3 justify-center">
        <Button asChild variant="outline" data-testid="button-add-more-items">
          <Link href="/pantry">Add more items</Link>
        </Button>
        <Button asChild data-testid="button-upload-recipe">
          <Link href="/">Browse recipes</Link>
        </Button>
      </div>
    </div>
  );
}

export default function WhatCanIMakePage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('ready');

  const { data, isLoading, error, refetch, isFetching } = useQuery<WhatCanIMakeResponse>({
    queryKey: ['/api/recipes/what-can-i-make'],
    staleTime: 60000,
  });

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

  const { readyToCook = [], almostReady = [], needMoreIngredients = [] } = data || {};
  const totalMatches = readyToCook.length + almostReady.length + needMoreIngredients.length;

  if (totalMatches === 0) {
    return <EmptyState type="no-matches" />;
  }

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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full grid grid-cols-3 mb-4">
          <TabsTrigger value="ready" className="text-xs sm:text-sm" data-testid="tab-ready-to-cook">
            Ready ({readyToCook.length})
          </TabsTrigger>
          <TabsTrigger value="almost" className="text-xs sm:text-sm" data-testid="tab-almost-ready">
            Almost ({almostReady.length})
          </TabsTrigger>
          <TabsTrigger value="more" className="text-xs sm:text-sm" data-testid="tab-need-more">
            Need More ({needMoreIngredients.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ready" className="space-y-3 mt-0">
          {readyToCook.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No recipes you can make with current pantry items.</p>
              <p className="text-sm mt-1">Check the "Almost Ready" tab for recipes missing just 1-2 ingredients!</p>
            </div>
          ) : (
            readyToCook.map((match) => (
              <RecipeCard key={match.recipe.id} match={match} />
            ))
          )}
        </TabsContent>

        <TabsContent value="almost" className="space-y-3 mt-0">
          {almostReady.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No recipes missing just 1-2 ingredients.</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-3">
                These recipes are missing just 1-2 ingredients. Click "Get substitutions" to see what you could use instead!
              </p>
              {almostReady.map((match) => (
                <RecipeCard key={match.recipe.id} match={match} showSubstitutions />
              ))}
            </>
          )}
        </TabsContent>

        <TabsContent value="more" className="space-y-3 mt-0">
          {needMoreIngredients.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No additional recipe suggestions.</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-3">
                You have at least half the ingredients for these recipes.
              </p>
              {needMoreIngredients.map((match) => (
                <RecipeCard key={match.recipe.id} match={match} showSubstitutions />
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
