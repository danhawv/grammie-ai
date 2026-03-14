import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Printer } from "lucide-react";
import type { Recipe } from "@shared/schema";

interface Cookbook {
  id: number;
  name: string;
  description: string | null;
  ownerUserId: string;
  owner?: {
    firstName: string | null;
    lastName: string | null;
    username: string | null;
  };
}

interface PrintRecipesResponse {
  recipes: Recipe[];
}

function formatTime(minutes: number | null | undefined): string {
  if (!minutes) return "";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatQuantity(quantity: number | undefined, unit: string | undefined): string {
  if (!quantity) return "";
  
  const fractionMap: { [key: number]: string } = {
    0.25: "¼", 0.33: "⅓", 0.5: "½", 0.66: "⅔", 0.75: "¾",
    0.125: "⅛", 0.375: "⅜", 0.625: "⅝", 0.875: "⅞",
  };
  
  const whole = Math.floor(quantity);
  const decimal = quantity - whole;
  
  let quantityStr = "";
  if (whole > 0) quantityStr = whole.toString();
  
  const closestFraction = Object.keys(fractionMap)
    .map(Number)
    .find(f => Math.abs(decimal - f) < 0.05);
  
  if (closestFraction) {
    quantityStr += (whole > 0 ? " " : "") + fractionMap[closestFraction];
  } else if (decimal > 0 && !closestFraction) {
    quantityStr = quantity.toFixed(1).replace(/\.0$/, "");
  }
  
  if (unit) {
    quantityStr += ` ${unit}`;
  }
  
  return quantityStr.trim();
}

export default function CookbookPrintPage() {
  const { id } = useParams<{ id: string }>();
  const cookbookId = parseInt(id || "0");

  const { data: cookbook, isLoading: cookbookLoading } = useQuery<Cookbook>({
    queryKey: ['/api/cookbooks', cookbookId],
    queryFn: async () => {
      const response = await fetch(`/api/cookbooks/${cookbookId}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to load cookbook');
      return response.json();
    },
    enabled: !!cookbookId,
  });

  const { data: recipesData, isLoading: recipesLoading } = useQuery<PrintRecipesResponse>({
    queryKey: ['/api/cookbooks', cookbookId, 'recipes', 'print'],
    queryFn: async () => {
      const response = await fetch(`/api/cookbooks/${cookbookId}/recipes/print`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to load recipes');
      return response.json();
    },
    enabled: !!cookbookId,
  });

  const recipes = recipesData?.recipes || [];
  const isLoading = cookbookLoading || recipesLoading;

  const ownerName = useMemo(() => {
    if (!cookbook?.owner) return "Unknown";
    const { firstName, lastName, username } = cookbook.owner;
    if (firstName || lastName) {
      return [firstName, lastName].filter(Boolean).join(" ");
    }
    return username || "Unknown";
  }, [cookbook?.owner]);

  const handlePrint = () => {
    window.print();
  };

  useEffect(() => {
    if (cookbook) {
      document.title = `Print: ${cookbook.name}`;
    }
    return () => {
      document.title = "Recipe Collection";
    };
  }, [cookbook]);

  if (isLoading) {
    return (
      <div className="container max-w-4xl mx-auto py-8 px-4">
        <div className="flex items-center gap-4 mb-8 print:hidden">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-32" />
        </div>
        <Skeleton className="h-12 w-3/4 mb-4" />
        <Skeleton className="h-6 w-1/2 mb-8" />
        {[1, 2, 3].map(i => (
          <div key={i} className="mb-8">
            <Skeleton className="h-8 w-1/2 mb-4" />
            <Skeleton className="h-48 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (!cookbook) {
    return (
      <div className="container max-w-4xl mx-auto py-8 px-4 text-center">
        <p className="text-muted-foreground">Cookbook not found</p>
        <Link href="/">
          <Button variant="outline" className="mt-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Home
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="cookbook-print-container">
      <div className="container max-w-4xl mx-auto py-6 px-4 print:p-0 print:max-w-none">
        <div className="flex items-center gap-4 mb-8 print:hidden">
          <Link href={`/cookbook/${cookbookId}`}>
            <Button variant="outline" data-testid="button-back-to-cookbook">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <Button onClick={handlePrint} data-testid="button-print">
            <Printer className="h-4 w-4 mr-2" />
            Print Cookbook
          </Button>
          <span className="text-sm text-muted-foreground">
            {recipes.length} recipe{recipes.length !== 1 ? 's' : ''}
          </span>
        </div>

        {recipes.length === 0 ? (
          <div className="text-center py-12 print:hidden">
            <p className="text-muted-foreground">No recipes in this cookbook yet.</p>
          </div>
        ) : (
          <div className="cookbook-print-recipes">
            {recipes.map((recipe, index) => {
              const ingredients = recipe.normalizedIngredients || 
                (recipe.ingredients || []).map((raw: string) => ({ raw, item: raw }));
              const instructions = recipe.normalizedInstructions || 
                (recipe.instructions || []).map((text: string, i: number) => ({ stepNumber: i + 1, text }));
              
              return (
                <article 
                  key={recipe.id} 
                  className="cookbook-print-recipe-page"
                  data-testid={`print-recipe-${recipe.id}`}
                >
                  <div className="cookbook-print-recipe-header">
                    {recipe.dishImageThumbnail && (
                      <img
                        src={recipe.dishImageThumbnail}
                        alt={recipe.title}
                        className="cookbook-print-recipe-image"
                      />
                    )}
                    <div className="cookbook-print-recipe-title-section">
                      <h2 className="cookbook-print-recipe-title">{recipe.title}</h2>
                      <div className="cookbook-print-recipe-times">
                        {recipe.prepTimeMinutes && (
                          <span>Prep: {formatTime(recipe.prepTimeMinutes)}</span>
                        )}
                        {recipe.cookTimeMinutes && (
                          <span>Cook: {formatTime(recipe.cookTimeMinutes)}</span>
                        )}
                        {recipe.totalTimeMinutes && (
                          <span>Total: {formatTime(recipe.totalTimeMinutes)}</span>
                        )}
                        {recipe.servings && (
                          <span>Serves: {recipe.servings}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="cookbook-print-recipe-content">
                    <div className="cookbook-print-ingredients">
                      <h3>Ingredients</h3>
                      <ul>
                        {ingredients.map((ing: any, idx: number) => {
                          const quantityStr = formatQuantity(ing.quantity, ing.unit);
                          return (
                            <li key={idx}>
                              {quantityStr && <span className="cookbook-print-quantity">{quantityStr}</span>}
                              {ing.item || ing.raw || ''}
                              {ing.preparation && <span className="cookbook-print-prep">, {ing.preparation}</span>}
                            </li>
                          );
                        })}
                      </ul>
                    </div>

                    <div className="cookbook-print-instructions">
                      <h3>Instructions</h3>
                      <ol>
                        {instructions.map((step: any, idx: number) => (
                          <li key={idx}>
                            {typeof step === 'string' ? step : step.text}
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
