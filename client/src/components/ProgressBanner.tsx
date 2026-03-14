import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { X, ChefHat, Sparkles, Camera, Check } from 'lucide-react';
import { useUploadProgress, type RecipeProgress } from '@/contexts/UploadProgressContext';
import { cn } from '@/lib/utils';

interface ProgressBannerProps {
  recipe: RecipeProgress;
}

export function ProgressBanner({ recipe }: ProgressBannerProps) {
  const { dismissRecipe } = useUploadProgress();
  const [, navigate] = useLocation();
  const [isAnimating, setIsAnimating] = useState(false);

  // Trigger enter animation
  useEffect(() => {
    setIsAnimating(true);
  }, []);

  // Auto-dismiss completed recipes after 10 seconds
  useEffect(() => {
    if (recipe.phase === 'ready' && recipe.completedAt) {
      const timeout = setTimeout(() => {
        handleDismiss();
      }, 10000);
      return () => clearTimeout(timeout);
    }
  }, [recipe.phase, recipe.completedAt]);

  const handleDismiss = () => {
    setIsAnimating(false);
    setTimeout(() => {
      dismissRecipe(recipe.recipeId);
    }, 300); // Wait for exit animation
  };

  const handleClick = () => {
    if (recipe.phase === 'ready') {
      navigate(`/recipe/${recipe.recipeId}`);
      handleDismiss();
    }
  };

  // Determine color scheme based on phase
  const getColorScheme = () => {
    if (recipe.phase === 'failed') {
      return {
        bg: 'bg-destructive/90',
        text: 'text-destructive-foreground',
        progressBg: 'bg-destructive-foreground/20',
        progressFill: 'bg-destructive-foreground',
      };
    } else if (recipe.phase === 'ready') {
      return {
        bg: 'bg-green-600/90',
        text: 'text-white',
        progressBg: 'bg-white/20',
        progressFill: 'bg-white',
      };
    } else {
      return {
        bg: 'bg-orange-600/90',
        text: 'text-white',
        progressBg: 'bg-white/20',
        progressFill: 'bg-white',
      };
    }
  };

  const colors = getColorScheme();

  // Get phase icon and message
  const getPhaseInfo = () => {
    switch (recipe.phase) {
      case 'extracting':
        return {
          icon: <ChefHat className="h-4 w-4" />,
          message: 'Grandma is reading your recipe...',
        };
      case 'enriching':
        return {
          icon: <Sparkles className="h-4 w-4" />,
          message: 'Adding 50+ magical details...',
        };
      case 'generating':
        return {
          icon: <Camera className="h-4 w-4" />,
          message: 'Taking a beautiful photo of the dish...',
        };
      case 'ready':
        return {
          icon: <Check className="h-4 w-4" />,
          message: 'Your recipe is ready! Click to view.',
        };
      case 'failed':
        return {
          icon: <X className="h-4 w-4" />,
          message: recipe.error || 'Something went wrong. Please try again.',
        };
    }
  };

  const phaseInfo = getPhaseInfo();

  return (
    <div
      className={cn(
        'transition-all duration-300 ease-in-out backdrop-blur-sm pointer-events-auto',
        isAnimating ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'
      )}
    >
      <div
        className={cn(
          'w-full shadow-lg border-b cursor-pointer',
          colors.bg,
          colors.text,
          recipe.phase === 'ready' && 'hover-elevate'
        )}
        onClick={handleClick}
        data-testid={`progress-banner-${recipe.recipeId}`}
      >
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center gap-4">
            {/* Phase Icon */}
            <div className="flex-shrink-0">{phaseInfo.icon}</div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-4 mb-1">
                <h3 className="font-medium truncate" data-testid={`progress-title-${recipe.recipeId}`}>
                  {recipe.title}
                </h3>
                <Button
                  size="icon"
                  variant="ghost"
                  className={cn('h-6 w-6 flex-shrink-0', colors.text)}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDismiss();
                  }}
                  data-testid={`button-dismiss-${recipe.recipeId}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <p className="text-sm opacity-90 mb-2" data-testid={`progress-message-${recipe.recipeId}`}>
                {phaseInfo.message}
              </p>

              {/* Progress Bar */}
              <div className={cn('h-2 rounded-full overflow-hidden', colors.progressBg)}>
                <div
                  className={cn(
                    'h-full transition-all duration-500 ease-out rounded-full',
                    colors.progressFill
                  )}
                  style={{ width: `${recipe.progress}%` }}
                  data-testid={`progress-bar-${recipe.recipeId}`}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
