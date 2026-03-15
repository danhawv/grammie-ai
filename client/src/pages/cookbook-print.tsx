import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ChevronLeft, ChevronRight, BookOpen, Printer, ShoppingCart } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import type { Recipe } from "@shared/schema";

interface Cookbook {
  id: number;
  name: string;
  description: string | null;
  ownerUserId: string;
  coverImage: string | null;
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
  if (unit) quantityStr += ` ${unit}`;
  return quantityStr.trim();
}

type PageContent =
  | { type: "cover"; cookbook: Cookbook; ownerName: string; recipeCount: number }
  | { type: "toc"; recipes: Recipe[] }
  | { type: "recipe"; recipe: Recipe; index: number }
  | { type: "back"; cookbook: Cookbook };

export default function CookbookPrintPage() {
  const { id } = useParams<{ id: string }>();
  const cookbookId = parseInt(id || "0");
  const { user } = useAuth();
  const [currentPage, setCurrentPage] = useState(0);

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
  const isOwner = user?.id === cookbook?.ownerUserId;

  const ownerName = useMemo(() => {
    if (!cookbook?.owner) return "Unknown";
    const { firstName, lastName, username } = cookbook.owner;
    if (firstName || lastName) return [firstName, lastName].filter(Boolean).join(" ");
    return username || "Unknown";
  }, [cookbook?.owner]);

  // Build pages: cover, TOC, recipes, back
  const pages: PageContent[] = useMemo(() => {
    if (!cookbook) return [];
    const p: PageContent[] = [];
    p.push({ type: "cover", cookbook, ownerName, recipeCount: recipes.length });
    if (recipes.length > 0) {
      p.push({ type: "toc", recipes });
      recipes.forEach((recipe, index) => {
        p.push({ type: "recipe", recipe, index });
      });
    }
    p.push({ type: "back", cookbook });
    return p;
  }, [cookbook, recipes, ownerName]);

  const totalPages = pages.length;

  useEffect(() => {
    if (cookbook) document.title = `Preview: ${cookbook.name}`;
    return () => { document.title = "Recipe Collection"; };
  }, [cookbook]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setCurrentPage(p => Math.min(p + 1, totalPages - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setCurrentPage(p => Math.max(p - 1, 0));
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [totalPages]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center">
        <div className="w-full max-w-2xl p-8">
          <Skeleton className="h-[600px] w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (!cookbook) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Cookbook not found</p>
          <Link href="/"><Button variant="outline"><ArrowLeft className="h-4 w-4 mr-2" />Back to Home</Button></Link>
        </div>
      </div>
    );
  }

  const page = pages[currentPage];

  return (
    <div className="min-h-screen bg-stone-100">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={`/cookbook/${cookbookId}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <div className="hidden sm:block">
            <h1 className="text-sm font-medium">{cookbook.name}</h1>
            <p className="text-xs text-muted-foreground">
              Page {currentPage + 1} of {totalPages}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isOwner && (
            <>
              <Link href={`/cookbook/${cookbookId}/print-editor`}>
                <Button variant="outline" size="sm">
                  <Printer className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">Print with Lulu</span>
                  <span className="sm:hidden">Print</span>
                </Button>
              </Link>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Book display */}
      <div className="flex items-center justify-center min-h-[calc(100vh-60px)] px-4 py-8">
        {/* Left arrow */}
        <button
          onClick={() => setCurrentPage(p => Math.max(p - 1, 0))}
          disabled={currentPage === 0}
          className="hidden sm:flex items-center justify-center w-12 h-12 rounded-full hover:bg-white/80 transition disabled:opacity-20 disabled:cursor-default mr-4"
        >
          <ChevronLeft className="h-8 w-8 text-stone-600" />
        </button>

        {/* Page */}
        <div
          className="bg-white rounded-lg shadow-2xl w-full max-w-2xl overflow-hidden transition-all duration-300"
          style={{
            aspectRatio: "5/7",
            boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.05)",
          }}
        >
          {page?.type === "cover" && <CoverPage {...page} />}
          {page?.type === "toc" && <TocPage {...page} onGoToRecipe={(i) => setCurrentPage(i + 2)} />}
          {page?.type === "recipe" && <RecipePage {...page} />}
          {page?.type === "back" && <BackPage {...page} />}
        </div>

        {/* Right arrow */}
        <button
          onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages - 1))}
          disabled={currentPage === totalPages - 1}
          className="hidden sm:flex items-center justify-center w-12 h-12 rounded-full hover:bg-white/80 transition disabled:opacity-20 disabled:cursor-default ml-4"
        >
          <ChevronRight className="h-8 w-8 text-stone-600" />
        </button>
      </div>

      {/* Mobile nav */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur border-t px-4 py-3 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCurrentPage(p => Math.max(p - 1, 0))}
          disabled={currentPage === 0}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <span className="text-sm text-muted-foreground">
          {currentPage + 1} / {totalPages}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages - 1))}
          disabled={currentPage === totalPages - 1}
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}

// --- Page Components ---

function CoverPage({ cookbook, ownerName, recipeCount }: { cookbook: Cookbook; ownerName: string; recipeCount: number }) {
  return (
    <div className="h-full flex flex-col items-center justify-center p-8 sm:p-12 bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100 text-center relative overflow-hidden">
      {/* Decorative elements */}
      <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-orange-400 via-amber-500 to-orange-400" />
      <div className="absolute bottom-0 left-0 w-full h-2 bg-gradient-to-r from-orange-400 via-amber-500 to-orange-400" />
      <div className="absolute top-6 left-6 right-6 bottom-6 border-2 border-orange-200/50 rounded-lg pointer-events-none" />

      {cookbook.coverImage ? (
        <img src={cookbook.coverImage} alt="" className="w-32 h-32 rounded-full object-cover mb-6 ring-4 ring-orange-200 shadow-lg" />
      ) : (
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center mb-6 shadow-lg">
          <BookOpen className="h-12 w-12 text-white" />
        </div>
      )}

      <h1 className="text-2xl sm:text-4xl font-serif font-bold text-stone-800 mb-3 leading-tight">
        {cookbook.name}
      </h1>

      {cookbook.description && (
        <p className="text-sm sm:text-base text-stone-600 mb-6 max-w-md italic">
          {cookbook.description}
        </p>
      )}

      <div className="mt-auto">
        <p className="text-sm text-stone-500 font-medium tracking-wide uppercase">
          by {ownerName}
        </p>
        <p className="text-xs text-stone-400 mt-2">
          {recipeCount} recipe{recipeCount !== 1 ? "s" : ""}
        </p>
      </div>
    </div>
  );
}

function TocPage({ recipes, onGoToRecipe }: { recipes: Recipe[]; onGoToRecipe: (index: number) => void }) {
  return (
    <div className="h-full flex flex-col p-6 sm:p-10 bg-white overflow-y-auto">
      <h2 className="text-xl sm:text-2xl font-serif font-bold text-stone-800 mb-1 text-center">
        Table of Contents
      </h2>
      <div className="w-16 h-0.5 bg-orange-400 mx-auto mb-6" />

      <div className="flex-1 space-y-0">
        {recipes.map((recipe, idx) => (
          <button
            key={recipe.id}
            onClick={() => onGoToRecipe(idx)}
            className="w-full flex items-baseline gap-2 py-1.5 px-2 rounded hover:bg-orange-50 transition text-left group"
          >
            <span className="text-xs text-stone-400 font-mono w-6 shrink-0">{idx + 1}</span>
            <span className="text-sm text-stone-700 group-hover:text-orange-700 truncate flex-1">
              {recipe.title}
            </span>
            <span className="text-xs text-stone-400 shrink-0">
              {formatTime(recipe.totalTimeMinutes || recipe.cookTimeMinutes)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function RecipePage({ recipe, index }: { recipe: Recipe; index: number }) {
  const ingredients = recipe.normalizedIngredients ||
    (recipe.ingredients || []).map((raw: string) => ({ raw, item: raw }));
  const instructions = recipe.normalizedInstructions ||
    (recipe.instructions || []).map((text: string, i: number) => ({ stepNumber: i + 1, text }));

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      {/* Recipe image header */}
      {recipe.dishImageThumbnail && (
        <div className="relative h-40 sm:h-48 shrink-0">
          <img
            src={recipe.dishImageThumbnail}
            alt={recipe.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6">
            <h2 className="text-xl sm:text-2xl font-serif font-bold text-white leading-tight">
              {recipe.title}
            </h2>
          </div>
        </div>
      )}

      <div className="flex-1 p-4 sm:p-6">
        {/* Title if no image */}
        {!recipe.dishImageThumbnail && (
          <div className="mb-4">
            <h2 className="text-xl sm:text-2xl font-serif font-bold text-stone-800">
              {recipe.title}
            </h2>
            <div className="w-12 h-0.5 bg-orange-400 mt-2" />
          </div>
        )}

        {/* Time/servings badges */}
        <div className="flex flex-wrap gap-2 mb-4">
          {recipe.prepTimeMinutes && (
            <span className="text-xs bg-orange-50 text-orange-700 px-2 py-1 rounded-full">
              Prep: {formatTime(recipe.prepTimeMinutes)}
            </span>
          )}
          {recipe.cookTimeMinutes && (
            <span className="text-xs bg-orange-50 text-orange-700 px-2 py-1 rounded-full">
              Cook: {formatTime(recipe.cookTimeMinutes)}
            </span>
          )}
          {recipe.servings && (
            <span className="text-xs bg-stone-100 text-stone-600 px-2 py-1 rounded-full">
              Serves {recipe.servings}
            </span>
          )}
        </div>

        {recipe.description && (
          <p className="text-sm text-stone-600 italic mb-4 leading-relaxed">
            {recipe.description}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.5fr] gap-4 sm:gap-6">
          {/* Ingredients */}
          <div>
            <h3 className="text-sm font-bold text-stone-800 uppercase tracking-wider mb-2">
              Ingredients
            </h3>
            <ul className="space-y-1">
              {ingredients.map((ing: any, idx: number) => {
                const quantityStr = formatQuantity(ing.quantity, ing.unit);
                return (
                  <li key={idx} className="text-sm text-stone-700 flex gap-1">
                    {quantityStr && (
                      <span className="font-medium text-stone-900 shrink-0">{quantityStr}</span>
                    )}
                    <span>
                      {ing.item || ing.raw || ""}
                      {ing.preparation && <span className="text-stone-500">, {ing.preparation}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Instructions */}
          <div>
            <h3 className="text-sm font-bold text-stone-800 uppercase tracking-wider mb-2">
              Instructions
            </h3>
            <ol className="space-y-2">
              {instructions.map((step: any, idx: number) => (
                <li key={idx} className="text-sm text-stone-700 flex gap-2">
                  <span className="font-bold text-orange-500 shrink-0">{idx + 1}.</span>
                  <span className="leading-relaxed">{typeof step === "string" ? step : step.text}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Tips */}
        {recipe.tips && (recipe.tips as any[]).length > 0 && (
          <div className="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-100">
            <h4 className="text-xs font-bold text-amber-800 uppercase tracking-wider mb-1">Tips</h4>
            {(recipe.tips as any[]).map((tip: any, idx: number) => (
              <p key={idx} className="text-xs text-amber-700 leading-relaxed">
                {typeof tip === "string" ? tip : tip.text}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Page number */}
      <div className="text-center py-2 text-xs text-stone-400 shrink-0">
        {index + 1}
      </div>
    </div>
  );
}

function BackPage({ cookbook }: { cookbook: Cookbook }) {
  return (
    <div className="h-full flex flex-col items-center justify-center p-8 sm:p-12 bg-gradient-to-br from-stone-50 via-stone-100 to-stone-50 text-center relative">
      <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-orange-400 via-amber-500 to-orange-400" />
      <div className="absolute bottom-0 left-0 w-full h-2 bg-gradient-to-r from-orange-400 via-amber-500 to-orange-400" />

      <BookOpen className="h-16 w-16 text-stone-300 mb-6" />
      <h2 className="text-xl sm:text-2xl font-serif font-bold text-stone-700 mb-2">
        {cookbook.name}
      </h2>
      {cookbook.description && (
        <p className="text-sm text-stone-500 italic max-w-sm mb-8">
          {cookbook.description}
        </p>
      )}
      <p className="text-xs text-stone-400 mt-auto">
        Made with Grammie
      </p>
    </div>
  );
}
