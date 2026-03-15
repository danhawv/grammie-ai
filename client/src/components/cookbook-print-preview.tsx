import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, ChevronLeft, ChevronRight, BookOpen } from "lucide-react";
import type { PrintLayoutData } from "@shared/schema";
import { BOOK_SIZES, type TrimSizeId } from "@/lib/print-constants";

interface Recipe {
  id: string;
  title: string;
  description?: string | null;
  dishImage?: string | null;
  dishImageThumbnail?: string | null;
  handwrittenImage?: string | null;
  ingredients?: any[] | null;
  normalizedIngredients?: any[] | null;
  instructions?: any[] | null;
  normalizedInstructions?: any[] | null;
  prepTimeMinutes?: number | null;
  cookTimeMinutes?: number | null;
  totalTimeMinutes?: number | null;
  servings?: number | null;
  tips?: any[] | null;
  cuisine?: string | null;
  calories?: number | null;
  protein?: number | null;
  carbohydrates?: number | null;
  fat?: number | null;
}

interface CookbookPrintPreviewProps {
  open: boolean;
  onClose: () => void;
  layoutData: PrintLayoutData;
  templateStyle: 'classic' | 'modern' | 'rustic' | 'elegant';
  cookbookId: number;
  trimSize?: string;
}

type PageContent =
  | { type: "cover" }
  | { type: "dedication" }
  | { type: "toc" }
  | { type: "section"; title: string }
  | { type: "recipe"; recipe: Recipe; index: number }
  | { type: "back" };

// Theme configurations
const THEMES = {
  classic: {
    bg: "bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100",
    coverBg: "bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100",
    backBg: "bg-gradient-to-br from-stone-50 via-stone-100 to-stone-50",
    accent: "bg-gradient-to-r from-orange-400 via-amber-500 to-orange-400",
    accentText: "text-orange-700",
    accentBg: "bg-orange-50",
    badgeAccent: "bg-orange-50 text-orange-700",
    badgeNeutral: "bg-stone-100 text-stone-600",
    titleFont: "font-serif",
    bodyFont: "font-serif",
    titleColor: "text-stone-800",
    subtitleColor: "text-stone-600",
    bodyColor: "text-stone-700",
    mutedColor: "text-stone-500",
    lightColor: "text-stone-400",
    headingColor: "text-stone-800",
    borderAccent: "border-orange-200/50",
    tipBg: "bg-amber-50",
    tipBorder: "border-amber-100",
    tipTitle: "text-amber-800",
    tipText: "text-amber-700",
    iconBg: "bg-gradient-to-br from-orange-400 to-amber-500",
    stepColor: "text-orange-500",
    dividerColor: "bg-orange-400",
    sectionBg: "bg-gradient-to-br from-amber-50 to-orange-50",
    sectionDecor: "✦",
  },
  modern: {
    bg: "bg-gradient-to-br from-gray-50 via-white to-gray-100",
    coverBg: "bg-gradient-to-br from-gray-50 via-white to-gray-100",
    backBg: "bg-gradient-to-br from-gray-50 via-gray-100 to-gray-50",
    accent: "bg-gray-900",
    accentText: "text-gray-700",
    accentBg: "bg-gray-100",
    badgeAccent: "bg-gray-900 text-white",
    badgeNeutral: "bg-gray-100 text-gray-600",
    titleFont: "font-sans",
    bodyFont: "font-sans",
    titleColor: "text-gray-900",
    subtitleColor: "text-gray-500",
    bodyColor: "text-gray-700",
    mutedColor: "text-gray-500",
    lightColor: "text-gray-400",
    headingColor: "text-gray-900",
    borderAccent: "border-gray-200",
    tipBg: "bg-gray-50",
    tipBorder: "border-gray-200",
    tipTitle: "text-gray-800",
    tipText: "text-gray-600",
    iconBg: "bg-gray-900",
    stepColor: "text-gray-900",
    dividerColor: "bg-gray-900",
    sectionBg: "bg-gradient-to-br from-gray-50 to-gray-100",
    sectionDecor: "—",
  },
  rustic: {
    bg: "bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50",
    coverBg: "bg-gradient-to-br from-amber-100 via-yellow-50 to-orange-100",
    backBg: "bg-gradient-to-br from-amber-50 via-yellow-50 to-amber-50",
    accent: "bg-gradient-to-r from-amber-700 via-amber-600 to-amber-700",
    accentText: "text-amber-800",
    accentBg: "bg-amber-50",
    badgeAccent: "bg-amber-100 text-amber-800",
    badgeNeutral: "bg-yellow-50 text-amber-700",
    titleFont: "font-serif",
    bodyFont: "font-serif",
    titleColor: "text-amber-900",
    subtitleColor: "text-amber-700",
    bodyColor: "text-amber-900",
    mutedColor: "text-amber-700",
    lightColor: "text-amber-500",
    headingColor: "text-amber-900",
    borderAccent: "border-amber-200",
    tipBg: "bg-yellow-50",
    tipBorder: "border-amber-200",
    tipTitle: "text-amber-900",
    tipText: "text-amber-800",
    iconBg: "bg-gradient-to-br from-amber-600 to-yellow-700",
    stepColor: "text-amber-700",
    dividerColor: "bg-amber-600",
    sectionBg: "bg-gradient-to-br from-amber-100 to-yellow-100",
    sectionDecor: "❧",
  },
  elegant: {
    bg: "bg-gradient-to-br from-slate-50 via-white to-slate-50",
    coverBg: "bg-gradient-to-br from-slate-50 via-white to-slate-100",
    backBg: "bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50",
    accent: "bg-gradient-to-r from-slate-400 via-slate-500 to-slate-400",
    accentText: "text-slate-600",
    accentBg: "bg-slate-50",
    badgeAccent: "bg-slate-100 text-slate-700",
    badgeNeutral: "bg-slate-50 text-slate-500",
    titleFont: "font-serif",
    bodyFont: "font-sans",
    titleColor: "text-slate-800",
    subtitleColor: "text-slate-500",
    bodyColor: "text-slate-700",
    mutedColor: "text-slate-500",
    lightColor: "text-slate-400",
    headingColor: "text-slate-800",
    borderAccent: "border-slate-200",
    tipBg: "bg-slate-50",
    tipBorder: "border-slate-200",
    tipTitle: "text-slate-700",
    tipText: "text-slate-600",
    iconBg: "bg-gradient-to-br from-slate-500 to-slate-700",
    stepColor: "text-slate-500",
    dividerColor: "bg-slate-400",
    sectionBg: "bg-gradient-to-br from-slate-50 to-slate-100",
    sectionDecor: "◆",
  },
};

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

export function CookbookPrintPreview({
  open,
  onClose,
  layoutData,
  templateStyle,
  cookbookId,
  trimSize,
}: CookbookPrintPreviewProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const theme = THEMES[templateStyle] || THEMES.classic;

  // Get trim size dimensions for aspect ratio
  const sizeConfig = BOOK_SIZES[(trimSize || "0600X0900") as TrimSizeId];
  const aspectRatio = sizeConfig
    ? `${sizeConfig.widthIn} / ${sizeConfig.heightIn}`
    : "6 / 9";

  const allRecipeIds = useMemo(
    () => layoutData.sections.flatMap(s => s.recipeIds),
    [layoutData.sections]
  );

  const { data: recipesData } = useQuery<{ recipes: Recipe[] }>({
    queryKey: ['/api/recipes/batch', allRecipeIds],
    queryFn: async () => {
      if (allRecipeIds.length === 0) return { recipes: [] };
      const response = await fetch(`/api/recipes/batch?ids=${allRecipeIds.join(',')}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to load recipes');
      return response.json();
    },
    enabled: open && allRecipeIds.length > 0,
  });

  const recipesById = useMemo(() => {
    const map = new Map<string, Recipe>();
    recipesData?.recipes.forEach(r => map.set(String(r.id), r));
    return map;
  }, [recipesData?.recipes]);

  // Build pages from layout data
  const pages: PageContent[] = useMemo(() => {
    const p: PageContent[] = [];
    p.push({ type: "cover" });
    if (layoutData.dedication) {
      p.push({ type: "dedication" });
    }

    // Build ordered recipe list for TOC and counting
    const allRecipes: { recipe: Recipe; sectionTitle: string }[] = [];
    layoutData.sections.forEach(section => {
      section.recipeIds.forEach(id => {
        const recipe = recipesById.get(String(id));
        if (recipe) allRecipes.push({ recipe, sectionTitle: section.title });
      });
    });

    if (allRecipes.length > 0) {
      p.push({ type: "toc" });
    }

    let recipeIndex = 0;
    layoutData.sections.forEach(section => {
      const sectionRecipes = section.recipeIds
        .map(id => recipesById.get(String(id)))
        .filter(Boolean) as Recipe[];

      if (sectionRecipes.length > 0 && layoutData.sections.length > 1) {
        p.push({ type: "section", title: section.title });
      }
      sectionRecipes.forEach(recipe => {
        p.push({ type: "recipe", recipe, index: recipeIndex++ });
      });
    });

    p.push({ type: "back" });
    return p;
  }, [layoutData, recipesById]);

  const totalPages = pages.length;

  // Reset page on open
  useEffect(() => {
    if (open) setCurrentPage(0);
  }, [open]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setCurrentPage(p => Math.min(p + 1, totalPages - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setCurrentPage(p => Math.max(p - 1, 0));
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, totalPages, onClose]);

  const page = pages[currentPage];
  const allOrderedRecipes = useMemo(() => {
    const recipes: Recipe[] = [];
    layoutData.sections.forEach(section => {
      section.recipeIds.forEach(id => {
        const recipe = recipesById.get(String(id));
        if (recipe) recipes.push(recipe);
      });
    });
    return recipes;
  }, [layoutData.sections, recipesById]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-[95vw] w-full max-h-[95vh] h-full flex flex-col p-0 gap-0 border-0 bg-stone-800 [&>button]:hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-stone-900/90 backdrop-blur border-b border-stone-700 shrink-0">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-sm font-medium text-white">
                {layoutData.title || "Cookbook Preview"}
              </h2>
              <p className="text-xs text-stone-400">
                Page {currentPage + 1} of {totalPages} • {sizeConfig?.name || "6\" × 9\""} • {templateStyle.charAt(0).toUpperCase() + templateStyle.slice(1)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-stone-700 text-stone-200 text-xs">
              {allOrderedRecipes.length} recipe{allOrderedRecipes.length !== 1 ? "s" : ""}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-stone-400 hover:text-white hover:bg-stone-700"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Book display */}
        <div className="flex-1 flex items-center justify-center px-4 py-6 min-h-0">
          {/* Left arrow */}
          <button
            onClick={() => setCurrentPage(p => Math.max(p - 1, 0))}
            disabled={currentPage === 0}
            className="hidden sm:flex items-center justify-center w-12 h-12 rounded-full hover:bg-stone-700/80 transition disabled:opacity-20 disabled:cursor-default mr-4 shrink-0"
          >
            <ChevronLeft className="h-8 w-8 text-stone-400" />
          </button>

          {/* Page */}
          <div
            className="bg-white rounded-lg shadow-2xl w-full overflow-hidden transition-all duration-300"
            style={{
              aspectRatio,
              maxWidth: "min(600px, 60vh)",
              maxHeight: "calc(95vh - 120px)",
              boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.1)",
            }}
          >
            {page?.type === "cover" && (
              <CoverPage
                layoutData={layoutData}
                theme={theme}
                recipeCount={allOrderedRecipes.length}
              />
            )}
            {page?.type === "dedication" && (
              <DedicationPage layoutData={layoutData} theme={theme} />
            )}
            {page?.type === "toc" && (
              <TocPage
                sections={layoutData.sections}
                recipesById={recipesById}
                theme={theme}
                onGoToRecipe={(recipePageIndex) => {
                  // Find the page index for this recipe
                  const targetPage = pages.findIndex(
                    p => p.type === "recipe" && (p as any).index === recipePageIndex
                  );
                  if (targetPage >= 0) setCurrentPage(targetPage);
                }}
              />
            )}
            {page?.type === "section" && (
              <SectionPage title={page.title} theme={theme} />
            )}
            {page?.type === "recipe" && (
              <RecipePage recipe={page.recipe} index={page.index} theme={theme} />
            )}
            {page?.type === "back" && (
              <BackPage layoutData={layoutData} theme={theme} />
            )}
          </div>

          {/* Right arrow */}
          <button
            onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages - 1))}
            disabled={currentPage === totalPages - 1}
            className="hidden sm:flex items-center justify-center w-12 h-12 rounded-full hover:bg-stone-700/80 transition disabled:opacity-20 disabled:cursor-default ml-4 shrink-0"
          >
            <ChevronRight className="h-8 w-8 text-stone-400" />
          </button>
        </div>

        {/* Bottom nav (mobile + desktop page dots) */}
        <div className="flex items-center justify-center gap-2 px-4 py-3 bg-stone-900/90 backdrop-blur border-t border-stone-700 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentPage(p => Math.max(p - 1, 0))}
            disabled={currentPage === 0}
            className="sm:hidden text-stone-400"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div className="flex gap-1.5 items-center max-w-sm overflow-hidden">
            {pages.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentPage(i)}
                className={`w-2 h-2 rounded-full transition-all ${
                  i === currentPage
                    ? "bg-white w-6"
                    : "bg-stone-600 hover:bg-stone-500"
                }`}
              />
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages - 1))}
            disabled={currentPage === totalPages - 1}
            className="sm:hidden text-stone-400"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Page Components ---

function CoverPage({
  layoutData,
  theme,
  recipeCount,
}: {
  layoutData: PrintLayoutData;
  theme: typeof THEMES.classic;
  recipeCount: number;
}) {
  return (
    <div className={`h-full flex flex-col items-center justify-center p-8 sm:p-12 ${theme.coverBg} text-center relative overflow-hidden`}>
      <div className={`absolute top-0 left-0 w-full h-2 ${theme.accent}`} />
      <div className={`absolute bottom-0 left-0 w-full h-2 ${theme.accent}`} />
      <div className={`absolute top-6 left-6 right-6 bottom-6 border-2 ${theme.borderAccent} rounded-lg pointer-events-none`} />

      <div className={`w-20 h-20 rounded-full ${theme.iconBg} flex items-center justify-center mb-6 shadow-lg`}>
        <BookOpen className="h-10 w-10 text-white" />
      </div>

      <h1 className={`text-2xl sm:text-3xl ${theme.titleFont} font-bold ${theme.titleColor} mb-2 leading-tight px-4`}>
        {layoutData.title || "My Cookbook"}
      </h1>

      {layoutData.subtitle && (
        <p className={`text-sm sm:text-base ${theme.subtitleColor} mb-4 max-w-md italic`}>
          {layoutData.subtitle}
        </p>
      )}

      <div className="mt-auto">
        {layoutData.authorName && (
          <p className={`text-sm ${theme.mutedColor} font-medium tracking-wide uppercase`}>
            by {layoutData.authorName}
          </p>
        )}
        <p className={`text-xs ${theme.lightColor} mt-2`}>
          {recipeCount} recipe{recipeCount !== 1 ? "s" : ""}
        </p>
      </div>
    </div>
  );
}

function DedicationPage({
  layoutData,
  theme,
}: {
  layoutData: PrintLayoutData;
  theme: typeof THEMES.classic;
}) {
  return (
    <div className={`h-full flex flex-col items-center justify-center p-8 sm:p-12 bg-white text-center`}>
      <p className={`${theme.titleFont} text-base sm:text-lg italic ${theme.subtitleColor} max-w-sm leading-relaxed`}>
        {layoutData.dedication}
      </p>
    </div>
  );
}

function TocPage({
  sections,
  recipesById,
  theme,
  onGoToRecipe,
}: {
  sections: PrintLayoutData["sections"];
  recipesById: Map<string, Recipe>;
  theme: typeof THEMES.classic;
  onGoToRecipe: (index: number) => void;
}) {
  let globalIdx = 0;

  return (
    <div className="h-full flex flex-col p-6 sm:p-8 bg-white overflow-y-auto">
      <h2 className={`text-lg sm:text-xl ${theme.titleFont} font-bold ${theme.titleColor} mb-1 text-center`}>
        Table of Contents
      </h2>
      <div className={`w-16 h-0.5 ${theme.dividerColor} mx-auto mb-5`} />

      <div className="flex-1 space-y-0">
        {sections.map((section, sIdx) => (
          <div key={section.id || sIdx}>
            {sections.length > 1 && (
              <div className={`text-xs font-bold uppercase tracking-wider ${theme.accentText} mt-3 mb-1 pb-1 border-b ${theme.borderAccent}`}>
                {section.title}
              </div>
            )}
            {section.recipeIds.map((id) => {
              const recipe = recipesById.get(String(id));
              if (!recipe) return null;
              const idx = globalIdx++;
              return (
                <button
                  key={id}
                  onClick={() => onGoToRecipe(idx)}
                  className={`w-full flex items-baseline gap-2 py-1 px-2 rounded hover:${theme.accentBg} transition text-left group`}
                >
                  <span className={`text-xs ${theme.lightColor} font-mono w-5 shrink-0`}>
                    {idx + 1}
                  </span>
                  <span className={`text-xs ${theme.bodyColor} group-hover:${theme.accentText} truncate flex-1`}>
                    {recipe.title}
                  </span>
                  <span className={`text-xs ${theme.lightColor} shrink-0`}>
                    {formatTime(recipe.totalTimeMinutes || recipe.cookTimeMinutes)}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionPage({
  title,
  theme,
}: {
  title: string;
  theme: typeof THEMES.classic;
}) {
  return (
    <div className={`h-full flex flex-col items-center justify-center p-8 sm:p-12 ${theme.sectionBg} text-center relative overflow-hidden`}>
      <div className={`absolute top-6 left-6 right-6 bottom-6 border ${theme.borderAccent} rounded-lg pointer-events-none`} />
      <span className={`text-2xl ${theme.lightColor} mb-4`}>{theme.sectionDecor}</span>
      <h2 className={`text-xl sm:text-2xl ${theme.titleFont} font-bold ${theme.titleColor} mb-2`}>
        {title}
      </h2>
      <div className={`w-12 h-0.5 ${theme.dividerColor} mx-auto`} />
    </div>
  );
}

function RecipePage({
  recipe,
  index,
  theme,
}: {
  recipe: Recipe;
  index: number;
  theme: typeof THEMES.classic;
}) {
  const ingredients = recipe.normalizedIngredients ||
    (recipe.ingredients || []).map((raw: any) =>
      typeof raw === "string" ? { raw, item: raw } : raw
    );
  const instructions = recipe.normalizedInstructions ||
    (recipe.instructions || []).map((text: any, i: number) =>
      typeof text === "string" ? { stepNumber: i + 1, text } : text
    );

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      {/* Recipe image header */}
      {(recipe.dishImageThumbnail || recipe.dishImage) && (
        <div className="relative h-36 sm:h-44 shrink-0">
          <img
            src={recipe.dishImageThumbnail || recipe.dishImage || ""}
            alt={recipe.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-5">
            <h2 className={`text-lg sm:text-xl ${theme.titleFont} font-bold text-white leading-tight`}>
              {recipe.title}
            </h2>
          </div>
        </div>
      )}

      <div className="flex-1 p-4 sm:p-5">
        {/* Title if no image */}
        {!recipe.dishImageThumbnail && !recipe.dishImage && (
          <div className="mb-3">
            <h2 className={`text-lg sm:text-xl ${theme.titleFont} font-bold ${theme.titleColor}`}>
              {recipe.title}
            </h2>
            <div className={`w-10 h-0.5 ${theme.dividerColor} mt-1.5`} />
          </div>
        )}

        {/* Time/servings badges */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {recipe.prepTimeMinutes && (
            <span className={`text-[10px] ${theme.badgeAccent} px-2 py-0.5 rounded-full`}>
              Prep: {formatTime(recipe.prepTimeMinutes)}
            </span>
          )}
          {recipe.cookTimeMinutes && (
            <span className={`text-[10px] ${theme.badgeAccent} px-2 py-0.5 rounded-full`}>
              Cook: {formatTime(recipe.cookTimeMinutes)}
            </span>
          )}
          {recipe.servings && (
            <span className={`text-[10px] ${theme.badgeNeutral} px-2 py-0.5 rounded-full`}>
              Serves {recipe.servings}
            </span>
          )}
        </div>

        {recipe.description && (
          <p className={`text-xs ${theme.subtitleColor} italic mb-3 leading-relaxed`}>
            {recipe.description}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.5fr] gap-3 sm:gap-4">
          {/* Ingredients */}
          <div>
            <h3 className={`text-xs font-bold ${theme.headingColor} uppercase tracking-wider mb-1.5`}>
              Ingredients
            </h3>
            <ul className="space-y-0.5">
              {ingredients.map((ing: any, idx: number) => {
                const quantityStr = formatQuantity(ing.quantity, ing.unit);
                return (
                  <li key={idx} className={`text-xs ${theme.bodyColor} flex gap-1`}>
                    {quantityStr && (
                      <span className={`font-medium ${theme.titleColor} shrink-0`}>{quantityStr}</span>
                    )}
                    <span>
                      {ing.item || ing.name || ing.raw || ""}
                      {ing.preparation && <span className={theme.mutedColor}>, {ing.preparation}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Instructions */}
          <div>
            <h3 className={`text-xs font-bold ${theme.headingColor} uppercase tracking-wider mb-1.5`}>
              Instructions
            </h3>
            <ol className="space-y-1.5">
              {instructions.map((step: any, idx: number) => (
                <li key={idx} className={`text-xs ${theme.bodyColor} flex gap-1.5`}>
                  <span className={`font-bold ${theme.stepColor} shrink-0`}>{idx + 1}.</span>
                  <span className="leading-relaxed">
                    {typeof step === "string" ? step : step.text || step.instruction}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Tips */}
        {recipe.tips && (recipe.tips as any[]).length > 0 && (
          <div className={`mt-3 p-2.5 ${theme.tipBg} rounded-lg border ${theme.tipBorder}`}>
            <h4 className={`text-[10px] font-bold ${theme.tipTitle} uppercase tracking-wider mb-1`}>Tips</h4>
            {(recipe.tips as any[]).map((tip: any, idx: number) => (
              <p key={idx} className={`text-[10px] ${theme.tipText} leading-relaxed`}>
                {typeof tip === "string" ? tip : tip.text}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Page number */}
      <div className={`text-center py-1.5 text-[10px] ${theme.lightColor} shrink-0`}>
        {index + 1}
      </div>
    </div>
  );
}

function BackPage({
  layoutData,
  theme,
}: {
  layoutData: PrintLayoutData;
  theme: typeof THEMES.classic;
}) {
  return (
    <div className={`h-full flex flex-col items-center justify-center p-8 sm:p-12 ${theme.backBg} text-center relative`}>
      <div className={`absolute top-0 left-0 w-full h-2 ${theme.accent}`} />
      <div className={`absolute bottom-0 left-0 w-full h-2 ${theme.accent}`} />

      <BookOpen className={`h-14 w-14 ${theme.lightColor} mb-6`} />
      <h2 className={`text-lg sm:text-xl ${theme.titleFont} font-bold ${theme.titleColor} mb-2`}>
        {layoutData.title || "My Cookbook"}
      </h2>
      {layoutData.subtitle && (
        <p className={`text-sm ${theme.mutedColor} italic max-w-sm mb-8`}>
          {layoutData.subtitle}
        </p>
      )}
      <p className={`text-xs ${theme.lightColor} mt-auto`}>
        Made with Grammie
      </p>
    </div>
  );
}
