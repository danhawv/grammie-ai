import { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Recipe } from '@shared/schema';

export type EnrichmentPhase = 'extracting' | 'enriching' | 'generating' | 'ready' | 'failed';

export interface RecipeProgress {
  recipeId: string;
  title: string;
  phase: EnrichmentPhase;
  progress: number; // 0-100
  startedAt: number; // timestamp
  completedAt?: number;
  error?: string;
  dismissed: boolean;
}

type ProgressAction =
  | { type: 'ADD_RECIPE'; payload: { recipeId: string; title: string } }
  | { type: 'UPDATE_RECIPE'; payload: { recipeId: string; phase: EnrichmentPhase; progress: number; title?: string; error?: string } }
  | { type: 'COMPLETE_RECIPE'; payload: { recipeId: string } }
  | { type: 'DISMISS_RECIPE'; payload: { recipeId: string } }
  | { type: 'HYDRATE'; payload: RecipeProgress[] };

interface ProgressState {
  recipes: Record<string, RecipeProgress>;
}

const SESSION_STORAGE_KEY = 'recipe-upload-progress';

function progressReducer(state: ProgressState, action: ProgressAction): ProgressState {
  switch (action.type) {
    case 'ADD_RECIPE': {
      const newRecipe: RecipeProgress = {
        recipeId: action.payload.recipeId,
        title: action.payload.title,
        phase: 'extracting',
        progress: 10, // Start with some progress to show activity
        startedAt: Date.now(),
        dismissed: false,
      };
      return {
        ...state,
        recipes: { ...state.recipes, [action.payload.recipeId]: newRecipe },
      };
    }

    case 'UPDATE_RECIPE': {
      const existing = state.recipes[action.payload.recipeId];
      if (!existing) return state;

      return {
        ...state,
        recipes: {
          ...state.recipes,
          [action.payload.recipeId]: {
            ...existing,
            phase: action.payload.phase,
            progress: action.payload.progress,
            title: action.payload.title ?? existing.title, // Update title if provided
            error: action.payload.error,
          },
        },
      };
    }

    case 'COMPLETE_RECIPE': {
      const existing = state.recipes[action.payload.recipeId];
      if (!existing) return state;

      return {
        ...state,
        recipes: {
          ...state.recipes,
          [action.payload.recipeId]: {
            ...existing,
            phase: 'ready',
            progress: 100,
            completedAt: Date.now(),
          },
        },
      };
    }

    case 'DISMISS_RECIPE': {
      const existing = state.recipes[action.payload.recipeId];
      if (!existing) return state;

      return {
        ...state,
        recipes: {
          ...state.recipes,
          [action.payload.recipeId]: {
            ...existing,
            dismissed: true,
          },
        },
      };
    }

    case 'HYDRATE': {
      const recipes: Record<string, RecipeProgress> = {};
      action.payload.forEach((recipe) => {
        recipes[recipe.recipeId] = recipe;
      });
      return { recipes };
    }

    default:
      return state;
  }
}

interface UploadProgressContextValue {
  activeRecipes: RecipeProgress[];
  addRecipe: (recipeId: string, title: string) => void;
  updateRecipe: (recipeId: string, phase: EnrichmentPhase, progress: number, error?: string) => void;
  completeRecipe: (recipeId: string) => void;
  dismissRecipe: (recipeId: string) => void;
}

const UploadProgressContext = createContext<UploadProgressContextValue | null>(null);

export function UploadProgressProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(progressReducer, { recipes: {} });

  // Hydrate from sessionStorage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      try {
        const recipes: RecipeProgress[] = JSON.parse(stored);
        dispatch({ type: 'HYDRATE', payload: recipes });
      } catch (e) {
        console.error('Failed to hydrate progress from sessionStorage:', e);
      }
    }
  }, []);

  // Persist to sessionStorage on state changes
  useEffect(() => {
    const activeRecipes = Object.values(state.recipes);
    if (activeRecipes.length > 0) {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(activeRecipes));
    } else {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, [state.recipes]);

  // Poll for updates on active recipes (not ready/failed/dismissed)
  const activeRecipeIds = Object.values(state.recipes)
    .filter((r) => !r.dismissed && r.phase !== 'ready' && r.phase !== 'failed')
    .map((r) => r.recipeId);

  useQuery({
    queryKey: ['/api/recipes/progress', activeRecipeIds],
    enabled: activeRecipeIds.length > 0,
    refetchInterval: 3000, // Poll every 3 seconds
    queryFn: async () => {
      // Fetch all active recipes in parallel
      const results = await Promise.all(
        activeRecipeIds.map(async (id) => {
          const res = await fetch(`/api/recipes/${id}`);
          if (!res.ok) return null;
          return (await res.json()) as Recipe;
        })
      );

      // Update state for each recipe
      results.forEach((recipe) => {
        if (!recipe) return;

        const currentProgress = state.recipes[recipe.id];
        if (!currentProgress || currentProgress.dismissed) return;

        // Map status to phase and progress (0-33-66-100% checkpoints)
        let phase: EnrichmentPhase;
        let progress: number;

        if (recipe.enrichmentStatus === 'extracting') {
          // Phase 1: Extracting (0-33%)
          phase = 'extracting';
          progress = 15; // Midpoint of phase 1
        } else if (recipe.enrichmentStatus === 'enriching') {
          // Phase 2: Enriching (33-66%)
          phase = 'enriching';
          progress = 50; // Midpoint of phase 2
        } else if (recipe.enrichmentStatus === 'ready' && recipe.imageGenerationStatus === 'pending') {
          // Enrichment done, waiting for image generation
          phase = 'enriching';
          progress = 66; // End of phase 2, start of phase 3
        } else if (recipe.imageGenerationStatus === 'generating') {
          // Phase 3: Generating image (66-100%)
          phase = 'generating';
          progress = 83; // Midpoint of phase 3
        } else if (recipe.enrichmentStatus === 'ready' && recipe.imageGenerationStatus === 'ready') {
          // All done! Always update to ensure we have the best title before completing
          const hasRealTitle = recipe.title && recipe.title.trim() && recipe.title !== "Your Recipe";
          const bestTitle = hasRealTitle ? recipe.title : currentProgress.title;
          
          // Always update phase/progress/title before completing to ensure consistency
          dispatch({ 
            type: 'UPDATE_RECIPE', 
            payload: { 
              recipeId: recipe.id, 
              phase: 'ready', 
              progress: 100,
              title: bestTitle, // Ensure title is preserved
            } 
          });
          dispatch({ type: 'COMPLETE_RECIPE', payload: { recipeId: recipe.id } });
          return;
        } else if (recipe.enrichmentStatus === 'failed' || recipe.imageGenerationStatus === 'failed') {
          phase = 'failed';
          progress = currentProgress.progress; // Keep current progress
          const error = recipe.enrichmentError || recipe.imageGenerationError || 'Enrichment failed';
          
          // Prefer actual recipe title over placeholder
          const hasRealTitle = recipe.title && recipe.title.trim() && recipe.title !== "Your Recipe";
          const bestTitle = hasRealTitle ? recipe.title : currentProgress.title;
          
          dispatch({ 
            type: 'UPDATE_RECIPE', 
            payload: { 
              recipeId: recipe.id, 
              phase, 
              progress, 
              title: bestTitle, // Ensure title is preserved
              error 
            } 
          });
          return;
        } else {
          // Default fallback
          phase = currentProgress.phase;
          progress = currentProgress.progress;
        }

        // Only update if phase, progress, or title changed
        // Prefer actual recipe title over placeholder, but keep existing non-placeholder if new one is empty
        const hasRealTitle = recipe.title && recipe.title.trim() && recipe.title !== "Your Recipe";
        const hasExistingRealTitle = currentProgress.title && currentProgress.title !== "Your Recipe";
        
        // Choose best available title
        const bestTitle = hasRealTitle 
          ? recipe.title 
          : (hasExistingRealTitle ? currentProgress.title : (recipe.title || currentProgress.title));
        
        const titleChanged = bestTitle && bestTitle !== currentProgress.title;
        
        if (phase !== currentProgress.phase || progress > currentProgress.progress || titleChanged) {
          dispatch({ 
            type: 'UPDATE_RECIPE', 
            payload: { 
              recipeId: recipe.id, 
              phase, 
              progress,
              title: bestTitle, // Always pass a valid title
            } 
          });
        }
      });

      return results;
    },
  });

  const activeRecipes = Object.values(state.recipes)
    .filter((r) => !r.dismissed)
    .sort((a, b) => b.startedAt - a.startedAt); // Most recent first

  const value: UploadProgressContextValue = {
    activeRecipes,
    addRecipe: (recipeId: string, title: string) => {
      dispatch({ type: 'ADD_RECIPE', payload: { recipeId, title } });
    },
    updateRecipe: (recipeId: string, phase: EnrichmentPhase, progress: number, error?: string) => {
      dispatch({ type: 'UPDATE_RECIPE', payload: { recipeId, phase, progress, error } });
    },
    completeRecipe: (recipeId: string) => {
      dispatch({ type: 'COMPLETE_RECIPE', payload: { recipeId } });
    },
    dismissRecipe: (recipeId: string) => {
      dispatch({ type: 'DISMISS_RECIPE', payload: { recipeId } });
    },
  };

  return <UploadProgressContext.Provider value={value}>{children}</UploadProgressContext.Provider>;
}

export function useUploadProgress() {
  const context = useContext(UploadProgressContext);
  if (!context) {
    throw new Error('useUploadProgress must be used within UploadProgressProvider');
  }
  return context;
}
