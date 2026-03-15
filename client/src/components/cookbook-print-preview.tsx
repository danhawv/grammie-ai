import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  Ruler, BookOpen,
} from "lucide-react";
import type { PrintLayoutData } from "@shared/schema";
import { BOOK_SIZES, type TrimSizeId } from "@/lib/print-constants";

// --- Constants ---
const DPI = 96;
const BLEED = 0.125; // inches
const MARGIN_OUTER = 0.5;
const MARGIN_INNER = 0.75;
const MARGIN_TOP = 0.5;
const MARGIN_BOTTOM = 0.5;

interface Recipe {
  id: string | number;
  title: string;
  description?: string | null;
  dishImage?: string | null;
  dishImageThumbnail?: string | null;
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
}

interface CookbookPrintPreviewProps {
  open: boolean;
  onClose: () => void;
  layoutData: PrintLayoutData;
  templateStyle: 'classic' | 'modern' | 'rustic' | 'elegant';
  cookbookId: number;
  trimSize?: string;
}

// --- Theme configurations ---
const THEMES = {
  classic: {
    name: 'Classic',
    bg: 'bg-amber-50',
    bgCover: 'bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100',
    bgBack: 'bg-gradient-to-br from-stone-50 via-stone-100 to-stone-50',
    titleFont: 'font-serif',
    bodyFont: 'font-sans',
    accent: 'text-orange-600',
    accentBg: 'bg-orange-50',
    accentBorder: 'border-orange-200',
    accentBar: 'bg-gradient-to-r from-orange-400 via-amber-500 to-orange-400',
    divider: 'bg-orange-400',
    stepNumber: 'text-orange-500',
    badgeBg: 'bg-orange-50 text-orange-700',
    tipsBg: 'bg-amber-50 border-amber-100',
    tipsTitle: 'text-amber-800',
    tipsText: 'text-amber-700',
    borderFrame: 'border-orange-200/50',
    pageNumColor: 'text-stone-400',
  },
  modern: {
    name: 'Modern',
    bg: 'bg-white',
    bgCover: 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900',
    bgBack: 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900',
    titleFont: 'font-sans',
    bodyFont: 'font-sans',
    accent: 'text-blue-500',
    accentBg: 'bg-blue-50',
    accentBorder: 'border-blue-200',
    accentBar: 'bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-500',
    divider: 'bg-blue-500',
    stepNumber: 'text-blue-500',
    badgeBg: 'bg-blue-50 text-blue-700',
    tipsBg: 'bg-slate-50 border-slate-200',
    tipsTitle: 'text-slate-800',
    tipsText: 'text-slate-600',
    borderFrame: 'border-slate-300/50',
    pageNumColor: 'text-slate-400',
  },
  rustic: {
    name: 'Rustic',
    bg: 'bg-amber-50/50',
    bgCover: 'bg-gradient-to-br from-yellow-100 via-amber-100 to-yellow-200',
    bgBack: 'bg-gradient-to-br from-amber-100 via-yellow-100 to-amber-200',
    titleFont: 'font-serif',
    bodyFont: 'font-sans',
    accent: 'text-amber-700',
    accentBg: 'bg-amber-100',
    accentBorder: 'border-amber-300',
    accentBar: 'bg-gradient-to-r from-amber-600 via-yellow-600 to-amber-600',
    divider: 'bg-amber-600',
    stepNumber: 'text-amber-600',
    badgeBg: 'bg-amber-100 text-amber-800',
    tipsBg: 'bg-yellow-50 border-yellow-200',
    tipsTitle: 'text-yellow-900',
    tipsText: 'text-yellow-800',
    borderFrame: 'border-amber-300/50',
    pageNumColor: 'text-amber-400',
  },
  elegant: {
    name: 'Elegant',
    bg: 'bg-stone-50',
    bgCover: 'bg-gradient-to-br from-stone-800 via-stone-700 to-stone-900',
    bgBack: 'bg-gradient-to-br from-stone-800 via-stone-700 to-stone-900',
    titleFont: 'font-serif',
    bodyFont: 'font-serif',
    accent: 'text-rose-600',
    accentBg: 'bg-rose-50',
    accentBorder: 'border-rose-200',
    accentBar: 'bg-gradient-to-r from-rose-400 via-pink-400 to-rose-400',
    divider: 'bg-rose-400',
    stepNumber: 'text-rose-500',
    badgeBg: 'bg-rose-50 text-rose-700',
    tipsBg: 'bg-rose-50 border-rose-100',
    tipsTitle: 'text-rose-800',
    tipsText: 'text-rose-700',
    borderFrame: 'border-rose-200/50',
    pageNumColor: 'text-stone-400',
  },
};

// --- Helpers ---
function formatTime(minutes: number | null | undefined): string {
  if (!minutes) return "";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatQuantity(quantity: number | undefined, unit: string | undefined): string {
  if (!quantity) return "";
  const fractionMap: Record<number, string> = {
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
  } else if (decimal > 0) {
    quantityStr = quantity.toFixed(1).replace(/\.0$/, "");
  }
  if (unit) quantityStr += ` ${unit}`;
  return quantityStr.trim();
}

// --- Auto-resize hook ---
// Measures content and scales it down to fit within the page
function useAutoResize(deps: any[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    // Reset scale to measure natural size
    content.style.transform = 'scale(1)';
    content.style.transformOrigin = 'top left';

    // Use requestAnimationFrame to ensure layout is computed
    requestAnimationFrame(() => {
      const containerHeight = container.clientHeight;
      const contentHeight = content.scrollHeight;

      if (contentHeight > containerHeight) {
        const newScale = Math.max(0.5, containerHeight / contentHeight);
        setScale(newScale);
      } else {
        setScale(1);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { containerRef, contentRef, scale };
}

// --- Page types ---
type PageContent =
  | { type: "cover" }
  | { type: "dedication" }
  | { type: "toc" }
  | { type: "section-divider"; title: string }
  | { type: "recipe"; recipe: Recipe; index: number }
  | { type: "back" };

// --- Main component ---
export function CookbookPrintPreview({
  open,
  onClose,
  layoutData,
  templateStyle,
  cookbookId,
  trimSize: trimSizeProp,
}: CookbookPrintPreviewProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [showGuides, setShowGuides] = useState(false);

  const theme = THEMES[templateStyle] || THEMES.classic;
  const sizeId = (trimSizeProp || '0600X0900') as TrimSizeId;
  const bookSize = BOOK_SIZES[sizeId] || BOOK_SIZES['0600X0900'];

  // Page dimensions in pixels at 96 DPI
  const pageWidthPx = bookSize.width * DPI;
  const pageHeightPx = bookSize.height * DPI;

  // Fetch recipes
  const { data: recipesData } = useQuery<{ recipes: Recipe[] }>({
    queryKey: ['/api/cookbooks', cookbookId, 'recipes', 'print'],
    queryFn: async () => {
      const response = await fetch(`/api/cookbooks/${cookbookId}/recipes/print`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to load recipes');
      return response.json();
    },
    enabled: open && !!cookbookId,
  });

  const recipes = recipesData?.recipes || [];

  // Build ordered recipe list from layout sections
  const orderedRecipes = useMemo(() => {
    if (!layoutData?.sections?.length) return recipes;
    const recipeMap = new Map(recipes.map(r => [String(r.id), r]));
    const ordered: Recipe[] = [];
    for (const section of layoutData.sections) {
      for (const rid of section.recipeIds) {
        const recipe = recipeMap.get(String(rid));
        if (recipe) ordered.push(recipe);
      }
    }
    // Add any recipes not in sections
    if (ordered.length === 0) return recipes;
    return ordered;
  }, [recipes, layoutData?.sections]);

  // Build pages
  const pages: PageContent[] = useMemo(() => {
    const p: PageContent[] = [];
    p.push({ type: "cover" });
    if (layoutData?.dedication) p.push({ type: "dedication" });
    if (orderedRecipes.length > 0) {
      p.push({ type: "toc" });
      // If sections exist, add section dividers
      if (layoutData?.sections?.length) {
        let recipeIndex = 0;
        for (const section of layoutData.sections) {
          if (section.title) {
            p.push({ type: "section-divider", title: section.title });
          }
          for (const rid of section.recipeIds) {
            const recipe = orderedRecipes.find(r => String(r.id) === String(rid));
            if (recipe) {
              p.push({ type: "recipe", recipe, index: recipeIndex });
              recipeIndex++;
            }
          }
        }
      } else {
        orderedRecipes.forEach((recipe, index) => {
          p.push({ type: "recipe", recipe, index });
        });
      }
    }
    p.push({ type: "back" });
    return p;
  }, [orderedRecipes, layoutData]);

  const totalPages = pages.length;

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

  // Reset page on open
  useEffect(() => {
    if (open) setCurrentPage(0);
  }, [open]);

  const page = pages[currentPage];
  const isDarkCover = templateStyle === 'modern' || templateStyle === 'elegant';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] w-auto h-auto p-0 border-0 bg-stone-900/95 overflow-hidden [&>button]:hidden">
        {/* Top toolbar */}
        <div className="flex items-center justify-between px-4 py-2 bg-stone-800 text-white border-b border-stone-700">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">
              {layoutData?.title || 'Cookbook'} — Preview
            </span>
            <span className="text-xs text-stone-400">
              Page {currentPage + 1} / {totalPages} • {bookSize.description}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Zoom controls */}
            <Button
              variant="ghost" size="sm"
              className="text-stone-300 hover:text-white hover:bg-stone-700 h-7 px-2"
              onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs text-stone-400 w-10 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              variant="ghost" size="sm"
              className="text-stone-300 hover:text-white hover:bg-stone-700 h-7 px-2"
              onClick={() => setZoom(z => Math.min(2, z + 0.1))}
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>

            {/* Measurement guides toggle */}
            <Button
              variant="ghost" size="sm"
              className={`h-7 px-2 ${showGuides ? 'text-blue-400 bg-stone-700' : 'text-stone-300 hover:text-white hover:bg-stone-700'}`}
              onClick={() => setShowGuides(!showGuides)}
              title="Toggle measurement guides"
            >
              <Ruler className="h-3.5 w-3.5" />
            </Button>

            {/* Close */}
            <Button
              variant="ghost" size="sm"
              className="text-stone-300 hover:text-white hover:bg-stone-700 h-7 px-2"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Main preview area */}
        <div className="flex items-center justify-center flex-1 min-h-0 p-6 overflow-auto">
          {/* Left arrow */}
          <button
            onClick={() => setCurrentPage(p => Math.max(p - 1, 0))}
            disabled={currentPage === 0}
            className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-white/10 transition disabled:opacity-20 disabled:cursor-default mr-4 shrink-0"
          >
            <ChevronLeft className="h-6 w-6 text-white" />
          </button>

          {/* Page container with exact trim size dimensions */}
          <div
            className="relative shrink-0"
            style={{
              width: pageWidthPx * zoom,
              height: pageHeightPx * zoom,
            }}
          >
            {/* The actual page */}
            <div
              className="absolute top-0 left-0 bg-white rounded shadow-2xl overflow-hidden"
              style={{
                width: pageWidthPx,
                height: pageHeightPx,
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.1)',
              }}
            >
              {page?.type === "cover" && (
                <CoverPage
                  layoutData={layoutData}
                  theme={theme}
                  isDark={isDarkCover}
                  recipes={orderedRecipes}
                  width={pageWidthPx}
                  height={pageHeightPx}
                />
              )}
              {page?.type === "dedication" && (
                <DedicationPage
                  dedication={layoutData.dedication || ''}
                  theme={theme}
                  width={pageWidthPx}
                  height={pageHeightPx}
                />
              )}
              {page?.type === "toc" && (
                <TocPage
                  recipes={orderedRecipes}
                  sections={layoutData?.sections}
                  theme={theme}
                  onGoToRecipe={(i) => {
                    // Find the recipe page index
                    const recipePageIdx = pages.findIndex(
                      p => p.type === 'recipe' && (p as any).index === i
                    );
                    if (recipePageIdx >= 0) setCurrentPage(recipePageIdx);
                  }}
                  width={pageWidthPx}
                  height={pageHeightPx}
                />
              )}
              {page?.type === "section-divider" && (
                <SectionDividerPage
                  title={page.title}
                  theme={theme}
                  width={pageWidthPx}
                  height={pageHeightPx}
                />
              )}
              {page?.type === "recipe" && (
                <RecipePage
                  recipe={page.recipe}
                  index={page.index}
                  theme={theme}
                  templateStyle={templateStyle}
                  width={pageWidthPx}
                  height={pageHeightPx}
                  includePhoto={
                    layoutData?.recipePrintSettings?.[String(page.recipe.id)]?.includePhoto !== false
                  }
                />
              )}
              {page?.type === "back" && (
                <BackPage
                  layoutData={layoutData}
                  theme={theme}
                  isDark={isDarkCover}
                  width={pageWidthPx}
                  height={pageHeightPx}
                />
              )}

              {/* Measurement guides overlay */}
              {showGuides && (
                <MeasurementGuides width={pageWidthPx} height={pageHeightPx} />
              )}
            </div>
          </div>

          {/* Right arrow */}
          <button
            onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages - 1))}
            disabled={currentPage === totalPages - 1}
            className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-white/10 transition disabled:opacity-20 disabled:cursor-default ml-4 shrink-0"
          >
            <ChevronRight className="h-6 w-6 text-white" />
          </button>
        </div>

        {/* Page thumbnails strip */}
        <div className="flex items-center gap-2 px-4 py-2 bg-stone-800 border-t border-stone-700 overflow-x-auto">
          {pages.map((p, i) => (
            <button
              key={i}
              onClick={() => setCurrentPage(i)}
              className={`shrink-0 rounded border-2 transition-all ${
                i === currentPage
                  ? 'border-blue-500 shadow-lg shadow-blue-500/30'
                  : 'border-transparent hover:border-stone-500 opacity-60 hover:opacity-100'
              }`}
              style={{ width: 40, height: 40 * (bookSize.height / bookSize.width) }}
            >
              <div className="w-full h-full bg-white rounded-sm flex items-center justify-center">
                <span className="text-[8px] text-stone-500">{i + 1}</span>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Page Components — each renders a single page that auto-fits its content
// ============================================================================

function CoverPage({
  layoutData, theme, isDark, recipes, width, height,
}: {
  layoutData: PrintLayoutData;
  theme: typeof THEMES['classic'];
  isDark: boolean;
  recipes: Recipe[];
  width: number;
  height: number;
}) {
  const marginH = MARGIN_OUTER * DPI;
  const marginV = MARGIN_TOP * DPI;

  return (
    <div
      className={`w-full h-full flex flex-col items-center justify-center text-center relative overflow-hidden ${theme.bgCover}`}
      style={{ padding: `${marginV}px ${marginH}px` }}
    >
      {/* Top accent bar */}
      <div className={`absolute top-0 left-0 w-full h-2 ${theme.accentBar}`} />
      <div className={`absolute bottom-0 left-0 w-full h-2 ${theme.accentBar}`} />

      {/* Decorative border */}
      <div
        className={`absolute border-2 ${theme.borderFrame} rounded-lg pointer-events-none`}
        style={{ top: marginV * 0.4, left: marginH * 0.5, right: marginH * 0.5, bottom: marginV * 0.4 }}
      />

      {layoutData?.coverImage || layoutData?.coverData?.frontImageUrl ? (
        <img
          src={layoutData.coverData?.frontImageUrl || layoutData.coverImage || ''}
          alt=""
          className="w-24 h-24 rounded-full object-cover mb-4 ring-4 ring-white/30 shadow-lg"
          style={{ maxWidth: width * 0.25 }}
        />
      ) : (
        <div
          className={`rounded-full flex items-center justify-center mb-4 shadow-lg ${
            isDark ? 'bg-white/10' : 'bg-gradient-to-br from-orange-400 to-amber-500'
          }`}
          style={{ width: Math.min(96, width * 0.2), height: Math.min(96, width * 0.2) }}
        >
          <BookOpen className={`${isDark ? 'text-white/80' : 'text-white'}`} style={{ width: Math.min(48, width * 0.1) }} />
        </div>
      )}

      <h1
        className={`${theme.titleFont} font-bold leading-tight mb-2 ${isDark ? 'text-white' : 'text-stone-800'}`}
        style={{ fontSize: Math.min(36, width * 0.06) }}
      >
        {layoutData?.title || 'My Cookbook'}
      </h1>

      {layoutData?.subtitle && (
        <p
          className={`italic mb-4 ${isDark ? 'text-white/70' : 'text-stone-600'}`}
          style={{ fontSize: Math.min(16, width * 0.025), maxWidth: width * 0.7 }}
        >
          {layoutData.subtitle}
        </p>
      )}

      <div className="mt-auto">
        <p
          className={`font-medium tracking-wide uppercase ${isDark ? 'text-white/60' : 'text-stone-500'}`}
          style={{ fontSize: Math.min(14, width * 0.022) }}
        >
          by {layoutData?.authorName || 'Chef'}
        </p>
        <p
          className={`mt-1 ${isDark ? 'text-white/40' : 'text-stone-400'}`}
          style={{ fontSize: Math.min(12, width * 0.018) }}
        >
          {recipes.length} recipe{recipes.length !== 1 ? 's' : ''}
        </p>
      </div>
    </div>
  );
}

function DedicationPage({
  dedication, theme, width, height,
}: {
  dedication: string;
  theme: typeof THEMES['classic'];
  width: number;
  height: number;
}) {
  const marginH = MARGIN_OUTER * DPI;
  const marginV = MARGIN_TOP * DPI;

  return (
    <div
      className={`w-full h-full flex flex-col items-center justify-center text-center ${theme.bg}`}
      style={{ padding: `${marginV}px ${marginH}px` }}
    >
      <p
        className={`${theme.titleFont} italic text-stone-600 leading-relaxed max-w-[80%]`}
        style={{ fontSize: Math.min(18, width * 0.03) }}
      >
        "{dedication}"
      </p>
    </div>
  );
}

function TocPage({
  recipes, sections, theme, onGoToRecipe, width, height,
}: {
  recipes: Recipe[];
  sections?: PrintLayoutData['sections'];
  theme: typeof THEMES['classic'];
  onGoToRecipe: (index: number) => void;
  width: number;
  height: number;
}) {
  const marginH = MARGIN_OUTER * DPI;
  const marginV = MARGIN_TOP * DPI;
  const { containerRef, contentRef, scale } = useAutoResize([recipes, width, height]);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full overflow-hidden ${theme.bg}`}
      style={{ padding: `${marginV}px ${marginH}px` }}
    >
      <div
        ref={contentRef}
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          width: `${100 / scale}%`,
        }}
      >
        <h2
          className={`${theme.titleFont} font-bold text-stone-800 text-center mb-1`}
          style={{ fontSize: Math.min(24, width * 0.04) }}
        >
          Table of Contents
        </h2>
        <div className={`w-12 h-0.5 ${theme.divider} mx-auto mb-4`} />

        <div className="space-y-0">
          {recipes.map((recipe, idx) => (
            <button
              key={String(recipe.id)}
              onClick={() => onGoToRecipe(idx)}
              className={`w-full flex items-baseline gap-2 py-1 px-1.5 rounded hover:${theme.accentBg} transition text-left group`}
            >
              <span
                className="text-stone-400 font-mono shrink-0"
                style={{ fontSize: Math.min(11, width * 0.018), width: '1.5em' }}
              >
                {idx + 1}
              </span>
              <span
                className={`text-stone-700 group-hover:${theme.accent} truncate flex-1`}
                style={{ fontSize: Math.min(13, width * 0.021) }}
              >
                {recipe.title}
              </span>
              <span
                className="text-stone-400 shrink-0"
                style={{ fontSize: Math.min(10, width * 0.016) }}
              >
                {formatTime(recipe.totalTimeMinutes || recipe.cookTimeMinutes)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionDividerPage({
  title, theme, width, height,
}: {
  title: string;
  theme: typeof THEMES['classic'];
  width: number;
  height: number;
}) {
  return (
    <div
      className={`w-full h-full flex flex-col items-center justify-center text-center ${theme.bg}`}
    >
      <div className={`w-16 h-0.5 ${theme.divider} mb-4`} />
      <h2
        className={`${theme.titleFont} font-bold text-stone-800`}
        style={{ fontSize: Math.min(32, width * 0.05) }}
      >
        {title}
      </h2>
      <div className={`w-16 h-0.5 ${theme.divider} mt-4`} />
    </div>
  );
}

function RecipePage({
  recipe, index, theme, templateStyle, width, height, includePhoto,
}: {
  recipe: Recipe;
  index: number;
  theme: typeof THEMES['classic'];
  templateStyle: string;
  width: number;
  height: number;
  includePhoto: boolean;
}) {
  const marginH = MARGIN_OUTER * DPI;
  const marginV = MARGIN_TOP * DPI;
  const { containerRef, contentRef, scale } = useAutoResize([recipe, width, height, includePhoto]);

  const ingredients = recipe.normalizedIngredients ||
    (recipe.ingredients || []).map((raw: any) =>
      typeof raw === 'string' ? { raw, item: raw } : raw
    );
  const instructions = recipe.normalizedInstructions ||
    (recipe.instructions || []).map((text: any, i: number) =>
      typeof text === 'string' ? { stepNumber: i + 1, text } : text
    );

  const hasImage = includePhoto && (recipe.dishImageThumbnail || recipe.dishImage);
  const imageUrl = recipe.dishImageThumbnail || recipe.dishImage || '';

  // Calculate dynamic sizes based on page width
  const titleSize = Math.min(20, width * 0.035);
  const bodySize = Math.min(12, width * 0.02);
  const labelSize = Math.min(10, width * 0.016);
  const imageHeight = hasImage ? Math.min(height * 0.28, 200) : 0;

  return (
    <div
      ref={containerRef}
      className={`w-full h-full overflow-hidden ${theme.bg}`}
    >
      <div
        ref={contentRef}
        className="flex flex-col"
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          width: `${100 / scale}%`,
          minHeight: height,
        }}
      >
        {/* Recipe image header */}
        {hasImage && (
          <div className="relative shrink-0" style={{ height: imageHeight }}>
            <img
              src={imageUrl}
              alt={recipe.title}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-3" style={{ paddingLeft: marginH, paddingRight: marginH }}>
              <h2
                className={`${theme.titleFont} font-bold text-white leading-tight`}
                style={{ fontSize: titleSize }}
              >
                {recipe.title}
              </h2>
            </div>
          </div>
        )}

        <div
          className="flex-1 flex flex-col"
          style={{
            padding: `${hasImage ? marginV * 0.5 : marginV}px ${marginH}px ${marginV * 0.5}px`,
          }}
        >
          {/* Title if no image */}
          {!hasImage && (
            <div className="mb-2">
              <h2
                className={`${theme.titleFont} font-bold text-stone-800`}
                style={{ fontSize: titleSize }}
              >
                {recipe.title}
              </h2>
              <div className={`w-10 h-0.5 ${theme.divider} mt-1`} />
            </div>
          )}

          {/* Time/servings badges */}
          <div className="flex flex-wrap gap-1 mb-2">
            {recipe.prepTimeMinutes && (
              <span
                className={`${theme.badgeBg} px-1.5 py-0.5 rounded-full`}
                style={{ fontSize: labelSize }}
              >
                Prep: {formatTime(recipe.prepTimeMinutes)}
              </span>
            )}
            {recipe.cookTimeMinutes && (
              <span
                className={`${theme.badgeBg} px-1.5 py-0.5 rounded-full`}
                style={{ fontSize: labelSize }}
              >
                Cook: {formatTime(recipe.cookTimeMinutes)}
              </span>
            )}
            {recipe.servings && (
              <span
                className="bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded-full"
                style={{ fontSize: labelSize }}
              >
                Serves {recipe.servings}
              </span>
            )}
          </div>

          {/* Description */}
          {recipe.description && (
            <p
              className="text-stone-600 italic mb-2 leading-snug"
              style={{ fontSize: bodySize * 0.9 }}
            >
              {recipe.description}
            </p>
          )}

          {/* Two-column layout: ingredients + instructions */}
          <div
            className="grid gap-3 flex-1"
            style={{ gridTemplateColumns: '1fr 1.5fr' }}
          >
            {/* Ingredients */}
            <div>
              <h3
                className="font-bold text-stone-800 uppercase tracking-wider mb-1"
                style={{ fontSize: labelSize }}
              >
                Ingredients
              </h3>
              <ul className="space-y-0.5">
                {ingredients.map((ing: any, idx: number) => {
                  const quantityStr = formatQuantity(ing.quantity, ing.unit);
                  return (
                    <li key={idx} className="text-stone-700 flex gap-1" style={{ fontSize: bodySize }}>
                      {quantityStr && (
                        <span className="font-medium text-stone-900 shrink-0">{quantityStr}</span>
                      )}
                      <span>
                        {ing.item || ing.raw || ing.name || ''}
                        {ing.preparation && <span className="text-stone-500">, {ing.preparation}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Instructions */}
            <div>
              <h3
                className="font-bold text-stone-800 uppercase tracking-wider mb-1"
                style={{ fontSize: labelSize }}
              >
                Instructions
              </h3>
              <ol className="space-y-1">
                {instructions.map((step: any, idx: number) => (
                  <li key={idx} className="text-stone-700 flex gap-1.5" style={{ fontSize: bodySize }}>
                    <span className={`font-bold ${theme.stepNumber} shrink-0`}>{idx + 1}.</span>
                    <span className="leading-snug">{typeof step === 'string' ? step : step.text}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* Tips */}
          {recipe.tips && Array.isArray(recipe.tips) && recipe.tips.length > 0 && (
            <div className={`mt-2 p-2 rounded border ${theme.tipsBg}`}>
              <h4
                className={`font-bold ${theme.tipsTitle} uppercase tracking-wider mb-0.5`}
                style={{ fontSize: labelSize * 0.9 }}
              >
                Tips
              </h4>
              {(recipe.tips as any[]).map((tip: any, idx: number) => (
                <p
                  key={idx}
                  className={`${theme.tipsText} leading-snug`}
                  style={{ fontSize: bodySize * 0.85 }}
                >
                  {typeof tip === 'string' ? tip : tip.text}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Page number */}
        <div className={`text-center pb-2 ${theme.pageNumColor} shrink-0`} style={{ fontSize: labelSize }}>
          {index + 1}
        </div>
      </div>
    </div>
  );
}

function BackPage({
  layoutData, theme, isDark, width, height,
}: {
  layoutData: PrintLayoutData;
  theme: typeof THEMES['classic'];
  isDark: boolean;
  width: number;
  height: number;
}) {
  const marginH = MARGIN_OUTER * DPI;
  const marginV = MARGIN_TOP * DPI;

  return (
    <div
      className={`w-full h-full flex flex-col items-center justify-center text-center relative ${theme.bgBack}`}
      style={{ padding: `${marginV}px ${marginH}px` }}
    >
      <div className={`absolute top-0 left-0 w-full h-2 ${theme.accentBar}`} />
      <div className={`absolute bottom-0 left-0 w-full h-2 ${theme.accentBar}`} />

      <BookOpen
        className={`mb-4 ${isDark ? 'text-white/20' : 'text-stone-300'}`}
        style={{ width: Math.min(64, width * 0.12), height: Math.min(64, width * 0.12) }}
      />
      <h2
        className={`${theme.titleFont} font-bold mb-2 ${isDark ? 'text-white' : 'text-stone-700'}`}
        style={{ fontSize: Math.min(24, width * 0.04) }}
      >
        {layoutData?.title || 'My Cookbook'}
      </h2>

      {layoutData?.coverData?.backText && (
        <p
          className={`italic max-w-[80%] mb-6 ${isDark ? 'text-white/60' : 'text-stone-500'}`}
          style={{ fontSize: Math.min(14, width * 0.022) }}
        >
          {layoutData.coverData.backText}
        </p>
      )}

      <p
        className={`mt-auto ${isDark ? 'text-white/30' : 'text-stone-400'}`}
        style={{ fontSize: Math.min(11, width * 0.018) }}
      >
        Made with Grammie
      </p>
    </div>
  );
}

// ============================================================================
// Measurement Guides Overlay
// ============================================================================

function MeasurementGuides({ width, height }: { width: number; height: number }) {
  const bleedPx = BLEED * DPI;
  const marginOuterPx = MARGIN_OUTER * DPI;
  const marginInnerPx = MARGIN_INNER * DPI;
  const marginTopPx = MARGIN_TOP * DPI;
  const marginBottomPx = MARGIN_BOTTOM * DPI;

  return (
    <div className="absolute inset-0 pointer-events-none z-50">
      {/* Bleed zone — red dashed border */}
      <div
        className="absolute border-2 border-dashed border-red-400/60"
        style={{
          top: bleedPx,
          left: bleedPx,
          right: bleedPx,
          bottom: bleedPx,
        }}
      />
      {/* Bleed label */}
      <div
        className="absolute text-red-400 bg-white/80 px-1 rounded"
        style={{ top: 2, left: bleedPx + 4, fontSize: 8 }}
      >
        Bleed {BLEED}"
      </div>

      {/* Margin zone — blue dashed */}
      <div
        className="absolute border border-dashed border-blue-400/50"
        style={{
          top: marginTopPx,
          left: marginInnerPx,
          right: marginOuterPx,
          bottom: marginBottomPx,
        }}
      />
      {/* Margin labels */}
      <div
        className="absolute text-blue-400 bg-white/80 px-1 rounded"
        style={{ top: marginTopPx + 2, left: marginInnerPx + 4, fontSize: 8 }}
      >
        Safe zone ({MARGIN_INNER}" gutter / {MARGIN_OUTER}" outer)
      </div>

      {/* Dimension labels */}
      <div
        className="absolute text-stone-500 bg-white/90 px-1.5 py-0.5 rounded shadow-sm"
        style={{ bottom: 4, right: 4, fontSize: 9 }}
      >
        {(width / DPI).toFixed(2)}" × {(height / DPI).toFixed(2)}"
      </div>

      {/* Center crosshairs */}
      <div
        className="absolute border-l border-dashed border-green-400/30"
        style={{ left: width / 2, top: marginTopPx, bottom: marginBottomPx }}
      />
      <div
        className="absolute border-t border-dashed border-green-400/30"
        style={{ top: height / 2, left: marginInnerPx, right: marginOuterPx }}
      />
    </div>
  );
}
