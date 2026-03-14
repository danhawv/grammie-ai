import { useUploadProgress, type RecipeProgress } from '@/contexts/UploadProgressContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { X, CheckCircle2, AlertCircle, Loader2, ArrowLeft, Sparkles } from 'lucide-react';
import { useLocation, Link } from 'wouter';
import grandmaImage from "@assets/image_1763329917086.png";

export default function Processing() {
  const { activeRecipes, dismissRecipe } = useUploadProgress();
  const [, navigate] = useLocation();

  const total = activeRecipes.length;
  const completed = activeRecipes.filter(r => r.phase === 'ready').length;
  const failed = activeRecipes.filter(r => r.phase === 'failed').length;
  const processing = total - completed - failed;

  const overallProgress = activeRecipes.length > 0 
    ? Math.round(activeRecipes.reduce((sum, r) => sum + r.progress, 0) / total)
    : 0;

  const getStatusIcon = (recipe: RecipeProgress) => {
    if (recipe.phase === 'ready') {
      return <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />;
    }
    if (recipe.phase === 'failed') {
      return <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />;
    }
    return <Loader2 className="h-5 w-5 text-primary animate-spin flex-shrink-0" />;
  };

  const getPhaseText = (phase: RecipeProgress['phase']) => {
    switch (phase) {
      case 'extracting': return 'Extracting recipe details...';
      case 'enriching': return 'Enriching with AI magic...';
      case 'generating': return 'Generating dish image...';
      case 'ready': return 'Complete!';
      case 'failed': return 'Failed';
    }
  };

  const handleRecipeClick = (recipeId: string) => {
    navigate(`/recipe/${recipeId}`);
  };

  const handleDismissAll = () => {
    activeRecipes.forEach(r => dismissRecipe(r.recipeId));
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-8">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back-home">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <Sparkles className="h-6 w-6 text-primary" />
            <h1 className="font-serif text-3xl font-bold" data-testid="text-processing-title">
              Processing Recipes
            </h1>
          </div>
        </div>

        {activeRecipes.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <div className="flex flex-col items-center gap-4">
                <img 
                  src={grandmaImage} 
                  alt="Grammie" 
                  className="w-24 h-24 rounded-full object-cover border-4 border-primary/20"
                />
                <div>
                  <h3 className="text-lg font-semibold mb-2" data-testid="text-no-processing">
                    No recipes processing
                  </h3>
                  <p className="text-muted-foreground">
                    Upload some recipes and Grammie will work her magic!
                  </p>
                </div>
                <Link href="/">
                  <Button data-testid="button-browse-recipes">
                    Browse Recipes
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="mb-6">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-3">
                    <img 
                      src={grandmaImage} 
                      alt="Grammie" 
                      className="w-10 h-10 rounded-full object-cover"
                    />
                    <span data-testid="text-overall-status">
                      {processing > 0 && `Processing ${processing} ${processing === 1 ? 'recipe' : 'recipes'}`}
                      {processing > 0 && completed > 0 && ' • '}
                      {completed > 0 && `${completed} of ${total} complete`}
                      {failed > 0 && ` • ${failed} failed`}
                      {processing === 0 && completed === total && 'All done!'}
                    </span>
                  </CardTitle>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={handleDismissAll}
                    data-testid="button-dismiss-all"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Clear All
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Progress value={overallProgress} className="h-3" data-testid="progress-overall" />
                <p className="text-sm text-muted-foreground mt-2 text-right">
                  {overallProgress}% overall
                </p>
              </CardContent>
            </Card>

            <div className="space-y-3">
              {activeRecipes.map((recipe) => (
                <Card 
                  key={recipe.recipeId}
                  className="hover-elevate cursor-pointer"
                  onClick={() => handleRecipeClick(recipe.recipeId)}
                  data-testid={`card-recipe-${recipe.recipeId}`}
                >
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {getStatusIcon(recipe)}
                        <div className="min-w-0 flex-1">
                          <h3 className="font-medium truncate" data-testid={`text-recipe-title-${recipe.recipeId}`}>
                            {recipe.title}
                          </h3>
                          <p className="text-sm text-muted-foreground" data-testid={`text-recipe-phase-${recipe.recipeId}`}>
                            {getPhaseText(recipe.phase)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {recipe.phase !== 'ready' && recipe.phase !== 'failed' && (
                          <div className="flex items-center gap-2">
                            <Progress value={recipe.progress} className="h-2 w-20" />
                            <span className="text-sm text-muted-foreground w-10 text-right">
                              {recipe.progress}%
                            </span>
                          </div>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            dismissRecipe(recipe.recipeId);
                          }}
                          data-testid={`button-dismiss-${recipe.recipeId}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
