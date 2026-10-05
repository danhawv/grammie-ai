import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  Sparkles,
  ChefHat,
  Clock,
  Users,
  Loader2,
  ShoppingCart,
  Save,
  Plus,
  X,
  ArrowLeft,
  Check,
  Mic,
  MicOff,
  ArrowRight,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useUploadProgress } from '@/contexts/UploadProgressContext';
import grammieImage from "@assets/image_1763329917086.png";

interface RecipeConcept {
  title: string;
  description: string;
  cuisine?: string;
  difficulty?: string;
  estimatedTimeMinutes: number;
  keyIngredients: string[];
  whyItWorks: string;
}

interface GeneratedRecipeSuggestion {
  title: string;
  description: string;
  cuisine?: string;
  difficulty?: string;
  servings: number;
  prepTimeMinutes: number;
  cookTimeMinutes: number;
  ingredients: string[];
  instructions: string[];
}

interface FullRecipeResponse {
  recipe: GeneratedRecipeSuggestion;
  matchedIngredients: string[];
  missingIngredients: string[];
  matchPercentage: number;
  pantryItemCount: number;
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

// Simple speech-to-text hook for a single field
function useSpeechInput(onResult: (text: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const toggle = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript || '';
      if (transcript.trim()) onResult(transcript.trim());
    };

    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening, onResult]);

  return { isListening, toggle };
}

export default function RecipeCreator() {
  const [, navigate] = useLocation();
  const { addRecipe } = useUploadProgress();
  const [prompt, setPrompt] = useState('');
  const [ingredientInput, setIngredientInput] = useState('');
  const [specifiedIngredients, setSpecifiedIngredients] = useState<string[]>([]);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [selectedConcept, setSelectedConcept] = useState<RecipeConcept | null>(null);
  const [savedRecipeId, setSavedRecipeId] = useState(false);
  const [addedToGrocery, setAddedToGrocery] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Speech-to-text for prompt field
  const promptSpeech = useSpeechInput(useCallback((text: string) => {
    setPrompt(prev => prev ? `${prev} ${text}` : text);
  }, []));

  // Speech-to-text for ingredients field — adds each spoken phrase as a chip
  const ingredientSpeech = useSpeechInput(useCallback((text: string) => {
    const items = text.split(/,|\band\b/i).map(s => s.trim()).filter(Boolean);
    setSpecifiedIngredients(prev => {
      const next = [...prev];
      for (const item of items) {
        if (!next.includes(item)) next.push(item);
      }
      return next;
    });
  }, []));

  // Fetch pantry items for autocomplete
  const { data: pantryItems } = useQuery<any[]>({
    queryKey: ['/api/pantry'],
  });

  const pantryNames = pantryItems?.map(p => p.name) || [];

  // Filter autocomplete suggestions
  const autocompleteSuggestions = ingredientInput.trim().length > 0
    ? pantryNames
        .filter(name =>
          name.toLowerCase().includes(ingredientInput.toLowerCase()) &&
          !specifiedIngredients.includes(name)
        )
        .slice(0, 6)
    : [];

  // Step 1: Suggest concepts mutation
  const conceptsMutation = useMutation({
    mutationFn: async (data: { prompt: string; specifiedIngredients?: string[] }) => {
      const res = await apiRequest('POST', '/api/recipes/suggest-concepts', data);
      return await res.json() as { concepts: RecipeConcept[]; pantryItemCount: number };
    },
    onSuccess: () => {
      setSelectedConcept(null);
      setSavedRecipeId(false);
      setAddedToGrocery(false);
    },
    onError: () => {
      toast({ title: 'Failed to generate ideas', description: 'Please try again.', variant: 'destructive' });
    },
  });

  // Step 2: Generate full recipe mutation
  const fullRecipeMutation = useMutation({
    mutationFn: async (concept: RecipeConcept) => {
      const res = await apiRequest('POST', '/api/recipes/generate-full-recipe', { concept });
      return await res.json() as FullRecipeResponse;
    },
    onError: () => {
      toast({ title: 'Failed to generate recipe', description: 'Please try again.', variant: 'destructive' });
    },
  });

  // Save recipe mutation
  const saveMutation = useMutation({
    mutationFn: async (recipe: GeneratedRecipeSuggestion) => {
      const res = await apiRequest('POST', '/api/recipes/save-generated', { recipe });
      return await res.json();
    },
    onSuccess: (saved: { id: string; title?: string }) => {
      setSavedRecipeId(true);
      queryClient.invalidateQueries({ queryKey: ['/api/recipes'] });
      // Grammie's draft is checked on the review screen before it's final (§6.2)
      addRecipe(saved.id, saved.title || 'Your Recipe', { kind: 'creator' });
      navigate(`/recipe/${saved.id}/review`);
    },
    onError: () => {
      toast({ title: 'Failed to save recipe', variant: 'destructive' });
    },
  });

  // Add missing to grocery mutation
  const addToGroceryMutation = useMutation({
    mutationFn: async (items: string[]) => {
      const res = await apiRequest('POST', '/api/recipes/add-items-to-grocery', { items });
      return await res.json();
    },
    onSuccess: (data) => {
      setAddedToGrocery(true);
      toast({ title: `Added ${data.added} items to grocery list` });
      queryClient.invalidateQueries({ queryKey: ['/api/grocery-list'] });
    },
    onError: () => {
      toast({ title: 'Failed to add items', variant: 'destructive' });
    },
  });

  const handleGenerate = () => {
    if (!prompt.trim()) return;
    conceptsMutation.mutate({
      prompt: prompt.trim(),
      specifiedIngredients: specifiedIngredients.length > 0 ? specifiedIngredients : undefined,
    });
  };

  const handleSelectConcept = (concept: RecipeConcept) => {
    setSelectedConcept(concept);
    setSavedRecipeId(false);
    setAddedToGrocery(false);
    fullRecipeMutation.mutate(concept);
  };

  const handleBackToConcepts = () => {
    setSelectedConcept(null);
    fullRecipeMutation.reset();
    setSavedRecipeId(false);
    setAddedToGrocery(false);
  };

  const addIngredient = (name: string) => {
    const trimmed = name.trim();
    if (trimmed && !specifiedIngredients.includes(trimmed)) {
      setSpecifiedIngredients(prev => [...prev, trimmed]);
    }
    setIngredientInput('');
    setShowAutocomplete(false);
    inputRef.current?.focus();
  };

  const removeIngredient = (name: string) => {
    setSpecifiedIngredients(prev => prev.filter(i => i !== name));
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-40 glass-regular border-b glass-border px-4 py-3">
        <div className="flex items-center gap-3 max-w-2xl mx-auto">
          <Link href="/what-can-i-make">
            <Button variant="ghost" size="icon" className="shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-semibold">Recipe Creator</h1>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
        {/* Input Section — hide when viewing full recipe */}
        {!selectedConcept && (
          <Card>
            <CardContent className="p-4 space-y-4">
              {/* Prompt input */}
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                  What do you want to make?
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    placeholder="broccoli cheddar soup, something with chicken thighs..."
                    onKeyDown={e => { if (e.key === 'Enter' && prompt.trim()) handleGenerate(); }}
                    className="text-base flex-1"
                  />
                  <Button
                    type="button"
                    variant={promptSpeech.isListening ? "destructive" : "outline"}
                    size="icon"
                    onClick={promptSpeech.toggle}
                    title={promptSpeech.isListening ? "Stop listening" : "Speak what you want to make"}
                    className="shrink-0"
                  >
                    {promptSpeech.isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              {/* Ingredient tags */}
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                  Ingredients to use (optional)
                </label>
                <div className="relative">
                  <div className="flex items-center gap-2">
                    <Input
                      ref={inputRef}
                      value={ingredientInput}
                      onChange={e => {
                        setIngredientInput(e.target.value);
                        setShowAutocomplete(true);
                      }}
                      onFocus={() => setShowAutocomplete(true)}
                      onBlur={() => setTimeout(() => setShowAutocomplete(false), 200)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && ingredientInput.trim()) {
                          e.preventDefault();
                          addIngredient(ingredientInput);
                        }
                      }}
                      placeholder="Type to search pantry items..."
                      className="flex-1"
                    />
                    {ingredientInput.trim() && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => addIngredient(ingredientInput)}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant={ingredientSpeech.isListening ? "destructive" : "outline"}
                      size="icon"
                      onClick={ingredientSpeech.toggle}
                      title={ingredientSpeech.isListening ? "Stop listening" : "Speak your ingredients"}
                      className="shrink-0"
                    >
                      {ingredientSpeech.isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </Button>
                  </div>

                  {/* Autocomplete dropdown */}
                  {showAutocomplete && autocompleteSuggestions.length > 0 && (
                    <div className="absolute z-50 top-full mt-1 w-full bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto">
                      {autocompleteSuggestions.map(name => (
                        <button
                          key={name}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                          onMouseDown={e => {
                            e.preventDefault();
                            addIngredient(name);
                          }}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Selected ingredient chips */}
                {specifiedIngredients.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {specifiedIngredients.map(ing => (
                      <Badge key={ing} variant="secondary" className="gap-1 pr-1">
                        {ing}
                        <button
                          onClick={() => removeIngredient(ing)}
                          className="hover:bg-muted rounded-full p-0.5"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Generate button */}
              <Button
                onClick={handleGenerate}
                disabled={!prompt.trim() || conceptsMutation.isPending}
                className="w-full gap-2"
                size="lg"
              >
                {conceptsMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Finding recipe ideas...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Find Recipe Ideas
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Loading State — Step 1 */}
        {conceptsMutation.isPending && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <img src={grammieImage} alt="Grammie" className="w-24 h-24 object-contain opacity-70 animate-pulse" />
            <p className="text-muted-foreground text-sm">Grammie is searching for recipe ideas...</p>
          </div>
        )}

        {/* Step 1 Results — Concept Cards */}
        {conceptsMutation.data && !conceptsMutation.isPending && !selectedConcept && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              Choose a recipe to create
            </h2>

            {conceptsMutation.data.concepts.map((concept, index) => (
              <ConceptCard
                key={index}
                concept={concept}
                onSelect={() => handleSelectConcept(concept)}
              />
            ))}

            {conceptsMutation.data.concepts.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                <ChefHat className="w-12 h-12 text-muted-foreground/50" />
                <p className="text-muted-foreground">Couldn't find recipe ideas. Try a different description.</p>
              </div>
            )}
          </div>
        )}

        {/* Step 2 — Full Recipe View */}
        {selectedConcept && (
          <div className="space-y-3">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 -ml-2"
              onClick={handleBackToConcepts}
            >
              <ArrowLeft className="w-4 h-4" />
              Back to ideas
            </Button>

            {/* Loading State — Step 2 */}
            {fullRecipeMutation.isPending && (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <img src={grammieImage} alt="Grammie" className="w-24 h-24 object-contain opacity-70 animate-pulse" />
                <p className="text-muted-foreground text-sm">Grammie is creating your recipe for "{selectedConcept.title}"...</p>
              </div>
            )}

            {/* Full Recipe Card */}
            {fullRecipeMutation.data && !fullRecipeMutation.isPending && (
              <FullRecipeCard
                data={fullRecipeMutation.data}
                onSave={() => saveMutation.mutate(fullRecipeMutation.data!.recipe)}
                onAddToGrocery={() => addToGroceryMutation.mutate(fullRecipeMutation.data!.missingIngredients)}
                isSaved={savedRecipeId}
                isAddedToGrocery={addedToGrocery}
                isSaving={saveMutation.isPending}
                isAddingToGrocery={addToGroceryMutation.isPending}
              />
            )}

            {/* Error state */}
            {fullRecipeMutation.isError && !fullRecipeMutation.isPending && (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                <ChefHat className="w-12 h-12 text-muted-foreground/50" />
                <p className="text-muted-foreground">Failed to create recipe. Please try again.</p>
                <Button variant="outline" onClick={() => fullRecipeMutation.mutate(selectedConcept)}>
                  Retry
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ConceptCard({ concept, onSelect }: { concept: RecipeConcept; onSelect: () => void }) {
  return (
    <Card className="overflow-hidden cursor-pointer hover:border-primary/50 transition-colors" onClick={onSelect}>
      <CardContent className="p-4">
        <div className="flex gap-3">
          <div className="w-16 h-16 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
            <ChefHat className="w-7 h-7 text-muted-foreground/50" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-medium text-sm">{concept.title}</h3>
              <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{concept.description}</p>
            <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
              {concept.estimatedTimeMinutes > 0 && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  ~{concept.estimatedTimeMinutes}m
                </span>
              )}
              {concept.cuisine && (
                <Badge variant="outline" className="text-[10px] py-0 h-4">
                  {concept.cuisine}
                </Badge>
              )}
              {concept.difficulty && (
                <Badge variant="outline" className="text-[10px] py-0 h-4">
                  {concept.difficulty}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Why it works */}
        <p className="text-xs text-primary/80 mt-2 italic">"{concept.whyItWorks}"</p>

        {/* Key ingredients */}
        {concept.keyIngredients.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {concept.keyIngredients.map(ing => (
              <Badge key={ing} variant="secondary" className="text-[10px]">
                {ing}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FullRecipeCard({
  data,
  onSave,
  onAddToGrocery,
  isSaved,
  isAddedToGrocery,
  isSaving,
  isAddingToGrocery,
}: {
  data: FullRecipeResponse;
  onSave: () => void;
  onAddToGrocery: () => void;
  isSaved: boolean;
  isAddedToGrocery: boolean;
  isSaving: boolean;
  isAddingToGrocery: boolean;
}) {
  const { recipe, matchedIngredients, missingIngredients, matchPercentage } = data;
  const totalTime = recipe.prepTimeMinutes + recipe.cookTimeMinutes;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-4">
        {/* Header */}
        <div>
          <h3 className="font-semibold text-base">{recipe.title}</h3>
          <p className="text-sm text-muted-foreground mt-0.5">{recipe.description}</p>
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            {totalTime > 0 && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {totalTime}m
              </span>
            )}
            {recipe.servings > 0 && (
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" />
                {recipe.servings} servings
              </span>
            )}
            {recipe.cuisine && (
              <Badge variant="outline" className="text-[10px] py-0 h-4">
                {recipe.cuisine}
              </Badge>
            )}
            {recipe.difficulty && (
              <Badge variant="outline" className="text-[10px] py-0 h-4">
                {recipe.difficulty}
              </Badge>
            )}
          </div>
        </div>

        {/* Pantry match */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ProgressBar value={matchPercentage} className="flex-1" />
            <span className="text-xs font-medium">{matchPercentage}% pantry match</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {matchedIngredients.slice(0, 5).map(ing => (
              <Badge key={ing} variant="secondary" className="text-[10px] bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
                {stripQuantity(ing)}
              </Badge>
            ))}
            {matchedIngredients.length > 5 && (
              <Badge variant="secondary" className="text-[10px] bg-green-500/10 text-green-700 dark:text-green-400">
                +{matchedIngredients.length - 5} in pantry
              </Badge>
            )}
            {missingIngredients.slice(0, 3).map(ing => (
              <Badge key={ing} variant="outline" className="text-[10px] text-muted-foreground">
                {stripQuantity(ing)}
              </Badge>
            ))}
            {missingIngredients.length > 3 && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                +{missingIngredients.length - 3} missing
              </Badge>
            )}
          </div>
        </div>

        {/* Full ingredients */}
        <div>
          <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1.5">Ingredients</h4>
          <ul className="space-y-1">
            {recipe.ingredients.map((ing, i) => {
              const isMatched = matchedIngredients.includes(ing);
              return (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className={`mt-0.5 ${isMatched ? 'text-green-500' : 'text-muted-foreground'}`}>
                    {isMatched ? <Check className="w-3.5 h-3.5" /> : <span className="w-3.5 h-3.5 inline-block text-center">·</span>}
                  </span>
                  <span className={isMatched ? '' : 'text-muted-foreground'}>{ing}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Instructions */}
        <div>
          <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1.5">Instructions</h4>
          <ol className="space-y-2">
            {recipe.instructions.map((step, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="text-muted-foreground font-medium shrink-0">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 pt-1">
          <Button
            variant={isSaved ? "secondary" : "default"}
            size="sm"
            className="flex-1 gap-1.5"
            onClick={onSave}
            disabled={isSaved || isSaving}
          >
            {isSaved ? (
              <><Check className="w-3.5 h-3.5" /> Saved</>
            ) : isSaving ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...</>
            ) : (
              <><Save className="w-3.5 h-3.5" /> Check and save</>
            )}
          </Button>
          {missingIngredients.length > 0 && (
            <Button
              variant={isAddedToGrocery ? "secondary" : "outline"}
              size="sm"
              className="flex-1 gap-1.5"
              onClick={onAddToGrocery}
              disabled={isAddedToGrocery || isAddingToGrocery}
            >
              {isAddedToGrocery ? (
                <><Check className="w-3.5 h-3.5" /> Added</>
              ) : isAddingToGrocery ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Adding...</>
              ) : (
                <><ShoppingCart className="w-3.5 h-3.5" /> Add {missingIngredients.length} Missing</>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function stripQuantity(ing: string): string {
  return ing.replace(/^[\d\s\/½¼¾⅓⅔⅛]+\s*(cups?|tablespoons?|tbsp|teaspoons?|tsp|ounces?|oz|pounds?|lbs?|cloves?|cans?|pieces?|slices?|bunch|head|stalks?|sprigs?|pinch|dash|to taste)?\s*/i, '').slice(0, 20);
}
