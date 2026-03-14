import { useUploadProgress, type RecipeProgress } from '@/contexts/UploadProgressContext';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { X, ChevronDown, ChevronUp, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';

export function ConsolidatedProgressBanner() {
  const { activeRecipes, dismissRecipe } = useUploadProgress();
  const [isExpanded, setIsExpanded] = useState(false);
  const [, navigate] = useLocation();

  // Calculate overall stats
  const total = activeRecipes.length;
  const completed = activeRecipes.filter(r => r.phase === 'ready').length;
  const failed = activeRecipes.filter(r => r.phase === 'failed').length;
  const processing = total - completed - failed;

  // Calculate overall progress (average of all recipes)
  const overallProgress = activeRecipes.length > 0 
    ? Math.round(activeRecipes.reduce((sum, r) => sum + r.progress, 0) / total)
    : 0;

  // Determine overall status
  const allComplete = completed === total;
  const allFailed = failed === total;
  const hasFailures = failed > 0;

  // Auto-dismiss after delay when all complete (in useEffect to avoid side-effects in render)
  useEffect(() => {
    if (allComplete && !isExpanded && activeRecipes.length > 0) {
      const timer = setTimeout(() => {
        activeRecipes.forEach(r => dismissRecipe(r.recipeId));
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [allComplete, isExpanded, activeRecipes, dismissRecipe]);

  if (activeRecipes.length === 0) return null;

  const handleDismissAll = () => {
    activeRecipes.forEach(r => dismissRecipe(r.recipeId));
  };

  const handleRecipeClick = (recipeId: string) => {
    navigate(`/recipe/${recipeId}`);
  };

  const getStatusIcon = (recipe: RecipeProgress) => {
    if (recipe.phase === 'ready') {
      return <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />;
    }
    if (recipe.phase === 'failed') {
      return <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />;
    }
    return <Loader2 className="h-4 w-4 text-primary animate-spin flex-shrink-0" />;
  };

  const getPhaseText = (phase: RecipeProgress['phase']) => {
    switch (phase) {
      case 'extracting': return 'Extracting';
      case 'enriching': return 'Enriching';
      case 'generating': return 'Generating image';
      case 'ready': return 'Complete';
      case 'failed': return 'Failed';
    }
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-50 p-4 pointer-events-none">
      <Card className="max-w-2xl mx-auto pointer-events-auto shadow-lg">
        <div className="p-4 space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0 flex items-center gap-2">
              {allComplete && <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />}
              {allFailed && <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />}
              {!allComplete && !allFailed && <Loader2 className="h-4 w-4 text-primary animate-spin flex-shrink-0" />}
              <h3 className="font-semibold text-sm">
                {allComplete && 'All recipes ready!'}
                {allFailed && 'All recipes failed'}
                {!allComplete && !allFailed && (
                  <>
                    {processing > 0 && `Processing ${processing} ${processing === 1 ? 'recipe' : 'recipes'}`}
                    {completed > 0 && ` • ${completed} of ${total} complete`}
                    {hasFailures && ` • ${failed} failed`}
                  </>
                )}
              </h3>
            </div>

            <div className="flex items-center gap-2">
              {activeRecipes.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setIsExpanded(!isExpanded)}
                  data-testid="button-toggle-details"
                >
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleDismissAll}
                data-testid="button-dismiss-all"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Progress Bar */}
          <Progress value={overallProgress} className="h-2" data-testid="progress-overall" />

          {/* Compact Recipe List (always visible) */}
          <div className="flex flex-wrap gap-2">
            {activeRecipes.slice(0, isExpanded ? undefined : 3).map((recipe) => (
              <button
                key={recipe.recipeId}
                onClick={() => handleRecipeClick(recipe.recipeId)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted hover-elevate active-elevate-2 text-sm max-w-xs"
                data-testid={`recipe-item-${recipe.recipeId}`}
              >
                {getStatusIcon(recipe)}
                <span className="truncate">{recipe.title}</span>
                {recipe.phase !== 'ready' && recipe.phase !== 'failed' && (
                  <span className="text-xs text-muted-foreground">
                    {recipe.progress}%
                  </span>
                )}
              </button>
            ))}
            {!isExpanded && activeRecipes.length > 3 && (
              <button
                onClick={() => setIsExpanded(true)}
                className="px-3 py-1.5 rounded-md bg-muted hover-elevate text-sm text-muted-foreground"
                data-testid="button-show-more"
              >
                +{activeRecipes.length - 3} more
              </button>
            )}
          </div>

          {/* Expanded Details */}
          {isExpanded && activeRecipes.length > 3 && (
            <div className="space-y-2 pt-2 border-t max-h-48 overflow-y-auto">
              {activeRecipes.map((recipe) => (
                <button
                  key={recipe.recipeId}
                  onClick={() => handleRecipeClick(recipe.recipeId)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md hover-elevate active-elevate-2 text-sm"
                  data-testid={`recipe-detail-${recipe.recipeId}`}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {getStatusIcon(recipe)}
                    <span className="truncate font-medium">{recipe.title}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {recipe.phase !== 'ready' && recipe.phase !== 'failed' && (
                      <Progress value={recipe.progress} className="h-1.5 w-16" />
                    )}
                    <span className="text-xs text-muted-foreground min-w-20 text-right">
                      {getPhaseText(recipe.phase)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
