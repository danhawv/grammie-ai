import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Settings as SettingsIcon, Save, RotateCcw, Cpu, Sparkles, Check, X, Sun, Moon, ChefHat, Plus, Trash2, Mic, Users, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTheme } from "@/components/theme-provider";

// All available quick filter options
const AVAILABLE_FILTERS = [
  { id: 'all', label: 'All Recipes', category: 'collection' },
  { id: 'yours', label: 'Your Recipes', category: 'collection' },
  { id: 'public', label: 'Public', category: 'collection' },
  { id: 'shared', label: 'Shared With Me', category: 'collection' },
  { id: 'under-15-mins', label: 'Under 15 mins', category: 'time' },
  { id: 'under-30-mins', label: 'Under 30 mins', category: 'time' },
  { id: 'under-1-hour', label: 'Under 1 hour', category: 'time' },
  { id: 'vegetarian', label: 'Vegetarian', category: 'diet' },
  { id: 'vegan', label: 'Vegan', category: 'diet' },
  { id: 'gluten-free', label: 'Gluten-Free', category: 'diet' },
  { id: 'dairy-free', label: 'Dairy-Free', category: 'diet' },
  { id: 'high-protein', label: 'High-Protein', category: 'diet' },
];

const DEFAULT_ENABLED_FILTERS = ['all', 'yours', 'public', 'shared', 'under-30-mins', 'high-protein'];

interface AIProviderInfo {
  currentProvider: "openai" | "gemini";
  hasRuntimeOverride: boolean;
  envDefault: string;
  providers: {
    openai: { available: boolean; description: string };
    gemini: { available: boolean; description: string };
  };
}

export default function Settings() {
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const [enabledFilters, setEnabledFilters] = useState<string[]>(DEFAULT_ENABLED_FILTERS);
  const [showQuickFilters, setShowQuickFilters] = useState<boolean>(false);
  
  // Dietary preferences for "What Can I Make?" feature
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([]);
  const [dislikedIngredients, setDislikedIngredients] = useState<string[]>([]);
  const [newDislikedIngredient, setNewDislikedIngredient] = useState('');

  // Voice Assistant (Grammie) preferences
  const [allergies, setAllergies] = useState<string[]>([]);
  const [newAllergy, setNewAllergy] = useState('');
  const [cookingSkillLevel, setCookingSkillLevel] = useState<string>('intermediate');
  const [cuisinePreferences, setCuisinePreferences] = useState<string[]>([]);
  const [householdSize, setHouseholdSize] = useState<number>(2);
  const [cookingGoals, setCookingGoals] = useState<string[]>([]);
  const [grammieNotes, setGrammieNotes] = useState<string>('');

  // Fetch AI provider info with custom fetcher that handles 403 gracefully
  const { data: aiProviderInfo, isLoading: isLoadingAI, isError: aiError } = useQuery<AIProviderInfo | null>({
    queryKey: ['/api/admin/ai-provider'],
    queryFn: async () => {
      const response = await fetch('/api/admin/ai-provider', {
        credentials: 'include',
      });
      // 403 means non-admin - return null instead of throwing
      if (response.status === 403) {
        return null;
      }
      if (!response.ok) {
        throw new Error('Failed to fetch AI provider info');
      }
      return response.json();
    },
    retry: false,
  });

  // Mutation to change AI provider
  const updateAIProvider = useMutation({
    mutationFn: async (provider: "openai" | "gemini") => {
      const response = await fetch('/api/admin/ai-provider', {
        method: 'PUT',
        body: JSON.stringify({ provider }),
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update AI provider');
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/ai-provider'] });
      toast({
        title: "AI Provider Updated",
        description: data.message,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error updating AI provider",
        description: error.message || "Failed to update AI provider",
        variant: "destructive",
      });
    },
  });

  // Check if user has admin access (aiProviderInfo is not null and not loading/error)
  const isAdmin = !isLoadingAI && !aiError && aiProviderInfo !== null;

  // Fetch user preferences
  const { data: preferences, isLoading } = useQuery<{
    quickFilters?: {
      enabled?: string[];
      order?: string[];
      showQuickFilters?: boolean;
    };
    dietaryRestrictions?: string[];
    dislikedIngredients?: string[];
    allergies?: string[];
    cookingSkillLevel?: string;
    cuisinePreferences?: string[];
    householdSize?: number;
    cookingGoals?: string[];
    grammieNotes?: string;
  }>({
    queryKey: ['/api/user/preferences'],
  });

  // Update preferences mutation
  const updatePreferences = useMutation({
    mutationFn: async (newPreferences: any) => {
      const response = await fetch('/api/user/preferences', {
        method: 'PUT',
        body: JSON.stringify(newPreferences),
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to update preferences');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user/preferences'] });
      toast({
        title: "Settings saved",
        description: "Your quick filter preferences have been updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error saving settings",
        description: error.message || "Failed to save preferences",
        variant: "destructive",
      });
    },
  });

  // Load preferences when data is available
  useEffect(() => {
    if (preferences?.quickFilters?.enabled) {
      setEnabledFilters(preferences.quickFilters.enabled);
    }
    if (preferences?.quickFilters?.showQuickFilters !== undefined) {
      setShowQuickFilters(preferences.quickFilters.showQuickFilters);
    }
    if (preferences?.dietaryRestrictions) {
      setDietaryRestrictions(preferences.dietaryRestrictions);
    }
    if (preferences?.dislikedIngredients) {
      setDislikedIngredients(preferences.dislikedIngredients);
    }
    // Voice assistant preferences
    if (preferences?.allergies) {
      setAllergies(preferences.allergies);
    }
    if (preferences?.cookingSkillLevel) {
      setCookingSkillLevel(preferences.cookingSkillLevel);
    }
    if (preferences?.cuisinePreferences) {
      setCuisinePreferences(preferences.cuisinePreferences);
    }
    if (preferences?.householdSize) {
      setHouseholdSize(preferences.householdSize);
    }
    if (preferences?.cookingGoals) {
      setCookingGoals(preferences.cookingGoals);
    }
    if (preferences?.grammieNotes) {
      setGrammieNotes(preferences.grammieNotes);
    }
  }, [preferences]);

  const handleToggleFilter = (filterId: string) => {
    setEnabledFilters(prev => {
      if (prev.includes(filterId)) {
        return prev.filter(id => id !== filterId);
      } else {
        return [...prev, filterId];
      }
    });
  };

  const handleSave = () => {
    updatePreferences.mutate({
      quickFilters: {
        enabled: enabledFilters,
        order: enabledFilters,
        showQuickFilters,
      },
    });
  };

  const handleReset = () => {
    setEnabledFilters(DEFAULT_ENABLED_FILTERS);
    setShowQuickFilters(false);
  };

  // Group filters by category
  const collectionFilters = AVAILABLE_FILTERS.filter(f => f.category === 'collection');
  const timeFilters = AVAILABLE_FILTERS.filter(f => f.category === 'time');
  const dietFilters = AVAILABLE_FILTERS.filter(f => f.category === 'diet');

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="flex items-center gap-3 mb-8">
          <SettingsIcon className="h-8 w-8" />
          <h1 className="font-serif text-4xl font-bold" data-testid="text-settings-title">
            Settings
          </h1>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sun className="h-5 w-5" />
              Appearance
            </CardTitle>
            <CardDescription>
              Customize the look and feel of the application.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
              <div className="space-y-0.5">
                <Label htmlFor="dark-mode" className="text-base font-medium">
                  Dark Mode
                </Label>
                <p className="text-sm text-muted-foreground">
                  Switch between light and dark color themes.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Sun className="h-4 w-4 text-muted-foreground" />
                <Switch
                  id="dark-mode"
                  checked={theme === 'dark'}
                  onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
                  data-testid="switch-dark-mode"
                />
                <Moon className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Quick Filter Preferences
            </CardTitle>
            <CardDescription>
              Customize which quick filters appear on the homepage. Select the filters you use most often.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : (
              <>
                {/* Show Quick Filters Toggle */}
                <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
                  <div className="space-y-0.5">
                    <Label htmlFor="show-quick-filters" className="text-base font-medium">
                      Show Quick Filters
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Display an optional row of quick filter chips on the homepage for faster filtering.
                    </p>
                  </div>
                  <Switch
                    id="show-quick-filters"
                    checked={showQuickFilters}
                    onCheckedChange={setShowQuickFilters}
                    data-testid="switch-show-quick-filters"
                  />
                </div>
                
                {/* Collection Filters */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold" data-testid="text-collection-filters-heading">
                    Collection Filters
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    These filters change which recipes are loaded from the server.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {collectionFilters.map(filter => (
                      <div key={filter.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={filter.id}
                          checked={enabledFilters.includes(filter.id)}
                          onCheckedChange={() => handleToggleFilter(filter.id)}
                          data-testid={`checkbox-filter-${filter.id}`}
                        />
                        <Label
                          htmlFor={filter.id}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                          data-testid={`label-filter-${filter.id}`}
                        >
                          {filter.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Time Filters */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold" data-testid="text-time-filters-heading">
                    Time Filters
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Filter recipes by preparation time.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {timeFilters.map(filter => (
                      <div key={filter.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={filter.id}
                          checked={enabledFilters.includes(filter.id)}
                          onCheckedChange={() => handleToggleFilter(filter.id)}
                          data-testid={`checkbox-filter-${filter.id}`}
                        />
                        <Label
                          htmlFor={filter.id}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                          data-testid={`label-filter-${filter.id}`}
                        >
                          {filter.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Diet Filters */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold" data-testid="text-diet-filters-heading">
                    Diet Filters
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Filter recipes by dietary preferences.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {dietFilters.map(filter => (
                      <div key={filter.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={filter.id}
                          checked={enabledFilters.includes(filter.id)}
                          onCheckedChange={() => handleToggleFilter(filter.id)}
                          data-testid={`checkbox-filter-${filter.id}`}
                        />
                        <Label
                          htmlFor={filter.id}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                          data-testid={`label-filter-${filter.id}`}
                        >
                          {filter.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-6 border-t">
                  <Button
                    onClick={handleSave}
                    disabled={updatePreferences.isPending}
                    data-testid="button-save-preferences"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {updatePreferences.isPending ? "Saving..." : "Save Preferences"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleReset}
                    disabled={updatePreferences.isPending}
                    data-testid="button-reset-preferences"
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Reset to Defaults
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Selected filters: {enabledFilters.length} of {AVAILABLE_FILTERS.length}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Dietary Preferences for What Can I Make? */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ChefHat className="h-5 w-5" />
              What Can I Make? Preferences
            </CardTitle>
            <CardDescription>
              Set your dietary restrictions and ingredients to avoid. These are used when suggesting recipes based on your pantry.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Dietary Restrictions */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold" data-testid="text-dietary-restrictions-heading">
                Dietary Restrictions
              </h3>
              <p className="text-sm text-muted-foreground">
                Only show recipes that match these dietary requirements.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'keto', 'low-carb'].map(diet => (
                  <div key={diet} className="flex items-center space-x-2">
                    <Checkbox
                      id={`diet-${diet}`}
                      checked={dietaryRestrictions.includes(diet)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setDietaryRestrictions([...dietaryRestrictions, diet]);
                        } else {
                          setDietaryRestrictions(dietaryRestrictions.filter(d => d !== diet));
                        }
                      }}
                      data-testid={`checkbox-diet-${diet}`}
                    />
                    <Label
                      htmlFor={`diet-${diet}`}
                      className="text-sm font-medium leading-none cursor-pointer capitalize"
                      data-testid={`label-diet-${diet}`}
                    >
                      {diet.replace('-', ' ')}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            {/* Disliked Ingredients */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold" data-testid="text-disliked-ingredients-heading">
                Ingredients to Avoid
              </h3>
              <p className="text-sm text-muted-foreground">
                Recipes containing these ingredients will be hidden from suggestions.
              </p>
              
              {/* Add new ingredient */}
              <div className="flex gap-2">
                <Input
                  placeholder="e.g., cilantro, mushrooms, zucchini..."
                  value={newDislikedIngredient}
                  onChange={(e) => setNewDislikedIngredient(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newDislikedIngredient.trim()) {
                      e.preventDefault();
                      const ingredient = newDislikedIngredient.trim().toLowerCase();
                      if (!dislikedIngredients.includes(ingredient)) {
                        setDislikedIngredients([...dislikedIngredients, ingredient]);
                      }
                      setNewDislikedIngredient('');
                    }
                  }}
                  data-testid="input-disliked-ingredient"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    const ingredient = newDislikedIngredient.trim().toLowerCase();
                    if (ingredient && !dislikedIngredients.includes(ingredient)) {
                      setDislikedIngredients([...dislikedIngredients, ingredient]);
                    }
                    setNewDislikedIngredient('');
                  }}
                  disabled={!newDislikedIngredient.trim()}
                  data-testid="button-add-disliked"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              
              {/* List of disliked ingredients */}
              {dislikedIngredients.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {dislikedIngredients.map((ingredient) => (
                    <Badge key={ingredient} variant="secondary" className="gap-1 pr-1">
                      {ingredient}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 ml-1 hover:bg-destructive/20"
                        onClick={() => setDislikedIngredients(dislikedIngredients.filter(i => i !== ingredient))}
                        data-testid={`button-remove-${ingredient}`}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Save button for dietary preferences */}
            <div className="flex gap-3 pt-6 border-t">
              <Button
                onClick={() => {
                  updatePreferences.mutate({
                    ...preferences,
                    dietaryRestrictions,
                    dislikedIngredients,
                  });
                }}
                disabled={updatePreferences.isPending}
                data-testid="button-save-dietary-preferences"
              >
                <Save className="h-4 w-4 mr-2" />
                {updatePreferences.isPending ? "Saving..." : "Save Dietary Preferences"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setDietaryRestrictions([]);
                  setDislikedIngredients([]);
                }}
                disabled={updatePreferences.isPending}
                data-testid="button-reset-dietary-preferences"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Clear All
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Voice Assistant Preferences */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mic className="h-5 w-5" />
              Voice Assistant Preferences
            </CardTitle>
            <CardDescription>
              Help Grammie remember your cooking style, allergies, and preferences for personalized assistance.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Allergies - Safety Critical */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold flex items-center gap-2" data-testid="text-allergies-heading">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Food Allergies
              </h3>
              <p className="text-sm text-muted-foreground">
                Grammie will always warn you about these ingredients. This is safety-critical information.
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g., peanuts, shellfish, dairy..."
                  value={newAllergy}
                  onChange={(e) => setNewAllergy(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newAllergy.trim()) {
                      e.preventDefault();
                      const allergy = newAllergy.trim().toLowerCase();
                      if (!allergies.includes(allergy)) {
                        setAllergies([...allergies, allergy]);
                      }
                      setNewAllergy('');
                    }
                  }}
                  data-testid="input-allergy"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    const allergy = newAllergy.trim().toLowerCase();
                    if (allergy && !allergies.includes(allergy)) {
                      setAllergies([...allergies, allergy]);
                    }
                    setNewAllergy('');
                  }}
                  disabled={!newAllergy.trim()}
                  data-testid="button-add-allergy"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {allergies.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {allergies.map((allergy) => (
                    <Badge key={allergy} variant="destructive" className="gap-1 pr-1">
                      {allergy}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 ml-1 hover:bg-background/20"
                        onClick={() => setAllergies(allergies.filter(a => a !== allergy))}
                        data-testid={`button-remove-allergy-${allergy}`}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Cooking Skill Level */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold" data-testid="text-skill-level-heading">
                Cooking Skill Level
              </h3>
              <p className="text-sm text-muted-foreground">
                Grammie adjusts explanations based on your experience.
              </p>
              <Select value={cookingSkillLevel} onValueChange={setCookingSkillLevel}>
                <SelectTrigger className="w-full max-w-xs" data-testid="select-skill-level">
                  <SelectValue placeholder="Select your skill level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beginner">Beginner - I'm new to cooking</SelectItem>
                  <SelectItem value="intermediate">Intermediate - I cook regularly</SelectItem>
                  <SelectItem value="advanced">Advanced - I'm comfortable with complex recipes</SelectItem>
                  <SelectItem value="professional">Professional - I have culinary training</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Household Size */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold flex items-center gap-2" data-testid="text-household-heading">
                <Users className="h-4 w-4" />
                Household Size
              </h3>
              <p className="text-sm text-muted-foreground">
                Grammie uses this for portion recommendations.
              </p>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={householdSize}
                  onChange={(e) => setHouseholdSize(parseInt(e.target.value) || 2)}
                  className="w-20"
                  data-testid="input-household-size"
                />
                <span className="text-muted-foreground">people</span>
              </div>
            </div>

            {/* Cuisine Preferences */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold" data-testid="text-cuisine-heading">
                Cuisine Preferences
              </h3>
              <p className="text-sm text-muted-foreground">
                Your favorite types of cooking for personalized suggestions.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {['Italian', 'Mexican', 'Asian', 'American', 'Mediterranean', 'Indian', 'French', 'Japanese', 'Thai'].map(cuisine => (
                  <div key={cuisine} className="flex items-center space-x-2">
                    <Checkbox
                      id={`cuisine-${cuisine}`}
                      checked={cuisinePreferences.includes(cuisine)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setCuisinePreferences([...cuisinePreferences, cuisine]);
                        } else {
                          setCuisinePreferences(cuisinePreferences.filter(c => c !== cuisine));
                        }
                      }}
                      data-testid={`checkbox-cuisine-${cuisine.toLowerCase()}`}
                    />
                    <Label
                      htmlFor={`cuisine-${cuisine}`}
                      className="text-sm font-medium leading-none cursor-pointer"
                      data-testid={`label-cuisine-${cuisine.toLowerCase()}`}
                    >
                      {cuisine}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            {/* Cooking Goals */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold" data-testid="text-goals-heading">
                Cooking Goals
              </h3>
              <p className="text-sm text-muted-foreground">
                What are you trying to achieve with your cooking?
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  { id: 'meal-prep', label: 'Meal Prep' },
                  { id: 'quick-weeknight', label: 'Quick Weeknight Meals' },
                  { id: 'healthy-eating', label: 'Healthy Eating' },
                  { id: 'budget-friendly', label: 'Budget Friendly' },
                  { id: 'family-cooking', label: 'Family Cooking' },
                  { id: 'learning', label: 'Learning New Skills' },
                ].map(goal => (
                  <div key={goal.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`goal-${goal.id}`}
                      checked={cookingGoals.includes(goal.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setCookingGoals([...cookingGoals, goal.id]);
                        } else {
                          setCookingGoals(cookingGoals.filter(g => g !== goal.id));
                        }
                      }}
                      data-testid={`checkbox-goal-${goal.id}`}
                    />
                    <Label
                      htmlFor={`goal-${goal.id}`}
                      className="text-sm font-medium leading-none cursor-pointer"
                      data-testid={`label-goal-${goal.id}`}
                    >
                      {goal.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            {/* Notes for Grammie */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold" data-testid="text-grammie-notes-heading">
                Notes for Grammie
              </h3>
              <p className="text-sm text-muted-foreground">
                Anything else Grammie should know? (e.g., "My husband doesn't like spicy food", "I prefer one-pot meals")
              </p>
              <Textarea
                placeholder="Tell Grammie anything helpful..."
                value={grammieNotes}
                onChange={(e) => setGrammieNotes(e.target.value)}
                className="min-h-[100px]"
                data-testid="textarea-grammie-notes"
              />
            </div>

            {/* Save button for voice preferences */}
            <div className="flex gap-3 pt-6 border-t">
              <Button
                onClick={() => {
                  updatePreferences.mutate({
                    ...preferences,
                    allergies,
                    cookingSkillLevel,
                    cuisinePreferences,
                    householdSize,
                    cookingGoals,
                    grammieNotes,
                  });
                }}
                disabled={updatePreferences.isPending}
                data-testid="button-save-voice-preferences"
              >
                <Save className="h-4 w-4 mr-2" />
                {updatePreferences.isPending ? "Saving..." : "Save Voice Preferences"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setAllergies([]);
                  setCookingSkillLevel('intermediate');
                  setCuisinePreferences([]);
                  setHouseholdSize(2);
                  setCookingGoals([]);
                  setGrammieNotes('');
                }}
                disabled={updatePreferences.isPending}
                data-testid="button-reset-voice-preferences"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Admin Settings - AI Provider (only shown to admins) */}
        {isAdmin && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="h-5 w-5" />
                AI Provider (Admin)
              </CardTitle>
              <CardDescription>
                Choose which AI service processes recipe uploads. Changes take effect immediately for new uploads.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {isLoadingAI ? (
                <div className="space-y-4">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : aiProviderInfo ? (
                <>
                  <RadioGroup
                    value={aiProviderInfo.currentProvider}
                    onValueChange={(value) => updateAIProvider.mutate(value as "openai" | "gemini")}
                    className="space-y-4"
                    disabled={updateAIProvider.isPending}
                  >
                    {/* OpenAI Option */}
                    <div className={`relative flex items-start p-4 rounded-lg border ${
                      aiProviderInfo.currentProvider === "openai" 
                        ? "border-primary bg-primary/5" 
                        : "border-border"
                    } ${!aiProviderInfo.providers.openai.available ? "opacity-50" : "hover-elevate"}`}>
                      <RadioGroupItem
                        value="openai"
                        id="openai"
                        disabled={!aiProviderInfo.providers.openai.available || updateAIProvider.isPending}
                        className="mt-1"
                        data-testid="radio-provider-openai"
                      />
                      <Label htmlFor="openai" className="ml-3 flex-1 cursor-pointer">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">OpenAI</span>
                          {aiProviderInfo.providers.openai.available ? (
                            <Badge variant="outline" className="text-xs">
                              <Check className="h-3 w-3 mr-1" />
                              Available
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="text-xs">
                              <X className="h-3 w-3 mr-1" />
                              Not Configured
                            </Badge>
                          )}
                          {aiProviderInfo.currentProvider === "openai" && (
                            <Badge className="text-xs">
                              <Sparkles className="h-3 w-3 mr-1" />
                              Active
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {aiProviderInfo.providers.openai.description}
                        </p>
                      </Label>
                    </div>

                    {/* Gemini Option */}
                    <div className={`relative flex items-start p-4 rounded-lg border ${
                      aiProviderInfo.currentProvider === "gemini" 
                        ? "border-primary bg-primary/5" 
                        : "border-border"
                    } ${!aiProviderInfo.providers.gemini.available ? "opacity-50" : "hover-elevate"}`}>
                      <RadioGroupItem
                        value="gemini"
                        id="gemini"
                        disabled={!aiProviderInfo.providers.gemini.available || updateAIProvider.isPending}
                        className="mt-1"
                        data-testid="radio-provider-gemini"
                      />
                      <Label htmlFor="gemini" className="ml-3 flex-1 cursor-pointer">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">Google Gemini</span>
                          {aiProviderInfo.providers.gemini.available ? (
                            <Badge variant="outline" className="text-xs">
                              <Check className="h-3 w-3 mr-1" />
                              Available
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="text-xs">
                              <X className="h-3 w-3 mr-1" />
                              Not Configured
                            </Badge>
                          )}
                          {aiProviderInfo.currentProvider === "gemini" && (
                            <Badge className="text-xs">
                              <Sparkles className="h-3 w-3 mr-1" />
                              Active
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {aiProviderInfo.providers.gemini.description}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Typically 20-40% faster than OpenAI
                        </p>
                      </Label>
                    </div>
                  </RadioGroup>

                  {updateAIProvider.isPending && (
                    <p className="text-sm text-muted-foreground">
                      Switching provider...
                    </p>
                  )}

                  {aiProviderInfo.hasRuntimeOverride && (
                    <p className="text-xs text-muted-foreground">
                      Runtime override active. Environment default: {aiProviderInfo.envDefault.toUpperCase()}
                    </p>
                  )}
                </>
              ) : null}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
