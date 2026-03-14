import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Recipe } from "@shared/schema";
import { DIETARY_FLAGS, CUISINE_OPTIONS, CANONICAL_ALLERGENS } from "@shared/schema";
import {
  ArrowLeft,
  Save,
  Loader2,
  Plus,
  Trash2,
  GripVertical,
  ChefHat,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

const editRecipeSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional().nullable(),
  prepTime: z.string().optional(),
  cookTime: z.string().optional().nullable(),
  totalTime: z.string().optional(),
  servings: z.coerce.number().min(1, "At least 1 serving required"),
  ingredients: z.array(z.object({ value: z.string() })).min(1, "At least one ingredient required"),
  instructions: z.array(z.object({ value: z.string() })).min(1, "At least one instruction required"),
  cuisine: z.string().optional().nullable(),
  skillLevel: z.string().optional().nullable(),
  isPublic: z.boolean(),
  isVegetarian: z.boolean().optional().nullable(),
  isVegan: z.boolean().optional().nullable(),
  isGlutenFree: z.boolean().optional().nullable(),
  isDairyFree: z.boolean().optional().nullable(),
  isKeto: z.boolean().optional().nullable(),
  isPaleo: z.boolean().optional().nullable(),
  isHighProtein: z.boolean().optional().nullable(),
  isLowCarb: z.boolean().optional().nullable(),
  isKosher: z.boolean().optional().nullable(),
  isHalal: z.boolean().optional().nullable(),
  allergens: z.array(z.string()).optional().nullable(),
  mealType: z.array(z.string()).optional().nullable(),
  cookingMethods: z.array(z.string()).optional().nullable(),
  seasonTags: z.array(z.string()).optional().nullable(),
  occasionTags: z.array(z.string()).optional().nullable(),
  tips: z.array(z.object({ text: z.string(), category: z.string().optional() })).optional().nullable(),
  servingSuggestions: z.array(z.string()).optional().nullable(),
});

type EditRecipeForm = z.infer<typeof editRecipeSchema>;

const MEAL_TYPE_OPTIONS = [
  "Breakfast",
  "Brunch",
  "Lunch",
  "Dinner",
  "Snack",
  "Dessert",
  "Appetizer",
  "Side Dish",
  "Main Course",
  "Beverage",
];

const SKILL_LEVELS = ["Beginner", "Intermediate", "Advanced", "Expert"];

const COOKING_METHODS = [
  "Baking",
  "Boiling",
  "Braising",
  "Broiling",
  "Deep Frying",
  "Grilling",
  "Pan Frying",
  "Poaching",
  "Pressure Cooking",
  "Roasting",
  "Sauteing",
  "Simmering",
  "Slow Cooking",
  "Smoking",
  "Steaming",
  "Stir Frying",
];

const SEASON_OPTIONS = ["Spring", "Summer", "Fall", "Winter", "Year-Round"];

const OCCASION_OPTIONS = [
  "Weeknight Dinner",
  "Date Night",
  "Holiday",
  "Birthday",
  "Thanksgiving",
  "Christmas",
  "Easter",
  "Game Day",
  "Potluck",
  "Picnic",
  "BBQ",
  "Meal Prep",
];

export default function RecipeEditPage() {
  const [, navigate] = useLocation();
  const [matched, params] = useRoute("/recipe/:id/edit");
  const recipeId = params?.id;
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: recipe, isLoading, error } = useQuery<Recipe>({
    queryKey: ["/api/recipes", recipeId],
    enabled: !!recipeId,
  });

  const form = useForm<EditRecipeForm>({
    resolver: zodResolver(editRecipeSchema),
    defaultValues: {
      title: "",
      description: "",
      prepTime: "",
      cookTime: "",
      totalTime: "",
      servings: 4,
      ingredients: [{ value: "" }],
      instructions: [{ value: "" }],
      cuisine: null,
      skillLevel: null,
      isPublic: true,
      isVegetarian: false,
      isVegan: false,
      isGlutenFree: false,
      isDairyFree: false,
      isKeto: false,
      isPaleo: false,
      isHighProtein: false,
      isLowCarb: false,
      isKosher: false,
      isHalal: false,
      allergens: [],
      mealType: [],
      cookingMethods: [],
      seasonTags: [],
      occasionTags: [],
      tips: [],
      servingSuggestions: [],
    },
  });

  const { fields: ingredientFields, append: appendIngredient, remove: removeIngredient } = useFieldArray({
    control: form.control,
    name: "ingredients",
  });

  const { fields: instructionFields, append: appendInstruction, remove: removeInstruction } = useFieldArray({
    control: form.control,
    name: "instructions",
  });

  const { fields: tipFields, append: appendTip, remove: removeTip } = useFieldArray({
    control: form.control,
    name: "tips",
  });

  useEffect(() => {
    if (recipe) {
      form.reset({
        title: recipe.title || "",
        description: recipe.description || "",
        prepTime: recipe.prepTime || "",
        cookTime: recipe.cookTime || "",
        totalTime: recipe.totalTime || "",
        servings: recipe.servings || 4,
        ingredients: (recipe.ingredients || []).map((i) => ({ value: i })),
        instructions: (recipe.instructions || []).map((i) => ({ value: i })),
        cuisine: recipe.cuisine || null,
        skillLevel: recipe.skillLevel || null,
        isPublic: recipe.isPublic ?? true,
        isVegetarian: recipe.isVegetarian ?? false,
        isVegan: recipe.isVegan ?? false,
        isGlutenFree: recipe.isGlutenFree ?? false,
        isDairyFree: recipe.isDairyFree ?? false,
        isKeto: recipe.isKeto ?? false,
        isPaleo: recipe.isPaleo ?? false,
        isHighProtein: recipe.isHighProtein ?? false,
        isLowCarb: recipe.isLowCarb ?? false,
        isKosher: recipe.isKosher ?? false,
        isHalal: recipe.isHalal ?? false,
        allergens: recipe.allergens || [],
        mealType: recipe.mealType || [],
        cookingMethods: recipe.cookingMethods || [],
        seasonTags: recipe.seasonTags || [],
        occasionTags: recipe.occasionTags || [],
        tips: (recipe.tips || []).map((t: any) => ({ text: t.text || "", category: t.category || "" })),
        servingSuggestions: recipe.servingSuggestions || [],
      });
    }
  }, [recipe, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: EditRecipeForm) => {
      const payload = {
        title: data.title,
        description: data.description || null,
        prepTime: data.prepTime || undefined,
        cookTime: data.cookTime || null,
        totalTime: data.totalTime || undefined,
        servings: data.servings,
        ingredients: data.ingredients.map((i) => i.value).filter(Boolean),
        instructions: data.instructions.map((i) => i.value).filter(Boolean),
        cuisine: data.cuisine || null,
        skillLevel: data.skillLevel || null,
        isPublic: data.isPublic,
        isVegetarian: data.isVegetarian,
        isVegan: data.isVegan,
        isGlutenFree: data.isGlutenFree,
        isDairyFree: data.isDairyFree,
        isKeto: data.isKeto,
        isPaleo: data.isPaleo,
        isHighProtein: data.isHighProtein,
        isLowCarb: data.isLowCarb,
        isKosher: data.isKosher,
        isHalal: data.isHalal,
        allergens: data.allergens,
        mealType: data.mealType,
        cookingMethods: data.cookingMethods,
        seasonTags: data.seasonTags,
        occasionTags: data.occasionTags,
        tips: data.tips?.filter((t) => t.text),
        servingSuggestions: data.servingSuggestions?.filter(Boolean),
      };
      return apiRequest("PATCH", `/api/recipes/${recipeId}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes", recipeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      toast({
        title: "Recipe updated",
        description: "Your changes have been saved successfully.",
      });
      navigate(`/recipe/${recipeId}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update recipe",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: EditRecipeForm) => {
    updateMutation.mutate(data);
  };

  const isOwner = user && recipe?.ownerUserId === user.id;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container max-w-4xl mx-auto px-4 py-8">
          <Skeleton className="h-10 w-48 mb-8" />
          <Skeleton className="h-[600px] w-full" />
        </div>
      </div>
    );
  }

  if (error || !recipe) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="p-8 text-center">
            <ChefHat className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">Recipe not found</h2>
            <p className="text-muted-foreground mb-4">
              The recipe you're looking for doesn't exist or has been deleted.
            </p>
            <Button onClick={() => navigate("/")}>Back to Recipes</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="p-8 text-center">
            <ChefHat className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">Not authorized</h2>
            <p className="text-muted-foreground mb-4">
              You can only edit recipes that you created.
            </p>
            <Button onClick={() => navigate(`/recipe/${recipeId}`)}>View Recipe</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(`/recipe/${recipeId}`)}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Edit Recipe</h1>
        </div>

        <form onSubmit={form.handleSubmit(onSubmit)}>
          <Tabs defaultValue="basic" className="space-y-6">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="basic" data-testid="tab-basic">Basic Info</TabsTrigger>
              <TabsTrigger value="ingredients" data-testid="tab-ingredients">Ingredients</TabsTrigger>
              <TabsTrigger value="instructions" data-testid="tab-instructions">Instructions</TabsTrigger>
              <TabsTrigger value="details" data-testid="tab-details">Details</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Basic Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">Title *</Label>
                    <Input
                      id="title"
                      {...form.register("title")}
                      placeholder="Recipe title"
                      data-testid="input-title"
                    />
                    {form.formState.errors.title && (
                      <p className="text-sm text-destructive">{form.formState.errors.title.message}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      {...form.register("description")}
                      placeholder="A brief description of the recipe"
                      rows={3}
                      data-testid="input-description"
                    />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="prepTime">Prep Time</Label>
                      <Input
                        id="prepTime"
                        {...form.register("prepTime")}
                        placeholder="e.g., 15 mins"
                        data-testid="input-prep-time"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cookTime">Cook Time</Label>
                      <Input
                        id="cookTime"
                        {...form.register("cookTime")}
                        placeholder="e.g., 30 mins"
                        data-testid="input-cook-time"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="totalTime">Total Time</Label>
                      <Input
                        id="totalTime"
                        {...form.register("totalTime")}
                        placeholder="e.g., 45 mins"
                        data-testid="input-total-time"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="servings">Servings *</Label>
                      <Input
                        id="servings"
                        type="number"
                        min={1}
                        {...form.register("servings")}
                        data-testid="input-servings"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Cuisine</Label>
                      <Select
                        value={form.watch("cuisine") || ""}
                        onValueChange={(val) => form.setValue("cuisine", val || null)}
                      >
                        <SelectTrigger data-testid="select-cuisine">
                          <SelectValue placeholder="Select cuisine" />
                        </SelectTrigger>
                        <SelectContent>
                          {CUISINE_OPTIONS.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Skill Level</Label>
                      <Select
                        value={form.watch("skillLevel") || ""}
                        onValueChange={(val) => form.setValue("skillLevel", val || null)}
                      >
                        <SelectTrigger data-testid="select-skill-level">
                          <SelectValue placeholder="Select skill level" />
                        </SelectTrigger>
                        <SelectContent>
                          {SKILL_LEVELS.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="isPublic"
                      checked={form.watch("isPublic")}
                      onCheckedChange={(checked) => form.setValue("isPublic", !!checked)}
                      data-testid="checkbox-public"
                    />
                    <Label htmlFor="isPublic">Make this recipe public</Label>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="ingredients" className="space-y-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-4">
                  <CardTitle>Ingredients</CardTitle>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => appendIngredient({ value: "" })}
                    data-testid="button-add-ingredient"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Button>
                </CardHeader>
                <CardContent className="space-y-3">
                  {ingredientFields.map((field, index) => (
                    <div key={field.id} className="flex items-center gap-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <Input
                        {...form.register(`ingredients.${index}.value`)}
                        placeholder="e.g., 2 cups flour"
                        className="flex-1"
                        data-testid={`input-ingredient-${index}`}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeIngredient(index)}
                        disabled={ingredientFields.length === 1}
                        data-testid={`button-remove-ingredient-${index}`}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                  {form.formState.errors.ingredients && (
                    <p className="text-sm text-destructive">{form.formState.errors.ingredients.message}</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="instructions" className="space-y-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-4">
                  <CardTitle>Instructions</CardTitle>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => appendInstruction({ value: "" })}
                    data-testid="button-add-instruction"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Step
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  {instructionFields.map((field, index) => (
                    <div key={field.id} className="flex items-start gap-2">
                      <div className="flex items-center gap-2 pt-2">
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium text-muted-foreground w-6">
                          {index + 1}.
                        </span>
                      </div>
                      <Textarea
                        {...form.register(`instructions.${index}.value`)}
                        placeholder="Describe this step..."
                        className="flex-1"
                        rows={2}
                        data-testid={`input-instruction-${index}`}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeInstruction(index)}
                        disabled={instructionFields.length === 1}
                        className="mt-1"
                        data-testid={`button-remove-instruction-${index}`}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                  {form.formState.errors.instructions && (
                    <p className="text-sm text-destructive">{form.formState.errors.instructions.message}</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="details" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Dietary Flags</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {Object.entries(DIETARY_FLAGS).slice(0, 10).map(([key, label]) => (
                      <div key={key} className="flex items-center gap-2">
                        <Checkbox
                          id={key}
                          checked={!!form.watch(key as keyof EditRecipeForm)}
                          onCheckedChange={(checked) => form.setValue(key as any, !!checked)}
                          data-testid={`checkbox-${key}`}
                        />
                        <Label htmlFor={key} className="text-sm">{label}</Label>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Allergens</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {CANONICAL_ALLERGENS.map((allergen) => (
                      <div key={allergen} className="flex items-center gap-2">
                        <Checkbox
                          id={`allergen-${allergen}`}
                          checked={(form.watch("allergens") || []).includes(allergen)}
                          onCheckedChange={(checked) => {
                            const current = form.watch("allergens") || [];
                            if (checked) {
                              form.setValue("allergens", [...current, allergen]);
                            } else {
                              form.setValue("allergens", current.filter((a) => a !== allergen));
                            }
                          }}
                          data-testid={`checkbox-allergen-${allergen.toLowerCase().replace(/\s+/g, "-")}`}
                        />
                        <Label htmlFor={`allergen-${allergen}`} className="text-sm">{allergen}</Label>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Meal Type</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                    {MEAL_TYPE_OPTIONS.map((mealType) => (
                      <div key={mealType} className="flex items-center gap-2">
                        <Checkbox
                          id={`mealType-${mealType}`}
                          checked={(form.watch("mealType") || []).includes(mealType)}
                          onCheckedChange={(checked) => {
                            const current = form.watch("mealType") || [];
                            if (checked) {
                              form.setValue("mealType", [...current, mealType]);
                            } else {
                              form.setValue("mealType", current.filter((m) => m !== mealType));
                            }
                          }}
                          data-testid={`checkbox-meal-${mealType.toLowerCase().replace(/\s+/g, "-")}`}
                        />
                        <Label htmlFor={`mealType-${mealType}`} className="text-sm">{mealType}</Label>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Cooking Methods</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {COOKING_METHODS.map((method) => (
                      <div key={method} className="flex items-center gap-2">
                        <Checkbox
                          id={`method-${method}`}
                          checked={(form.watch("cookingMethods") || []).includes(method)}
                          onCheckedChange={(checked) => {
                            const current = form.watch("cookingMethods") || [];
                            if (checked) {
                              form.setValue("cookingMethods", [...current, method]);
                            } else {
                              form.setValue("cookingMethods", current.filter((m) => m !== method));
                            }
                          }}
                          data-testid={`checkbox-method-${method.toLowerCase().replace(/\s+/g, "-")}`}
                        />
                        <Label htmlFor={`method-${method}`} className="text-sm">{method}</Label>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-4">
                  <CardTitle>Tips</CardTitle>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => appendTip({ text: "", category: "" })}
                    data-testid="button-add-tip"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Tip
                  </Button>
                </CardHeader>
                <CardContent className="space-y-3">
                  {tipFields.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No tips added yet.</p>
                  ) : (
                    tipFields.map((field, index) => (
                      <div key={field.id} className="flex items-start gap-2">
                        <Textarea
                          {...form.register(`tips.${index}.text`)}
                          placeholder="Enter a helpful tip..."
                          className="flex-1"
                          rows={2}
                          data-testid={`input-tip-${index}`}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeTip(index)}
                          className="mt-1"
                          data-testid={`button-remove-tip-${index}`}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <div className="flex justify-end gap-4 mt-8 sticky bottom-4 bg-background/95 backdrop-blur-sm py-4 px-4 -mx-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(`/recipe/${recipeId}`)}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateMutation.isPending}
              data-testid="button-save"
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
