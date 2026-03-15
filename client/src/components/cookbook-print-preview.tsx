import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  X, ChevronLeft, ChevronRight, BookOpen, ZoomIn, ZoomOut,
  Ruler, Eye, EyeOff,
} from "lucide-react";
import type { PrintLayoutData } from "@shared/schema";
import { BOOK_SIZES, type TrimSizeId } from "@/lib/print-constants";

// --- Constants ---
const DPI = 96; // Screen DPI for virtual stage
const BLEED = 0.125; // Lulu bleed in inches
const MARGIN_OUTER = 0.5; // Outer margin in inches
const MARGIN_INNER = 0.75; // Inner/gutter margin in inches (binding side)
const SAFE_ZONE = 0.25; // Keep critical content this far from trim edge

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
    coverBg: "#fef3c7", // amber-100
    coverAccent: "#f59e0b", // amber-500
    pageBg: "#fffbeb", // amber-50
    sectionBg: "#fef3c7",
    titleFont: "'Georgia', serif",
    bodyFont: "'Georgia', serif",
    titleColor: "#292524", // stone-800
    subtitleColor: "#57534e", // stone-600
    bodyColor: "#44403c", // stone-700
    accentColor: "#ea580c", // orange-600
    mutedColor: "#78716c", // stone-500
    lightColor: "#a8a29e", // stone-400
    badgeBg: "#fff7ed", // orange-50
    badgeColor: "#c2410c", // orange-700
    tipBg: "#fffbeb", // amber-50
    tipBorder: "#fde68a", // amber-200
    tipColor: "#92400e", // amber-800
    dividerColor: "#f59e0b",
    sectionDecor: "✦",
    borderStyle: "2px solid rgba(245, 158, 11, 0.3)",
  },
  modern: {
    coverBg: "#f9fafb", // gray-50
    coverAccent: "#111827", // gray-900
    pageBg: "#ffffff",
    sectionBg: "#f3f4f6",
    titleFont: "'Helvetica Neue', Arial, sans-serif",
    bodyFont: "'Helvetica Neue', Arial, sans-serif",
    titleColor: "#111827",
    subtitleColor: "#6b7280",
    bodyColor: "#374151",
    accentColor: "#111827",
    mutedColor: "#6b7280",
    lightColor: "#9ca3af",
    badgeBg: "#111827",
    badgeColor: "#ffffff",
    tipBg: "#f9fafb",
    tipBorder: "#e5e7eb",
    tipColor: "#374151",
    dividerColor: "#111827",
    sectionDecor: "—",
    borderStyle: "1px solid #e5e7eb",
  },
  rustic: {
    coverBg: "#fef3c7",
    coverAccent: "#92400e",
    pageBg: "#fefce8", // yellow-50
    sectionBg: "#fef9c3",
    titleFont: "'Georgia', 'Cambria', serif",
    bodyFont: "'Georgia', serif",
    titleColor: "#78350f", // amber-900
    subtitleColor: "#92400e",
    bodyColor: "#78350f",
    accentColor: "#b45309",
    mutedColor: "#92400e",
    lightColor: "#d97706",
    badgeBg: "#fef3c7",
    badgeColor: "#92400e",
    tipBg: "#fefce8",
    tipBorder: "#fde68a",
    tipColor: "#78350f",
    dividerColor: "#b45309",
    sectionDecor: "❧",
    borderStyle: "2px solid rgba(180, 83, 9, 0.3)",
  },
  elegant: {
    coverBg: "#f8fafc", // slate-50
    coverAccent: "#475569", // slate-600
    pageBg: "#ffffff",
    sectionBg: "#f1f5f9",
    titleFont: "'Georgia', 'Palatino', serif",
    bodyFont: "'Segoe UI', sans-serif",
    titleColor: "#1e293b",
    subtitleColor: "#64748b",
    bodyColor: "#334155",
    accentColor: "#475569",
    mutedColor: "#64748b",
    lightColor: "#94a3b8",
    badgeBg: "#f1f5f9",
    badgeColor: "#475569",
    tipBg: "#f8fafc",
    tipBorder: "#e2e8f0",
    tipColor: "#475569",
    dividerColor: "#94a3b8",
    sectionDecor: "◆",
    borderStyle: "1px solid #e2e8f0",
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
  const [zoom, setZoom] = useState(1);
  const [showGuides, setShowGuides] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = THEMES[templateStyle] || THEMES.classic;

  // Get trim size dimensions
  const sizeId = (trimSize || "0600X0900") as TrimSizeId;
  const sizeConfig = BOOK_SIZES[sizeId] || BOOK_SIZES["0600X0900"];
  const pageWidthIn = sizeConfig.width;
  const pageHeightIn = sizeConfig.height;

  // Virtual stage dimensions in CSS pixels (at 96 DPI)
  const stageW = pageWidthIn * DPI;
  const stageH = pageHeightIn * DPI;

  // Calculate scale to fit viewport
  const [viewScale, setViewScale] = useState(1);
  useEffect(() => {
    if (!open || !containerRef.current) return;
    const updateScale = () => {
      const container = containerRef.current;
      if (!container) return;
      const availW = container.clientWidth - 120; // padding for arrows
      const availH = container.clientHeight - 20;
      const scaleX = availW / stageW;
      const scaleY = availH / stageH;
      setViewScale(Math.min(scaleX, scaleY, 1.2) * zoom);
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [open, stageW, stageH, zoom]);

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

  // Build pages
  const pages: PageContent[] = useMemo(() => {
    const p: PageContent[] = [];
    p.push({ type: "cover" });
    if (layoutData.dedication) p.push({ type: "dedication" });

    const hasRecipes = layoutData.sections.some(s =>
      s.recipeIds.some(id => recipesById.has(String(id)))
    );
    if (hasRecipes) p.push({ type: "toc" });

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

  useEffect(() => { if (open) setCurrentPage(0); }, [open]);

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
  const isLeftPage = currentPage % 2 === 0; // Even pages are left (verso)

  // Margin calculations in pixels
  const bleedPx = BLEED * DPI;
  const marginOuterPx = MARGIN_OUTER * DPI;
  const marginInnerPx = MARGIN_INNER * DPI;
  const safeZonePx = SAFE_ZONE * DPI;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-[98vw] w-full max-h-[98vh] h-full flex flex-col p-0 gap-0 border-0 bg-neutral-900 [&>button]:hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-neutral-950/90 backdrop-blur border-b border-neutral-800 shrink-0">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-sm font-medium text-white">
                {layoutData.title || "Cookbook Preview"}
              </h2>
              <p className="text-xs text-neutral-400">
                Page {currentPage + 1} of {totalPages}
                {" · "}
                <span className="text-amber-400 font-mono">
                  {pageWidthIn}" × {pageHeightIn}"
                </span>
                {" · "}
                {sizeConfig.name}
                {" · "}
                {templateStyle.charAt(0).toUpperCase() + templateStyle.slice(1)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Zoom controls */}
            <Button
              variant="ghost" size="icon"
              onClick={() => setZoom(z => Math.max(0.5, z - 0.15))}
              className="text-neutral-400 hover:text-white hover:bg-neutral-800 h-8 w-8"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Badge variant="secondary" className="bg-neutral-800 text-neutral-300 text-[10px] font-mono px-1.5">
              {Math.round(viewScale * 100)}%
            </Badge>
            <Button
              variant="ghost" size="icon"
              onClick={() => setZoom(z => Math.min(2, z + 0.15))}
              className="text-neutral-400 hover:text-white hover:bg-neutral-800 h-8 w-8"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>

            <div className="w-px h-5 bg-neutral-700 mx-1" />

            {/* Guide toggle */}
            <Button
              variant="ghost" size="sm"
              onClick={() => setShowGuides(g => !g)}
              className={`text-xs gap-1.5 h-8 ${showGuides ? 'text-cyan-400 hover:text-cyan-300' : 'text-neutral-500 hover:text-neutral-300'} hover:bg-neutral-800`}
            >
              <Ruler className="h-3.5 w-3.5" />
              Guides
            </Button>

            <div className="w-px h-5 bg-neutral-700 mx-1" />

            <Badge variant="secondary" className="bg-neutral-800 text-neutral-300 text-[10px]">
              {allOrderedRecipes.length} recipes
            </Badge>

            <Button
              variant="ghost" size="icon"
              onClick={onClose}
              className="text-neutral-400 hover:text-white hover:bg-neutral-800 h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Main area with page display */}
        <div ref={containerRef} className="flex-1 flex items-center justify-center overflow-hidden min-h-0">
          {/* Left arrow */}
          <button
            onClick={() => setCurrentPage(p => Math.max(p - 1, 0))}
            disabled={currentPage === 0}
            className="hidden sm:flex items-center justify-center w-12 h-12 rounded-full hover:bg-neutral-800 transition disabled:opacity-20 disabled:cursor-default mx-2 shrink-0"
          >
            <ChevronLeft className="h-7 w-7 text-neutral-500" />
          </button>

          {/* The virtual stage */}
          <div className="relative" style={{ width: stageW * viewScale, height: stageH * viewScale }}>
            {/* Bleed area (extends beyond trim) */}
            {showGuides && (
              <div
                className="absolute pointer-events-none"
                style={{
                  top: -bleedPx * viewScale,
                  left: -bleedPx * viewScale,
                  width: (stageW + bleedPx * 2) * viewScale,
                  height: (stageH + bleedPx * 2) * viewScale,
                  border: `1px dashed rgba(239, 68, 68, 0.5)`,
                  zIndex: 30,
                }}
              >
                <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] text-red-400 font-mono whitespace-nowrap">
                  Bleed: {BLEED}" all sides
                </span>
              </div>
            )}

            {/* Trim edge — the actual page */}
            <div
              className="relative overflow-hidden"
              style={{
                width: stageW * viewScale,
                height: stageH * viewScale,
                boxShadow: "0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)",
                borderRadius: 2,
              }}
            >
              {/* The page content, scaled */}
              <div
                style={{
                  width: stageW,
                  height: stageH,
                  transform: `scale(${viewScale})`,
                  transformOrigin: "top left",
                  position: "relative",
                  background: theme.pageBg,
                  overflow: "hidden",
                }}
              >
                {/* Page content with margins applied */}
                <div
                  style={{
                    position: "absolute",
                    top: marginOuterPx,
                    bottom: marginOuterPx,
                    left: isLeftPage ? marginInnerPx : marginOuterPx,
                    right: isLeftPage ? marginOuterPx : marginInnerPx,
                    overflow: "hidden",
                  }}
                >
                  {page?.type === "cover" && (
                    <CoverContent layoutData={layoutData} theme={theme} recipeCount={allOrderedRecipes.length} stageW={stageW} stageH={stageH} />
                  )}
                  {page?.type === "dedication" && (
                    <DedicationContent layoutData={layoutData} theme={theme} />
                  )}
                  {page?.type === "toc" && (
                    <TocContent
                      sections={layoutData.sections}
                      recipesById={recipesById}
                      theme={theme}
                      onGoToRecipe={(idx) => {
                        const target = pages.findIndex(p => p.type === "recipe" && (p as any).index === idx);
                        if (target >= 0) setCurrentPage(target);
                      }}
                    />
                  )}
                  {page?.type === "section" && (
                    <SectionContent title={page.title} theme={theme} />
                  )}
                  {page?.type === "recipe" && (
                    <RecipeContent recipe={page.recipe} index={page.index} theme={theme} pageWidthIn={pageWidthIn} />
                  )}
                  {page?.type === "back" && (
                    <BackContent layoutData={layoutData} theme={theme} />
                  )}
                </div>

                {/* Margin guides overlay */}
                {showGuides && (
                  <>
                    {/* Top margin */}
                    <div className="absolute left-0 right-0 pointer-events-none" style={{ top: 0, height: marginOuterPx }}>
                      <div className="w-full h-full" style={{ background: 'rgba(59, 130, 246, 0.06)' }} />
                      <div className="absolute bottom-0 left-0 right-0 border-b border-dashed" style={{ borderColor: 'rgba(59, 130, 246, 0.35)' }} />
                      <span className="absolute right-2 top-1 text-[8px] font-mono" style={{ color: 'rgba(59, 130, 246, 0.6)' }}>
                        {MARGIN_OUTER}"
                      </span>
                    </div>
                    {/* Bottom margin */}
                    <div className="absolute left-0 right-0 pointer-events-none" style={{ bottom: 0, height: marginOuterPx }}>
                      <div className="w-full h-full" style={{ background: 'rgba(59, 130, 246, 0.06)' }} />
                      <div className="absolute top-0 left-0 right-0 border-t border-dashed" style={{ borderColor: 'rgba(59, 130, 246, 0.35)' }} />
                      <span className="absolute right-2 bottom-1 text-[8px] font-mono" style={{ color: 'rgba(59, 130, 246, 0.6)' }}>
                        {MARGIN_OUTER}"
                      </span>
                    </div>
                    {/* Inner margin (gutter/binding side) */}
                    <div className="absolute top-0 bottom-0 pointer-events-none" style={{
                      [isLeftPage ? 'left' : 'right']: 0,
                      width: marginInnerPx,
                    }}>
                      <div className="w-full h-full" style={{ background: 'rgba(59, 130, 246, 0.08)' }} />
                      <div className="absolute top-0 bottom-0" style={{
                        [isLeftPage ? 'right' : 'left']: 0,
                        borderRight: isLeftPage ? '1px dashed rgba(59, 130, 246, 0.35)' : 'none',
                        borderLeft: !isLeftPage ? '1px dashed rgba(59, 130, 246, 0.35)' : 'none',
                      }} />
                      <span className="absolute top-2 text-[8px] font-mono whitespace-nowrap" style={{
                        color: 'rgba(59, 130, 246, 0.6)',
                        [isLeftPage ? 'right' : 'left']: 4,
                      }}>
                        Gutter {MARGIN_INNER}"
                      </span>
                    </div>
                    {/* Outer margin */}
                    <div className="absolute top-0 bottom-0 pointer-events-none" style={{
                      [isLeftPage ? 'right' : 'left']: 0,
                      width: marginOuterPx,
                    }}>
                      <div className="w-full h-full" style={{ background: 'rgba(59, 130, 246, 0.06)' }} />
                      <div className="absolute top-0 bottom-0" style={{
                        [isLeftPage ? 'left' : 'right']: 0,
                        borderRight: !isLeftPage ? '1px dashed rgba(59, 130, 246, 0.35)' : 'none',
                        borderLeft: isLeftPage ? '1px dashed rgba(59, 130, 246, 0.35)' : 'none',
                      }} />
                      <span className="absolute bottom-8 text-[8px] font-mono" style={{
                        color: 'rgba(59, 130, 246, 0.6)',
                        [isLeftPage ? 'left' : 'right']: 4,
                      }}>
                        {MARGIN_OUTER}"
                      </span>
                    </div>

                    {/* Safe zone (inner dotted rectangle) */}
                    <div className="absolute pointer-events-none" style={{
                      top: (marginOuterPx + safeZonePx),
                      bottom: (marginOuterPx + safeZonePx),
                      left: (isLeftPage ? marginInnerPx : marginOuterPx) + safeZonePx,
                      right: (isLeftPage ? marginOuterPx : marginInnerPx) + safeZonePx,
                      border: '1px dotted rgba(34, 197, 94, 0.3)',
                    }}>
                      <span className="absolute -top-3 left-0 text-[7px] font-mono" style={{ color: 'rgba(34, 197, 94, 0.5)' }}>
                        Safe zone
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Dimension labels outside page */}
            {showGuides && (
              <>
                {/* Width label */}
                <div
                  className="absolute flex items-center justify-center pointer-events-none"
                  style={{
                    bottom: -24 * viewScale,
                    left: 0,
                    width: stageW * viewScale,
                  }}
                >
                  <div className="flex items-center gap-1">
                    <div className="h-px flex-1 bg-neutral-600" style={{ minWidth: 20 }} />
                    <span className="text-[10px] font-mono text-neutral-400 whitespace-nowrap px-1">
                      {pageWidthIn}"
                    </span>
                    <div className="h-px flex-1 bg-neutral-600" style={{ minWidth: 20 }} />
                  </div>
                </div>
                {/* Height label */}
                <div
                  className="absolute flex flex-col items-center justify-center pointer-events-none"
                  style={{
                    right: -30 * viewScale,
                    top: 0,
                    height: stageH * viewScale,
                  }}
                >
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-px flex-1 bg-neutral-600" style={{ minHeight: 20 }} />
                    <span className="text-[10px] font-mono text-neutral-400 whitespace-nowrap" style={{
                      writingMode: 'vertical-lr',
                    }}>
                      {pageHeightIn}"
                    </span>
                    <div className="w-px flex-1 bg-neutral-600" style={{ minHeight: 20 }} />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Right arrow */}
          <button
            onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages - 1))}
            disabled={currentPage === totalPages - 1}
            className="hidden sm:flex items-center justify-center w-12 h-12 rounded-full hover:bg-neutral-800 transition disabled:opacity-20 disabled:cursor-default mx-2 shrink-0"
          >
            <ChevronRight className="h-7 w-7 text-neutral-500" />
          </button>
        </div>

        {/* Bottom bar with page dots and info */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-neutral-950/90 backdrop-blur border-t border-neutral-800 shrink-0">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost" size="sm"
              onClick={() => setCurrentPage(p => Math.max(p - 1, 0))}
              disabled={currentPage === 0}
              className="sm:hidden text-neutral-400 h-7"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-[10px] font-mono text-neutral-500">
              {isLeftPage ? "Left (verso)" : "Right (recto)"}
            </span>
          </div>

          <div className="flex gap-1 items-center overflow-x-auto max-w-[60vw] px-2">
            {pages.map((p, i) => (
              <button
                key={i}
                onClick={() => setCurrentPage(i)}
                title={`Page ${i + 1}: ${p.type}`}
                className={`shrink-0 rounded transition-all ${
                  i === currentPage
                    ? "bg-white w-5 h-2"
                    : p.type === "recipe"
                    ? "bg-neutral-600 hover:bg-neutral-500 w-2 h-2"
                    : "bg-neutral-700 hover:bg-neutral-600 w-2 h-2"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-neutral-500">
              Content area: {(pageWidthIn - MARGIN_OUTER - MARGIN_INNER).toFixed(2)}" × {(pageHeightIn - MARGIN_OUTER * 2).toFixed(2)}"
            </span>
            <Button
              variant="ghost" size="sm"
              onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages - 1))}
              disabled={currentPage === totalPages - 1}
              className="sm:hidden text-neutral-400 h-7"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Page Content Components (rendered at virtual stage coordinates) ---

function CoverContent({
  layoutData, theme, recipeCount, stageW, stageH,
}: {
  layoutData: PrintLayoutData;
  theme: typeof THEMES.classic;
  recipeCount: number;
  stageW: number;
  stageH: number;
}) {
  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center text-center relative"
      style={{
        background: theme.coverBg,
        fontFamily: theme.titleFont,
        // Cover bleeds to edges — use negative margins to fill
        margin: `-${MARGIN_OUTER * DPI}px`,
        padding: `${MARGIN_OUTER * DPI + 40}px`,
        width: `calc(100% + ${MARGIN_OUTER * DPI * 2}px)`,
        height: `calc(100% + ${MARGIN_OUTER * DPI * 2}px)`,
      }}
    >
      {/* Top accent bar */}
      <div className="absolute top-0 left-0 right-0 h-2" style={{ background: theme.coverAccent }} />
      <div className="absolute bottom-0 left-0 right-0 h-2" style={{ background: theme.coverAccent }} />

      {/* Decorative border */}
      <div className="absolute pointer-events-none" style={{
        top: 24, left: 24, right: 24, bottom: 24,
        border: theme.borderStyle,
        borderRadius: 4,
      }} />

      <div
        className="rounded-full flex items-center justify-center mb-4"
        style={{ width: 64, height: 64, background: theme.coverAccent }}
      >
        <BookOpen className="text-white" style={{ width: 32, height: 32 }} />
      </div>

      <h1 style={{
        fontSize: Math.min(28, stageW / 14),
        fontWeight: 700,
        color: theme.titleColor,
        lineHeight: 1.2,
        marginBottom: 8,
        maxWidth: '90%',
      }}>
        {layoutData.title || "My Cookbook"}
      </h1>

      {layoutData.subtitle && (
        <p style={{
          fontSize: Math.min(14, stageW / 28),
          color: theme.subtitleColor,
          fontStyle: 'italic',
          marginBottom: 16,
          maxWidth: '80%',
        }}>
          {layoutData.subtitle}
        </p>
      )}

      <div style={{ marginTop: 'auto' }}>
        {layoutData.authorName && (
          <p style={{
            fontSize: 11,
            color: theme.mutedColor,
            fontWeight: 500,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.1em',
          }}>
            by {layoutData.authorName}
          </p>
        )}
        <p style={{ fontSize: 10, color: theme.lightColor, marginTop: 4 }}>
          {recipeCount} recipe{recipeCount !== 1 ? "s" : ""}
        </p>
      </div>
    </div>
  );
}

function DedicationContent({ layoutData, theme }: { layoutData: PrintLayoutData; theme: typeof THEMES.classic }) {
  return (
    <div className="w-full h-full flex items-center justify-center" style={{ fontFamily: theme.titleFont }}>
      <p style={{
        fontSize: 14,
        fontStyle: 'italic',
        color: theme.subtitleColor,
        maxWidth: '80%',
        textAlign: 'center',
        lineHeight: 1.8,
      }}>
        {layoutData.dedication}
      </p>
    </div>
  );
}

function TocContent({
  sections, recipesById, theme, onGoToRecipe,
}: {
  sections: PrintLayoutData["sections"];
  recipesById: Map<string, Recipe>;
  theme: typeof THEMES.classic;
  onGoToRecipe: (index: number) => void;
}) {
  let globalIdx = 0;
  return (
    <div className="w-full h-full flex flex-col overflow-y-auto" style={{ fontFamily: theme.bodyFont }}>
      <h2 style={{
        fontFamily: theme.titleFont,
        fontSize: 20,
        fontWeight: 700,
        color: theme.titleColor,
        textAlign: 'center',
        marginBottom: 4,
      }}>
        Table of Contents
      </h2>
      <div style={{
        width: 48, height: 2,
        background: theme.dividerColor,
        margin: '0 auto 16px',
      }} />

      {sections.map((section, sIdx) => (
        <div key={section.id || sIdx}>
          {sections.length > 1 && (
            <div style={{
              fontSize: 9,
              fontWeight: 700,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.08em',
              color: theme.accentColor,
              marginTop: sIdx > 0 ? 12 : 0,
              marginBottom: 4,
              paddingBottom: 3,
              borderBottom: `1px solid ${theme.dividerColor}40`,
            }}>
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
                className="w-full flex items-baseline gap-2 py-1 px-1 rounded transition text-left"
                style={{ fontFamily: theme.bodyFont }}
              >
                <span style={{ fontSize: 9, color: theme.lightColor, fontFamily: 'monospace', width: 16, flexShrink: 0 }}>
                  {idx + 1}
                </span>
                <span style={{ fontSize: 10, color: theme.bodyColor, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {recipe.title}
                </span>
                <span style={{ fontSize: 9, color: theme.lightColor, flexShrink: 0 }}>
                  {formatTime(recipe.totalTimeMinutes || recipe.cookTimeMinutes)}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function SectionContent({ title, theme }: { title: string; theme: typeof THEMES.classic }) {
  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center text-center"
      style={{ background: theme.sectionBg, fontFamily: theme.titleFont,
        margin: `-${MARGIN_OUTER * DPI}px`,
        padding: `${MARGIN_OUTER * DPI}px`,
        width: `calc(100% + ${MARGIN_OUTER * DPI * 2}px)`,
        height: `calc(100% + ${MARGIN_OUTER * DPI * 2}px)`,
      }}
    >
      <span style={{ fontSize: 24, color: theme.lightColor, marginBottom: 12 }}>
        {theme.sectionDecor}
      </span>
      <h2 style={{
        fontSize: 22,
        fontWeight: 700,
        color: theme.titleColor,
        marginBottom: 8,
      }}>
        {title}
      </h2>
      <div style={{
        width: 40, height: 2,
        background: theme.dividerColor,
        margin: '0 auto',
      }} />
    </div>
  );
}

function RecipeContent({
  recipe, index, theme, pageWidthIn,
}: {
  recipe: Recipe;
  index: number;
  theme: typeof THEMES.classic;
  pageWidthIn: number;
}) {
  const ingredients = recipe.normalizedIngredients ||
    (recipe.ingredients || []).map((raw: any) =>
      typeof raw === "string" ? { raw, item: raw } : raw
    );
  const instructions = recipe.normalizedInstructions ||
    (recipe.instructions || []).map((text: any, i: number) =>
      typeof text === "string" ? { stepNumber: i + 1, text } : text
    );

  // Responsive sizing based on page width
  const isSmallPage = pageWidthIn < 6;
  const isLargePage = pageWidthIn >= 8;
  const titleSize = isSmallPage ? 14 : isLargePage ? 20 : 16;
  const bodySize = isSmallPage ? 8 : isLargePage ? 10 : 9;
  const headingSize = isSmallPage ? 9 : isLargePage ? 12 : 10;
  const imageHeight = isSmallPage ? 100 : isLargePage ? 180 : 140;
  const useColumns = pageWidthIn >= 5.5;

  return (
    <div className="w-full h-full flex flex-col overflow-hidden" style={{ fontFamily: theme.bodyFont }}>
      {/* Recipe image */}
      {(recipe.dishImageThumbnail || recipe.dishImage) && (
        <div className="relative shrink-0" style={{
          height: imageHeight,
          marginTop: -MARGIN_OUTER * DPI,
          marginLeft: -(MARGIN_INNER * DPI),
          marginRight: -(MARGIN_OUTER * DPI),
          width: `calc(100% + ${(MARGIN_INNER + MARGIN_OUTER) * DPI}px)`,
        }}>
          <img
            src={recipe.dishImageThumbnail || recipe.dishImage || ""}
            alt={recipe.title}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)',
          }} />
          <div style={{
            position: 'absolute',
            bottom: 0, left: 0, right: 0,
            padding: '8px 12px',
          }}>
            <h2 style={{
              fontFamily: theme.titleFont,
              fontSize: titleSize,
              fontWeight: 700,
              color: 'white',
              lineHeight: 1.2,
            }}>
              {recipe.title}
            </h2>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto" style={{ paddingTop: 8 }}>
        {/* Title if no image */}
        {!recipe.dishImageThumbnail && !recipe.dishImage && (
          <div style={{ marginBottom: 8 }}>
            <h2 style={{
              fontFamily: theme.titleFont,
              fontSize: titleSize,
              fontWeight: 700,
              color: theme.titleColor,
              lineHeight: 1.2,
            }}>
              {recipe.title}
            </h2>
            <div style={{
              width: 32, height: 2,
              background: theme.dividerColor,
              marginTop: 4,
            }} />
          </div>
        )}

        {/* Time badges */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {recipe.prepTimeMinutes && (
            <span style={{
              fontSize: bodySize - 1,
              background: theme.badgeBg,
              color: theme.badgeColor,
              padding: '1px 6px',
              borderRadius: 10,
            }}>
              Prep: {formatTime(recipe.prepTimeMinutes)}
            </span>
          )}
          {recipe.cookTimeMinutes && (
            <span style={{
              fontSize: bodySize - 1,
              background: theme.badgeBg,
              color: theme.badgeColor,
              padding: '1px 6px',
              borderRadius: 10,
            }}>
              Cook: {formatTime(recipe.cookTimeMinutes)}
            </span>
          )}
          {recipe.servings && (
            <span style={{
              fontSize: bodySize - 1,
              background: theme.tipBg,
              color: theme.mutedColor,
              padding: '1px 6px',
              borderRadius: 10,
            }}>
              Serves {recipe.servings}
            </span>
          )}
        </div>

        {recipe.description && (
          <p style={{
            fontSize: bodySize,
            fontStyle: 'italic',
            color: theme.subtitleColor,
            lineHeight: 1.5,
            marginBottom: 8,
          }}>
            {recipe.description}
          </p>
        )}

        {/* Ingredients & Instructions */}
        <div style={{
          display: useColumns ? 'grid' : 'flex',
          gridTemplateColumns: useColumns ? '1fr 1.5fr' : undefined,
          flexDirection: useColumns ? undefined : 'column',
          gap: useColumns ? 12 : 8,
        }}>
          {/* Ingredients */}
          <div>
            <h3 style={{
              fontSize: headingSize,
              fontWeight: 700,
              color: theme.headingColor || theme.titleColor,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.06em',
              marginBottom: 4,
              fontFamily: theme.titleFont,
            }}>
              Ingredients
            </h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {ingredients.map((ing: any, idx: number) => {
                const quantityStr = formatQuantity(ing.quantity, ing.unit);
                return (
                  <li key={idx} style={{
                    fontSize: bodySize,
                    color: theme.bodyColor,
                    padding: '1px 0',
                    lineHeight: 1.3,
                    display: 'flex',
                    gap: 3,
                  }}>
                    {quantityStr && (
                      <span style={{ fontWeight: 600, color: theme.titleColor, flexShrink: 0 }}>{quantityStr}</span>
                    )}
                    <span>
                      {ing.item || ing.name || ing.raw || ""}
                      {ing.preparation && <span style={{ color: theme.mutedColor }}>, {ing.preparation}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Instructions */}
          <div>
            <h3 style={{
              fontSize: headingSize,
              fontWeight: 700,
              color: theme.headingColor || theme.titleColor,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.06em',
              marginBottom: 4,
              fontFamily: theme.titleFont,
            }}>
              Instructions
            </h3>
            <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {instructions.map((step: any, idx: number) => (
                <li key={idx} style={{
                  fontSize: bodySize,
                  color: theme.bodyColor,
                  padding: '2px 0',
                  lineHeight: 1.4,
                  display: 'flex',
                  gap: 4,
                }}>
                  <span style={{ fontWeight: 700, color: theme.accentColor, flexShrink: 0 }}>{idx + 1}.</span>
                  <span>{typeof step === "string" ? step : step.text || step.instruction}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Tips */}
        {recipe.tips && (recipe.tips as any[]).length > 0 && (
          <div style={{
            marginTop: 8,
            padding: '6px 8px',
            background: theme.tipBg,
            borderRadius: 4,
            border: `1px solid ${theme.tipBorder}`,
          }}>
            <h4 style={{
              fontSize: bodySize - 1,
              fontWeight: 700,
              color: theme.tipColor,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.06em',
              marginBottom: 2,
            }}>
              Tips
            </h4>
            {(recipe.tips as any[]).map((tip: any, idx: number) => (
              <p key={idx} style={{ fontSize: bodySize - 1, color: theme.tipColor, lineHeight: 1.4 }}>
                {typeof tip === "string" ? tip : tip.text}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Page number */}
      <div style={{
        textAlign: 'center',
        fontSize: 8,
        color: theme.lightColor,
        paddingTop: 4,
        flexShrink: 0,
      }}>
        {index + 1}
      </div>
    </div>
  );
}

function BackContent({ layoutData, theme }: { layoutData: PrintLayoutData; theme: typeof THEMES.classic }) {
  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center text-center"
      style={{
        background: theme.coverBg,
        fontFamily: theme.titleFont,
        margin: `-${MARGIN_OUTER * DPI}px`,
        padding: `${MARGIN_OUTER * DPI}px`,
        width: `calc(100% + ${MARGIN_OUTER * DPI * 2}px)`,
        height: `calc(100% + ${MARGIN_OUTER * DPI * 2}px)`,
      }}
    >
      <div className="absolute top-0 left-0 right-0 h-2" style={{ background: theme.coverAccent }} />
      <div className="absolute bottom-0 left-0 right-0 h-2" style={{ background: theme.coverAccent }} />

      <BookOpen style={{ width: 48, height: 48, color: theme.lightColor, marginBottom: 16 }} />
      <h2 style={{
        fontSize: 18,
        fontWeight: 700,
        color: theme.titleColor,
        marginBottom: 8,
      }}>
        {layoutData.title || "My Cookbook"}
      </h2>
      {layoutData.subtitle && (
        <p style={{
          fontSize: 12,
          fontStyle: 'italic',
          color: theme.mutedColor,
          maxWidth: '70%',
          marginBottom: 24,
        }}>
          {layoutData.subtitle}
        </p>
      )}
      <p style={{ fontSize: 9, color: theme.lightColor, marginTop: 'auto' }}>
        Made with Grammie
      </p>
    </div>
  );
}
