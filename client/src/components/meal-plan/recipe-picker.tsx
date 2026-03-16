import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  Clock,
  Users,
  Loader2,
  Plus,
  Minus,
  ChefHat,
  Utensils,
} from "lucide-react";

type RecipeResult = {
  id: string;
  title: string;
  description: string | null;
  dishImageThumbnail: string | null;
  totalTime: string;
  servings: number;
  mealType: string[] | null;
};

interface RecipePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (recipeId: string, servings: number) => void;
  mealSlot?: string;
  mealPlanId?: string;
}

export function RecipePicker({
  open,
  onOpenChange,
  onSelect,
  mealSlot,
  mealPlanId,
}: RecipePickerProps) {
  const [search, setSearch] = useState("");
  const [selectedServings, setSelectedServings] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<"all" | "suggested">("all");

  const { data: recipesData, isLoading } = useQuery({
    queryKey: ["/api/recipes", "picker", search],
    queryFn: async () => {
      const params = new URLSearchParams({ page: "1", limit: "20" });
      if (search) params.set("search", search);
      const res = await fetch(`/api/recipes?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      return data.recipes || data;
    },
    enabled: open,
  });

  const { data: suggestions } = useQuery({
    queryKey: ["/api/meal-plans", mealPlanId, "suggestions", mealSlot],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (mealSlot) params.set("mealSlot", mealSlot);
      const res = await fetch(`/api/meal-plans/${mealPlanId}/suggestions?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: open && !!mealPlanId && activeTab === "suggested",
  });

  const recipes: RecipeResult[] = recipesData || [];

  const getServings = (recipe: RecipeResult) =>
    selectedServings[recipe.id] || recipe.servings || 4;

  const handleSelect = (recipe: RecipeResult) => {
    onSelect(recipe.id, getServings(recipe));
    onOpenChange(false);
    setSearch("");
  };

  const adjustServings = (recipeId: string, delta: number, defaultServings: number) => {
    const current = selectedServings[recipeId] || defaultServings;
    const newVal = Math.max(1, current + delta);
    setSelectedServings((prev) => ({ ...prev, [recipeId]: newVal }));
  };

  const RecipeCard = ({ recipe, shared }: { recipe: RecipeResult; shared?: string[] }) => (
    <div
      className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/50 cursor-pointer transition-colors"
      onClick={() => handleSelect(recipe)}
    >
      {recipe.dishImageThumbnail ? (
        <img
          src={recipe.dishImageThumbnail}
          alt={recipe.title}
          className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <Utensils className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{recipe.title}</div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
          {recipe.totalTime && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {recipe.totalTime}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {recipe.servings} servings
          </span>
        </div>
        {shared && shared.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            <Badge variant="secondary" className="text-xs py-0">
              Shares {shared.length} ingredient{shared.length > 1 ? "s" : ""}
            </Badge>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation();
            adjustServings(recipe.id, -1, recipe.servings || 4);
          }}
        >
          <Minus className="h-3 w-3" />
        </Button>
        <span className="text-sm w-6 text-center font-medium">
          {getServings(recipe)}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation();
            adjustServings(recipe.id, 1, recipe.servings || 4);
          }}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ChefHat className="h-5 w-5" />
            Add Recipe
            {mealSlot && (
              <Badge variant="outline" className="capitalize ml-2">
                {mealSlot}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search recipes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {mealPlanId && (
          <div className="flex gap-2">
            <Button
              variant={activeTab === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("all")}
            >
              All Recipes
            </Button>
            <Button
              variant={activeTab === "suggested" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("suggested")}
            >
              Suggested
            </Button>
          </div>
        )}

        <ScrollArea className="flex-1 max-h-[50vh]">
          <div className="space-y-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : activeTab === "suggested" && suggestions ? (
              suggestions.length === 0 ? (
                <p className="text-center text-muted-foreground py-8 text-sm">
                  Add more recipes to your plan to get ingredient-based suggestions.
                </p>
              ) : (
                suggestions.map((s: any) => (
                  <RecipeCard
                    key={s.recipe.id}
                    recipe={s.recipe}
                    shared={s.sharedIngredients}
                  />
                ))
              )
            ) : recipes.length === 0 ? (
              <p className="text-center text-muted-foreground py-8 text-sm">
                {search ? "No recipes found" : "No recipes available"}
              </p>
            ) : (
              recipes.map((recipe: any) => (
                <RecipeCard key={recipe.id} recipe={recipe} />
              ))
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
