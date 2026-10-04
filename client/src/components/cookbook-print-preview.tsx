import { useState, useMemo, useEffect, useRef, useLayoutEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { paginateToc, tocFontSizes, tocMetrics } from "@shared/toc-layout";
import { Button } from "@/components/ui/button";
import {
  X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  Ruler, BookOpen, Info,
} from "lucide-react";
import type { PrintLayoutData, CustomTemplateData } from "@shared/schema";
import { buildThemeConfigFromTemplate, isColorDark, type ThemeConfig } from "@shared/template-theme";
import { formatIngredientQuantity } from "@shared/print-format";
import { convertAmount, type UnitSystem } from "@shared/units";
import { BOOK_SIZES, type TrimSizeId } from "@/lib/print-constants";
import { buildRecipeCardHtml, CARD_THEME } from "@shared/recipe-card";
import { transformRecipe } from "@shared/print-recipe-transform";
import {
  buildAlbumPageHtml, chunkAlbum, familyPhotoSlotHtml, fitFamilyPhotoSlots,
  FAMILY_ALBUM_TITLE, type AlbumPhoto,
} from "@shared/family-photos";

// --- Constants ---
const DPI = 96;
const BLEED = 0.125;
const MARGIN_OUTER = 0.5;
const MARGIN_INNER = 0.75;
const MARGIN_TOP = 0.5;
const MARGIN_BOTTOM = 0.5;
const TOC_TOP_GAP = 24;

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
  variations?: any[] | null;
  cuisine?: string | null;
  calories?: number | null;
  protein?: number | null;
  carbohydrates?: number | null;
  fat?: number | null;
  fiber?: number | null;
}

interface CookbookPrintPreviewProps {
  open: boolean;
  onClose: () => void;
  layoutData: PrintLayoutData;
  templateStyle: 'classic' | 'modern' | 'rustic' | 'elegant' | 'card';
  cookbookId: number;
  trimSize?: string;
  customTemplateData?: CustomTemplateData | null;
  customFonts?: { name: string; format: string; dataUrl: string }[] | null;
}

// --- Theme configurations ---
const THEMES = {
  classic: {
    name: 'Classic',
    bg: '#fefbf3',
    bgCover: 'linear-gradient(135deg, #fef3c7, #fed7aa, #fef3c7)',
    bgBack: 'linear-gradient(135deg, #f5f5f4, #e7e5e4, #f5f5f4)',
    titleFont: 'Georgia, "Times New Roman", serif',
    bodyFont: '-apple-system, system-ui, sans-serif',
    accent: '#ea580c',
    accentLight: '#fff7ed',
    accentBorder: '#fed7aa',
    divider: '#f97316',
    stepNum: '#f97316',
    badgeBg: '#fff7ed',
    badgeText: '#c2410c',
    tipsBg: '#fffbeb',
    tipsBorder: '#fef3c7',
    tipsTitle: '#92400e',
    tipsText: '#a16207',
    coverDark: false,
    pageNum: '#a8a29e',
  },
  modern: {
    name: 'Modern',
    bg: '#ffffff',
    bgCover: 'linear-gradient(135deg, #0f172a, #1e293b, #0f172a)',
    bgBack: 'linear-gradient(135deg, #0f172a, #1e293b, #0f172a)',
    titleFont: '-apple-system, system-ui, "Segoe UI", sans-serif',
    bodyFont: '-apple-system, system-ui, sans-serif',
    accent: '#3b82f6',
    accentLight: '#eff6ff',
    accentBorder: '#bfdbfe',
    divider: '#3b82f6',
    stepNum: '#3b82f6',
    badgeBg: '#eff6ff',
    badgeText: '#1d4ed8',
    tipsBg: '#f8fafc',
    tipsBorder: '#e2e8f0',
    tipsTitle: '#1e293b',
    tipsText: '#475569',
    coverDark: true,
    pageNum: '#94a3b8',
  },
  rustic: {
    name: 'Rustic',
    bg: '#fefce8',
    bgCover: 'linear-gradient(135deg, #fef9c3, #fde68a, #fef9c3)',
    bgBack: 'linear-gradient(135deg, #fde68a, #fef9c3, #fde68a)',
    titleFont: 'Georgia, "Times New Roman", serif',
    bodyFont: '-apple-system, system-ui, sans-serif',
    accent: '#b45309',
    accentLight: '#fef3c7',
    accentBorder: '#fde68a',
    divider: '#d97706',
    stepNum: '#d97706',
    badgeBg: '#fef3c7',
    badgeText: '#92400e',
    tipsBg: '#fefce8',
    tipsBorder: '#fef9c3',
    tipsTitle: '#713f12',
    tipsText: '#854d0e',
    coverDark: false,
    pageNum: '#d97706',
  },
  elegant: {
    name: 'Elegant',
    bg: '#fafaf9',
    bgCover: 'linear-gradient(135deg, #292524, #44403c, #292524)',
    bgBack: 'linear-gradient(135deg, #292524, #44403c, #292524)',
    titleFont: 'Georgia, "Playfair Display", serif',
    bodyFont: 'Georgia, serif',
    accent: '#e11d48',
    accentLight: '#fff1f2',
    accentBorder: '#fecdd3',
    divider: '#fb7185',
    stepNum: '#f43f5e',
    badgeBg: '#fff1f2',
    badgeText: '#be123c',
    tipsBg: '#fff1f2',
    tipsBorder: '#fecdd3',
    tipsTitle: '#9f1239',
    tipsText: '#be123c',
    coverDark: true,
    pageNum: '#a8a29e',
  },
  card: { name: 'Recipe Card', ...CARD_THEME },
};


// --- Helpers ---
function formatTime(minutes: number | null | undefined): string {
  if (!minutes) return "";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}


// --- Page types ---
type TocEntry =
  | { isSection: true; title: string }
  | { isSection: false; title: string; index: number };

/** TOC index used for the Family Album entry */
const ALBUM_TOC_INDEX = -1;
const photoUrl = (id: string) => `/api/cookbook-photos/${id}`;

type PageContent =
  | { type: "cover" }
  | { type: "dedication" }
  | { type: "colophon" }
  | { type: "toc"; entries: TocEntry[]; first: boolean }
  | { type: "section-divider"; title: string; album?: boolean }
  | { type: "album"; photos: AlbumPhoto[] }
  | { type: "recipe"; recipe: Recipe; index: number }
  | { type: "recipe-extras"; recipe: Recipe; index: number }
  | { type: "back" };

// --- Main component ---
export function CookbookPrintPreview({
  open,
  onClose,
  layoutData,
  templateStyle,
  cookbookId,
  trimSize: trimSizeProp,
  customTemplateData,
  customFonts,
}: CookbookPrintPreviewProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const [zoom, setZoom] = useState(0.85);
  const [showGuides, setShowGuides] = useState(false);

  // Use custom template theme if provided, otherwise fall back to built-in
  const theme: ThemeConfig = useMemo(() => {
    if (customTemplateData) {
      return buildThemeConfigFromTemplate(customTemplateData);
    }
    return THEMES[templateStyle] || THEMES.classic;
  }, [customTemplateData, templateStyle]);

  // Dynamically load Google Fonts for custom template
  useEffect(() => {
    if (!open) return;
    const families: string[] = [];
    if (customTemplateData) {
      const fonts = customTemplateData.fonts;
      if (fonts.heading.source === 'google') families.push(fonts.heading.family);
      if (fonts.body.source === 'google' && fonts.body.family !== fonts.heading.family) families.push(fonts.body.family);
    } else if (templateStyle === 'card') {
      families.push('Playfair Display', 'Inter');
    }
    if (families.length === 0) return;

    const linkId = 'custom-template-preview-fonts';
    let link = document.getElementById(linkId) as HTMLLinkElement | null;
    const url = `https://fonts.googleapis.com/css2?${families.map(f => `family=${encodeURIComponent(f)}:wght@300;400;500;600;700;800;900`).join('&')}&display=swap`;

    if (link) {
      link.href = url;
    } else {
      link = document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      link.href = url;
      document.head.appendChild(link);
    }
  }, [customTemplateData, templateStyle, open]);

  // Inject @font-face rules for uploaded custom fonts (mirrors the PDF generator)
  useEffect(() => {
    const styleId = 'custom-template-preview-font-faces';
    const existing = document.getElementById(styleId);
    if (!open || !customFonts?.length) {
      existing?.remove();
      return;
    }
    const style = existing instanceof HTMLStyleElement
      ? existing
      : document.createElement('style');
    style.id = styleId;
    style.textContent = customFonts.map(f =>
      `@font-face { font-family: '${f.name}'; src: url('${f.dataUrl}') format('${f.format}'); font-weight: normal; font-style: normal; }`
    ).join('\n');
    if (!style.isConnected) document.head.appendChild(style);
  }, [customFonts, open]);

  const sizeId = (trimSizeProp || '0600X0900') as TrimSizeId;
  const bookSize = BOOK_SIZES[sizeId] || BOOK_SIZES['0600X0900'];

  // Page dimensions in pixels at 96 DPI
  const pageW = bookSize.width * DPI;
  const pageH = bookSize.height * DPI;

  const showNutrition = layoutData?.customizations?.showNutrition === true;
  const showTips = layoutData?.customizations?.showTips === true;
  const showVariations = layoutData?.customizations?.showVariations === true;

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
    if (ordered.length === 0) return recipes;
    return ordered;
  }, [recipes, layoutData?.sections]);

  // Check if recipe has extras content
  const hasExtras = useCallback((recipe: Recipe) => {
    if (theme.recipeLayout) {
      // Card pages already include nutrition and tips; only variations spill over
      return !!(showVariations && Array.isArray(recipe.variations) && recipe.variations.length > 0);
    }
    if (showNutrition && (recipe.calories || recipe.protein || recipe.carbohydrates || recipe.fat)) return true;
    if (showTips && recipe.tips && Array.isArray(recipe.tips) && recipe.tips.length > 0) return true;
    if (showVariations && recipe.variations && Array.isArray(recipe.variations) && recipe.variations.length > 0) return true;
    return false;
  }, [showNutrition, showTips, showVariations, theme.recipeLayout]);

  // Family photos: one under each recipe that has room, the rest in the album
  const { photoByRecipe, albumPhotos } = useMemo(() => {
    const inBook = new Set((layoutData?.sections ?? []).flatMap((s) => s.recipeIds));
    const byRecipe = new Map<string, string>();
    const album: AlbumPhoto[] = [];
    for (const p of layoutData?.familyPhotos ?? []) {
      if (p.placement?.type === 'album') album.push({ src: photoUrl(p.id), aspect: p.width / p.height });
      else if (p.placement?.type === 'recipe' && p.placement.recipeId && inBook.has(p.placement.recipeId) && !byRecipe.has(p.placement.recipeId)) {
        byRecipe.set(p.placement.recipeId, photoUrl(p.id));
      }
    }
    return { photoByRecipe: byRecipe, albumPhotos: album };
  }, [layoutData?.familyPhotos, layoutData?.sections]);

  // Build pages
  const pages: PageContent[] = useMemo(() => {
    const p: PageContent[] = [];
    p.push({ type: "cover" });
    p.push(layoutData?.dedication ? { type: "dedication" } : { type: "colophon" });
    if (orderedRecipes.length > 0) {
      // Contents entries in reading order, split across as many pages as the
      // printed book uses (shared with the PDF generator)
      const entries: TocEntry[] = [];
      if (layoutData?.sections?.length) {
        let i = 0;
        for (const section of layoutData.sections) {
          const inSection = section.recipeIds.filter(rid => orderedRecipes.some(r => String(r.id) === String(rid)));
          if (inSection.length === 0) continue;
          if (section.title) entries.push({ isSection: true, title: section.title });
          for (const rid of inSection) {
            const recipe = orderedRecipes.find(r => String(r.id) === String(rid))!;
            entries.push({ isSection: false, title: recipe.title, index: i++ });
          }
        }
      } else {
        orderedRecipes.forEach((r, index) => entries.push({ isSection: false, title: r.title, index }));
      }
      if (albumPhotos.length) entries.push({ isSection: false, title: FAMILY_ALBUM_TITLE, index: ALBUM_TOC_INDEX });
      const contentPx = pageH - (MARGIN_TOP + MARGIN_BOTTOM) * DPI - TOC_TOP_GAP;
      const chunks = paginateToc(entries, tocMetrics(contentPx, pageW));
      chunks.forEach((chunk, i) => p.push({ type: "toc", entries: chunk, first: i === 0 }));
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
              if (hasExtras(recipe)) {
                p.push({ type: "recipe-extras", recipe, index: recipeIndex });
              }
              recipeIndex++;
            }
          }
        }
      } else {
        orderedRecipes.forEach((recipe, index) => {
          p.push({ type: "recipe", recipe, index });
          if (hasExtras(recipe)) {
            p.push({ type: "recipe-extras", recipe, index });
          }
        });
      }
    }
    if (orderedRecipes.length > 0 && albumPhotos.length) {
      p.push({ type: "section-divider", title: FAMILY_ALBUM_TITLE, album: true });
      chunkAlbum(albumPhotos).forEach((photos) => p.push({ type: "album", photos }));
    }
    p.push({ type: "back" });
    return p;
  }, [orderedRecipes, layoutData, hasExtras, pageW, pageH, albumPhotos]);

  const totalPages = pages.length;

  // Preview page number for each recipe, so the TOC matches the printed book
  const recipePageNumbers = useMemo(() => {
    const map = new Map<number, number>();
    pages.forEach((p, i) => {
      if (p.type === 'recipe') map.set(p.index, i + 1);
      if (p.type === 'section-divider' && p.album) map.set(ALBUM_TOC_INDEX, i + 1);
    });
    return map;
  }, [pages]);

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

  // Reset page on open and fit the page to the window (toolbar, thumbnail
  // strip and arrows take ~150px vertically and ~140px horizontally)
  useEffect(() => {
    if (!open) return;
    setCurrentPage(0);
    const fit = Math.min(
      (window.innerHeight * 0.95 - 150) / pageH,
      (window.innerWidth * 0.95 - 140) / pageW,
    );
    setZoom(Math.max(0.3, Math.min(1, Math.floor(fit * 20) / 20)));
  }, [open, pageW, pageH]);

  // Clamp currentPage when pages change
  useEffect(() => {
    if (currentPage >= totalPages && totalPages > 0) {
      setCurrentPage(totalPages - 1);
    }
  }, [totalPages, currentPage]);

  const page = pages[currentPage];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-w-[95vw] max-h-[95vh] p-0 border-0 bg-stone-900 overflow-hidden grid-cols-[minmax(0,1fr)] [&>button]:hidden"
        style={{ width: '95vw', height: '95vh' }}
        aria-describedby={undefined}
      >
        {/* min-w-0 keeps the thumbnail strip from widening the dialog's grid
            column (it scrolls instead), which pushed the page off-screen */}
        <div className="flex flex-col h-full min-w-0 min-h-0">
          {/* Top toolbar */}
          <div className="flex items-center justify-between px-4 py-2 bg-stone-800 text-white border-b border-stone-700 shrink-0">
            <div className="flex items-center gap-3">
              <DialogTitle className="text-sm font-medium">
                {layoutData?.title || 'Cookbook'} — Preview
              </DialogTitle>
              <span className="text-xs text-stone-400">
                Page {currentPage + 1} / {totalPages} &bull; {bookSize.description}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost" size="sm"
                className="text-stone-300 hover:text-white hover:bg-stone-700 h-7 px-2"
                onClick={() => setZoom(z => Math.max(0.3, z - 0.1))}
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
              <Button
                variant="ghost" size="sm"
                className={`h-7 px-2 ${showGuides ? 'text-blue-400 bg-stone-700' : 'text-stone-300 hover:text-white hover:bg-stone-700'}`}
                onClick={() => setShowGuides(!showGuides)}
                title="Toggle measurement guides"
              >
                <Ruler className="h-3.5 w-3.5" />
              </Button>
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
          <div className="flex-1 flex items-center justify-center min-h-0 overflow-auto p-4">
            {/* Left arrow */}
            <button
              onClick={() => setCurrentPage(p => Math.max(p - 1, 0))}
              disabled={currentPage === 0}
              className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-white/10 transition disabled:opacity-20 mr-3 shrink-0"
            >
              <ChevronLeft className="h-6 w-6 text-white" />
            </button>

            {/* Page wrapper — scales the fixed-size page to fit the viewport */}
            <div
              className="relative shrink-0"
              style={{
                width: pageW * zoom,
                height: pageH * zoom,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: pageW,
                  height: pageH,
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top left',
                  borderRadius: 4,
                  overflow: 'hidden',
                  boxShadow: '0 25px 60px -12px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.15)',
                  background: '#fff',
                  fontFamily: theme.bodyFont,
                  color: theme.textColor || '#44403c',
                }}
              >
                {page?.type === "cover" && (
                  <CoverPage layoutData={layoutData} theme={theme} recipes={orderedRecipes} w={pageW} h={pageH} customTemplateData={customTemplateData} />
                )}
                {page?.type === "colophon" && (
                  <ColophonPage layoutData={layoutData} theme={theme} recipeCount={orderedRecipes.length} w={pageW} h={pageH} />
                )}
                {page?.type === "dedication" && (
                  <DedicationPage dedication={layoutData.dedication || ''} theme={theme} w={pageW} h={pageH} />
                )}
                {page?.type === "toc" && (
                  <TocPage
                    entries={page.entries}
                    first={page.first}
                    pageNumbers={recipePageNumbers}
                    theme={theme}
                    onGoToRecipe={(i) => {
                      const idx = i === ALBUM_TOC_INDEX
                        ? pages.findIndex(p => p.type === 'section-divider' && p.album)
                        : pages.findIndex(p => p.type === 'recipe' && (p as any).index === i);
                      if (idx >= 0) setCurrentPage(idx);
                    }}
                    w={pageW} h={pageH}
                  />
                )}
                {page?.type === "section-divider" && (
                  <SectionDividerPage title={page.title} theme={theme} w={pageW} h={pageH} />
                )}
                {page?.type === "recipe" && theme.recipeLayout && (
                  <CardRecipePage
                    recipe={page.recipe}
                    theme={theme}
                    unitSystem={(layoutData?.customizations?.unitSystem as UnitSystem) || "original"}
                    w={pageW} h={pageH}
                    pageNumber={recipePageNumbers.get(page.index)}
                    familyPhotoSrc={photoByRecipe.get(String(page.recipe.id))}
                    includePhoto={
                      layoutData?.recipePrintSettings?.[String(page.recipe.id)]?.includePhoto !== false
                    }
                  />
                )}
                {page?.type === "album" && (
                  <AlbumPage photos={page.photos} theme={theme} w={pageW} h={pageH} pageNumber={currentPage + 1} />
                )}
                {page?.type === "recipe" && !theme.recipeLayout && (
                  <RecipePage
                    familyPhotoSrc={photoByRecipe.get(String(page.recipe.id))}
                    recipe={page.recipe}
                    index={page.index}
                    theme={theme}
                    unitSystem={(layoutData?.customizations?.unitSystem as UnitSystem) || "original"}
                    w={pageW} h={pageH}
                    includePhoto={
                      layoutData?.recipePrintSettings?.[String(page.recipe.id)]?.includePhoto !== false
                    }
                  />
                )}
                {page?.type === "recipe-extras" && (
                  <RecipeExtrasPage
                    recipe={page.recipe}
                    index={page.index}
                    theme={theme}
                    w={pageW} h={pageH}
                    showNutrition={showNutrition}
                    showTips={showTips}
                    showVariations={showVariations}
                  />
                )}
                {page?.type === "back" && (
                  <BackPage layoutData={layoutData} theme={theme} w={pageW} h={pageH} />
                )}

                {showGuides && <MeasurementGuides w={pageW} h={pageH} />}
              </div>
            </div>

            {/* Right arrow */}
            <button
              onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages - 1))}
              disabled={currentPage === totalPages - 1}
              className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-white/10 transition disabled:opacity-20 ml-3 shrink-0"
            >
              <ChevronRight className="h-6 w-6 text-white" />
            </button>
          </div>

          {/* Page thumbnails */}
          <div className="flex items-center gap-1.5 px-4 py-2 bg-stone-800 border-t border-stone-700 overflow-x-auto shrink-0">
            {pages.map((p, i) => {
              const aspect = bookSize.height / bookSize.width;
              const thumbW = 36;
              const thumbH = thumbW * aspect;
              const label = p.type === 'cover' ? 'C' :
                p.type === 'back' ? 'B' :
                p.type === 'toc' ? 'TOC' :
                p.type === 'section-divider' ? 'S' :
                p.type === 'album' ? 'A' :
                p.type === 'dedication' ? 'D' :
                p.type === 'recipe-extras' ? `${(p as any).index + 1}+` :
                p.type === 'recipe' ? `${(p as any).index + 1}` : '';
              return (
                <button
                  key={i}
                  onClick={() => setCurrentPage(i)}
                  className={`shrink-0 rounded transition-all ${
                    i === currentPage
                      ? 'ring-2 ring-blue-500 shadow-lg shadow-blue-500/30'
                      : 'opacity-50 hover:opacity-90'
                  }`}
                  style={{ width: thumbW, height: thumbH }}
                  title={`Page ${i + 1} (${p.type})`}
                >
                  <div
                    className="w-full h-full bg-white rounded-sm flex items-center justify-center"
                    style={{ fontSize: 8, color: '#666' }}
                  >
                    {label}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Auto-fit wrapper — renders children inside a container that CSS-scales to fit
// ============================================================================

function AutoFitPage({
  w, h, bg, children, padding, afterFit,
}: {
  w: number; h: number; bg: string; children: React.ReactNode;
  padding?: { top: number; right: number; bottom: number; left: number };
  /** Runs once the scale is settled (family photo slots size themselves here) */
  afterFit?: (root: HTMLElement) => void;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const pad = padding || {
    top: MARGIN_TOP * DPI,
    right: MARGIN_OUTER * DPI,
    bottom: MARGIN_BOTTOM * DPI,
    left: MARGIN_INNER * DPI,
  };

  // Measure after render and compute scale
  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    // Reset to measure natural height (photo slots only fill leftover space)
    setScale(1);
    inner.querySelectorAll<HTMLElement>('.family-photo-slot').forEach((slot) => { slot.style.display = 'none'; });

    let raf2 = 0;
    const raf = requestAnimationFrame(() => {
      const availH = h - pad.top - pad.bottom;
      const contentH = inner.scrollHeight;
      if (contentH > availH && contentH > 0) {
        setScale(Math.max(0.45, availH / contentH));
      } else {
        setScale(1);
      }
      if (afterFit) {
        raf2 = requestAnimationFrame(() => afterFit(outer));
      }
    });
    return () => { cancelAnimationFrame(raf); cancelAnimationFrame(raf2); };
  }, [w, h, pad.top, pad.bottom, children, afterFit]);

  const availW = w - pad.left - pad.right;

  return (
    <div
      ref={outerRef}
      style={{
        width: w,
        height: h,
        background: bg,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div
        ref={innerRef}
        className="recipe-content"
        data-avail-h={h - pad.top - pad.bottom}
        style={{
          position: 'absolute',
          top: pad.top,
          left: pad.left,
          width: availW / scale,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ============================================================================
// Page Components
// ============================================================================

function CoverPage({ layoutData, theme, recipes, w, h, customTemplateData }: {
  layoutData: PrintLayoutData; theme: ThemeConfig; recipes: Recipe[];
  w: number; h: number; customTemplateData?: CustomTemplateData | null;
}) {
  const m = MARGIN_OUTER * DPI;
  const isDark = theme.coverDark;
  const titleSize = theme.fontSizes?.title ?? Math.min(36, w * 0.06);
  const subSize = theme.fontSizes?.subtitle ?? Math.min(16, w * 0.025);

  const coverImageUrl = layoutData?.coverData?.frontImageUrl || layoutData?.coverImage || customTemplateData?.cover?.coverImage;

  return (
    <div style={{
      width: w, height: h, background: theme.bgCover,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', padding: m, position: 'relative', overflow: 'hidden',
    }}>
      {/* Full-page cover image overlay (from custom template) */}
      {customTemplateData?.cover?.coverImage && !layoutData?.coverData?.frontImageUrl && (
        <>
          <img
            src={customTemplateData.cover.coverImage}
            alt=""
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'cover', opacity: 0.3,
            }}
          />
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 50%)',
          }} />
        </>
      )}
      {/* Accent bars */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 6, background: theme.divider, zIndex: 1 }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 6, background: theme.divider, zIndex: 1 }} />
      {/* Border frame */}
      <div style={{
        position: 'absolute', top: m * 0.4, left: m * 0.5, right: m * 0.5, bottom: m * 0.4,
        border: `2px solid ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)'}`,
        borderRadius: 8, pointerEvents: 'none', zIndex: 1,
      }} />

      {layoutData?.coverImage || layoutData?.coverData?.frontImageUrl ? (
        <img
          src={layoutData.coverData?.frontImageUrl || layoutData.coverImage || ''}
          alt=""
          style={{
            width: Math.min(120, w * 0.25), height: Math.min(120, w * 0.25),
            borderRadius: '50%', objectFit: 'cover', marginBottom: 16,
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            border: `3px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)'}`,
            position: 'relative', zIndex: 2,
          }}
        />
      ) : (
        <div style={{
          width: Math.min(96, w * 0.2), height: Math.min(96, w * 0.2),
          borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isDark ? 'rgba(255,255,255,0.1)' : theme.accent,
          marginBottom: 16, boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        }}>
          <BookOpen style={{ width: Math.min(48, w * 0.1), height: Math.min(48, w * 0.1), color: '#fff' }} />
        </div>
      )}

      <h1 style={{
        fontFamily: theme.titleFont, fontWeight: 700, fontSize: titleSize,
        color: isDark ? '#fff' : '#292524', lineHeight: 1.2, marginBottom: 8,
      }}>
        {layoutData?.title || 'My Cookbook'}
      </h1>

      {layoutData?.subtitle && (
        <p style={{
          fontStyle: 'italic', fontSize: subSize, maxWidth: w * 0.7,
          color: isDark ? 'rgba(255,255,255,0.7)' : '#57534e', marginBottom: 16,
        }}>
          {layoutData.subtitle}
        </p>
      )}

      <div style={{ marginTop: 'auto' }}>
        <p style={{
          fontSize: Math.min(14, w * 0.022), fontWeight: 500,
          textTransform: 'uppercase', letterSpacing: '0.1em',
          color: isDark ? 'rgba(255,255,255,0.5)' : '#78716c',
        }}>
          by {layoutData?.authorName || 'Chef'}
        </p>
        <p style={{
          fontSize: Math.min(12, w * 0.018), marginTop: 4,
          color: isDark ? 'rgba(255,255,255,0.3)' : '#a8a29e',
        }}>
          {recipes.length} recipe{recipes.length !== 1 ? 's' : ''}
        </p>
      </div>
    </div>
  );
}

function ColophonPage({ layoutData, theme, recipeCount, w, h }: {
  layoutData: PrintLayoutData; theme: ThemeConfig; recipeCount: number; w: number; h: number;
}) {
  const size = Math.min(10, w * 0.016);
  const pad = (MARGIN_OUTER + 0.4) * DPI;
  return (
    <div style={{
      width: w, height: h, background: theme.bg, padding: pad,
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
    }}>
      <div style={{ fontSize: size, lineHeight: 1.7, color: theme.textColor || '#78716c', opacity: 0.75 }}>
        <p style={{ fontFamily: theme.titleFont, fontSize: size + 2, marginBottom: 6 }}>
          {layoutData?.title || 'My Cookbook'}
        </p>
        <p>Copyright © {new Date().getFullYear()} {layoutData?.authorName || ''}. All rights reserved.</p>
        <p>{recipeCount} recipe{recipeCount === 1 ? '' : 's'} collected and printed with Grammie.</p>
      </div>
    </div>
  );
}

function DedicationPage({ dedication, theme, w, h }: {
  dedication: string; theme: ThemeConfig; w: number; h: number;
}) {
  return (
    <div style={{
      width: w, height: h, background: theme.bg,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', padding: MARGIN_OUTER * DPI,
    }}>
      <p style={{
        fontFamily: theme.titleFont, fontStyle: 'italic',
        fontSize: Math.min(18, w * 0.03), color: '#57534e',
        lineHeight: 1.6, maxWidth: '80%',
      }}>
        &ldquo;{dedication}&rdquo;
      </p>
    </div>
  );
}

function TocPage({ entries, first, pageNumbers, theme, onGoToRecipe, w, h }: {
  entries: TocEntry[]; first: boolean; pageNumbers: Map<number, number>; theme: ThemeConfig;
  onGoToRecipe: (i: number) => void; w: number; h: number;
}) {
  const { titleSize, itemSize, numSize } = tocFontSizes(w);
  const titleColor = theme.titleColor || '#292524';

  return (
    <AutoFitPage w={w} h={h} bg={theme.bg}>
      <div style={{ paddingTop: TOC_TOP_GAP }}>
        {first && (
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <h2 style={{
              fontFamily: theme.titleFont, fontWeight: 700, lineHeight: 1.3,
              fontSize: titleSize, color: titleColor, marginBottom: 8,
            }}>
              Contents
            </h2>
            <div style={{ width: 36, height: 1, background: theme.divider, margin: '0 auto' }} />
          </div>
        )}

        {entries.map((entry, i) => entry.isSection ? (
          <div
            key={`s-${i}`}
            style={{
              display: 'flex', width: '100%', alignItems: 'baseline', gap: 8,
              marginTop: i === 0 && !first ? 0 : 18, marginBottom: 4,
            }}
          >
            <span style={{ fontFamily: theme.titleFont, fontSize: itemSize + 2, fontWeight: 700, color: titleColor, flexShrink: 0 }}>
              {entry.title}
            </span>
            <span style={{ flex: 1, borderBottom: `1px solid ${theme.accentBorder}`, transform: 'translateY(-3px)' }} />
          </div>
        ) : (
          <button
            key={`r-${entry.index}`}
            onClick={() => onGoToRecipe(entry.index)}
            style={{
              display: 'flex', width: '100%', alignItems: 'baseline', gap: 8,
              padding: '3px 0', border: 'none', background: 'transparent',
              cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = theme.accentLight}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <span style={{ fontSize: itemSize, color: theme.textColor || '#44403c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {entry.title}
            </span>
            <span style={{ flex: 1, borderBottom: '1px dotted #c7c0b4', transform: 'translateY(-3px)', minWidth: 24 }} />
            <span style={{ fontSize: numSize, color: '#a8a29e', flexShrink: 0 }}>
              {pageNumbers.get(entry.index) ?? ''}
            </span>
          </button>
        ))}
      </div>
    </AutoFitPage>
  );
}

function SectionDividerPage({ title, theme, w, h }: {
  title: string; theme: ThemeConfig; w: number; h: number;
}) {
  return (
    <div style={{
      width: w, height: h, background: theme.bg,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      textAlign: 'center',
    }}>
      <div style={{ width: 60, height: 2, background: theme.divider, marginBottom: 16 }} />
      <h2 style={{
        fontFamily: theme.titleFont, fontWeight: 700,
        fontSize: theme.fontSizes?.sectionTitle ?? Math.min(30, w * 0.05), color: theme.titleColor || '#292524',
      }}>
        {title}
      </h2>
      <div style={{ width: 60, height: 2, background: theme.divider, marginTop: 16 }} />
    </div>
  );
}

// ============================================================================
// Recipe Page — ONE recipe per page, content auto-scales to fit
// ============================================================================

// Family Album page: same HTML builder as the PDF
function AlbumPage({ photos, theme, w, h, pageNumber }: {
  photos: AlbumPhoto[]; theme: ThemeConfig; w: number; h: number; pageNumber: number;
}) {
  const html = useMemo(() => buildAlbumPageHtml(photos, theme, {
    widthIn: w / DPI, heightIn: h / DPI,
    padTopIn: MARGIN_TOP, padBottomIn: MARGIN_BOTTOM,
    padLeftIn: MARGIN_INNER, padRightIn: MARGIN_OUTER,
    pageNumber,
  }), [photos, theme, w, h, pageNumber]);
  return <div style={{ width: w, height: h }} dangerouslySetInnerHTML={{ __html: html }} />;
}

// Card layout: the same HTML the PDF generator prints (shared/recipe-card.ts),
// shrunk to fit with the same zoom search when a recipe runs long
function CardRecipePage({ recipe, theme, w, h, includePhoto, unitSystem, pageNumber, familyPhotoSrc }: {
  recipe: Recipe; theme: ThemeConfig; w: number; h: number;
  includePhoto: boolean; unitSystem: UnitSystem; pageNumber?: number; familyPhotoSrc?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => {
    const n = transformRecipe(recipe as any, unitSystem);
    n.imageUrl = recipe.dishImageThumbnail || recipe.dishImage || n.imageUrl;
    return buildRecipeCardHtml(n, theme.recipeLayout, theme, {
      widthIn: w / DPI, heightIn: h / DPI, bleedIn: 0,
      padTopIn: MARGIN_TOP, padBottomIn: MARGIN_BOTTOM,
      padLeftIn: MARGIN_INNER, padRightIn: MARGIN_OUTER,
      pageNumber,
    }, { includePhoto, beforePageNumber: familyPhotoSrc ? familyPhotoSlotHtml(familyPhotoSrc, theme) : '' });
  }, [recipe, theme, unitSystem, w, h, pageNumber, includePhoto, familyPhotoSrc]);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const fit = () => {
      // Photos fill leftover space, so measure the recipe without them
      root.querySelectorAll<HTMLElement>('.family-photo-slot').forEach((slot) => { slot.style.display = 'none'; });
      root.querySelectorAll<HTMLElement>('.recipe-content').forEach((container) => {
        const availH = parseFloat(container.dataset.availH || '0');
        const availW = parseFloat(container.dataset.availW || '0');
        let inner = container.firstElementChild as HTMLElement | null;
        if (!inner?.dataset.fit) {
          inner = document.createElement('div');
          inner.dataset.fit = '1';
          while (container.firstChild) inner.appendChild(container.firstChild);
          container.appendChild(inner);
        }
        // Heights in page px, independent of the preview's own zoom transform
        const factor = root.getBoundingClientRect().height / h || 1;
        const height = () => inner!.getBoundingClientRect().height / factor;
        inner.style.zoom = '1';
        inner.style.width = `${availW}px`;
        if (height() <= availH) return;
        let lo = 0.45, hi = 1, best = 0.45;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          inner.style.zoom = String(mid);
          inner.style.width = `${availW / mid}px`;
          if (height() <= availH) { best = mid; lo = mid; } else { hi = mid; }
        }
        inner.style.zoom = String(best);
        inner.style.width = `${availW / best}px`;
      });
      fitFamilyPhotoSlots(root, root.getBoundingClientRect().height / h || 1);
    };
    fit();
    // Photos change the height once they load
    const imgs = Array.from(root.querySelectorAll('img'));
    imgs.forEach((img) => img.addEventListener('load', fit));
    document.fonts?.ready.then(fit);
    return () => imgs.forEach((img) => img.removeEventListener('load', fit));
  }, [html, h]);

  return <div ref={ref} style={{ width: w, height: h }} dangerouslySetInnerHTML={{ __html: html }} />;
}

function RecipePage({ recipe, index, theme, w, h, includePhoto, unitSystem = "original", familyPhotoSrc }: {
  recipe: Recipe; index: number; theme: ThemeConfig;
  w: number; h: number; includePhoto: boolean; unitSystem?: UnitSystem; familyPhotoSrc?: string;
}) {
  const padTop = MARGIN_TOP * DPI;
  const padBottom = MARGIN_BOTTOM * DPI;
  const padLeft = MARGIN_INNER * DPI;
  const padRight = MARGIN_OUTER * DPI;

  const hasImage = includePhoto && (recipe.dishImageThumbnail || recipe.dishImage);
  const imageUrl = recipe.dishImageThumbnail || recipe.dishImage || '';

  // Image takes a proportional chunk of the page
  const imageH = hasImage ? Math.min(h * 0.3, 220) : 0;

  const ingredients = recipe.normalizedIngredients ||
    (recipe.ingredients || []).map((raw: any) =>
      typeof raw === 'string' ? { raw, item: raw } : raw
    );
  const instructions = recipe.normalizedInstructions ||
    (recipe.instructions || []).map((text: any, i: number) =>
      typeof text === 'string' ? { stepNumber: i + 1, text } : text
    );

  // Dynamic font sizes based on page width, overridable by custom templates
  const titleSize = theme.fontSizes?.recipeTitle ?? Math.min(20, w * 0.035);
  const bodySize = theme.fontSizes?.body ?? Math.min(11.5, w * 0.019);
  const labelSize = Math.min(10, w * 0.016);
  const pageNumSize = Math.min(9, w * 0.014);

  // The text content area below the image
  const contentPadding = {
    top: hasImage ? padTop * 0.3 : padTop,
    right: padRight,
    bottom: padBottom,
    left: padLeft,
  };
  const contentH = h - imageH;

  return (
    <div style={{ width: w, height: h, background: theme.bg, overflow: 'hidden', position: 'relative' }}>
      {/* Image header — full-bleed, so a custom imageRadius only applies to the interior (bottom) corners */}
      {hasImage && (
        <div style={{
          position: 'relative', width: w, height: imageH, overflow: 'hidden',
          borderRadius: theme.imageRadius ? `0 0 ${theme.imageRadius} ${theme.imageRadius}` : undefined,
        }}>
          <img
            src={imageUrl}
            alt={recipe.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 60%)',
          }} />
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            padding: `12px ${padRight}px 10px ${padLeft}px`,
          }}>
            <h2 style={{
              fontFamily: theme.titleFont, fontWeight: 700, fontSize: titleSize,
              color: '#fff', lineHeight: 1.2, textShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }}>
              {recipe.title}
            </h2>
          </div>
        </div>
      )}

      {/* Auto-fit content area */}
      <AutoFitPage
        w={w}
        h={contentH}
        bg="transparent"
        padding={contentPadding}
        afterFit={familyPhotoSrc ? (root) => fitFamilyPhotoSlots(root, root.getBoundingClientRect().height / contentH || 1) : undefined}
      >
        {/* Title (when no image) */}
        {!hasImage && (
          <div style={{ marginBottom: 6 }}>
            <h2 style={{
              fontFamily: theme.titleFont, fontWeight: 700,
              fontSize: titleSize, color: '#292524', lineHeight: 1.2,
            }}>
              {recipe.title}
            </h2>
            <div style={{ width: 40, height: 2, background: theme.divider, marginTop: 4 }} />
          </div>
        )}

        {/* Time/servings badges */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          {!!recipe.prepTimeMinutes && (
            <span style={{
              fontSize: labelSize, background: theme.badgeBg, color: theme.badgeText,
              padding: '2px 8px', borderRadius: 12,
            }}>
              Prep: {formatTime(recipe.prepTimeMinutes)}
            </span>
          )}
          {!!recipe.cookTimeMinutes && (
            <span style={{
              fontSize: labelSize, background: theme.badgeBg, color: theme.badgeText,
              padding: '2px 8px', borderRadius: 12,
            }}>
              Cook: {formatTime(recipe.cookTimeMinutes)}
            </span>
          )}
          {recipe.servings && (
            <span style={{
              fontSize: labelSize, background: '#f5f5f4', color: '#57534e',
              padding: '2px 8px', borderRadius: 12,
            }}>
              Serves {recipe.servings}
            </span>
          )}
        </div>

        {/* Description */}
        {recipe.description && (
          <p style={{
            fontSize: bodySize * 0.9, color: '#57534e', fontStyle: 'italic',
            lineHeight: 1.35, marginBottom: 6,
          }}>
            {recipe.description}
          </p>
        )}

        {/* Two-column: ingredients + instructions */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 12 }}>
          {/* Ingredients */}
          <div>
            <h3 style={{
              fontSize: labelSize, fontWeight: 700, color: '#292524',
              textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4,
            }}>
              Ingredients
            </h3>
            {ingredients.map((ing: any, idx: number) => {
              const conv = ing.quantity != null ? convertAmount(ing.quantity, ing.unit, unitSystem) : null;
              const qty = formatIngredientQuantity(conv?.quantity ?? ing.quantity, conv?.unit ?? ing.unit);
              return (
                <div key={idx} style={{
                  fontSize: bodySize, color: '#44403c', display: 'flex', gap: 3,
                  lineHeight: 1.35, marginBottom: 1,
                }}>
                  {qty && <span style={{ fontWeight: 600, color: '#1c1917', flexShrink: 0 }}>{qty}</span>}
                  <span>
                    {ing.item || ing.raw || ing.name || ''}
                    {ing.preparation && <span style={{ color: '#78716c' }}>, {ing.preparation}</span>}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Instructions */}
          <div>
            <h3 style={{
              fontSize: labelSize, fontWeight: 700, color: '#292524',
              textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4,
            }}>
              Instructions
            </h3>
            {instructions.map((step: any, idx: number) => (
              <div key={idx} style={{
                fontSize: bodySize, color: '#44403c', display: 'flex', gap: 5,
                lineHeight: 1.4, marginBottom: 3,
              }}>
                <span style={{ fontWeight: 700, color: theme.stepNum, flexShrink: 0 }}>{idx + 1}.</span>
                <span>{typeof step === 'string' ? step : step.text}</span>
              </div>
            ))}
          </div>
        </div>

        {familyPhotoSrc && <div dangerouslySetInnerHTML={{ __html: familyPhotoSlotHtml(familyPhotoSrc, theme) }} />}

        {/* Page number */}
        <div style={{
          textAlign: 'center', fontSize: pageNumSize, color: theme.pageNum,
          marginTop: 8, paddingTop: 4,
        }}>
          {index + 1}
        </div>
      </AutoFitPage>
    </div>
  );
}

// ============================================================================
// Recipe Extras Page — nutrition, tips, variations (always page 2)
// ============================================================================

function RecipeExtrasPage({ recipe, index, theme, w, h, showNutrition, showTips, showVariations }: {
  recipe: Recipe; index: number; theme: ThemeConfig;
  w: number; h: number;
  showNutrition: boolean; showTips: boolean; showVariations: boolean;
}) {
  const titleSize = Math.min(16, w * 0.028);
  const bodySize = theme.fontSizes?.body ?? Math.min(12, w * 0.02);
  const labelSize = Math.min(10, w * 0.016);
  const sectionGap = 16;

  const hasTips = showTips && recipe.tips && Array.isArray(recipe.tips) && recipe.tips.length > 0;
  const hasNutrition = showNutrition && (recipe.calories || recipe.protein || recipe.carbohydrates || recipe.fat);
  const hasVariations = showVariations && recipe.variations && Array.isArray(recipe.variations) && recipe.variations.length > 0;

  return (
    <AutoFitPage w={w} h={h} bg={theme.bg}>
      {/* Header — reference back to recipe */}
      <div style={{ marginBottom: sectionGap, borderBottom: `1px solid ${theme.accentBorder}`, paddingBottom: 8 }}>
        <p style={{
          fontSize: labelSize, color: '#78716c', textTransform: 'uppercase',
          letterSpacing: '0.05em', marginBottom: 2,
        }}>
          Additional Info
        </p>
        <h2 style={{
          fontFamily: theme.titleFont, fontWeight: 700,
          fontSize: titleSize, color: '#292524',
        }}>
          {recipe.title}
        </h2>
      </div>

      {/* Nutrition Info */}
      {hasNutrition && (
        <div style={{ marginBottom: sectionGap }}>
          <h3 style={{
            fontSize: labelSize, fontWeight: 700, color: theme.tipsTitle,
            textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8,
          }}>
            Nutrition per Serving
          </h3>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
          }}>
            {[
              { label: 'Calories', value: recipe.calories, unit: '' },
              { label: 'Protein', value: recipe.protein, unit: 'g' },
              { label: 'Carbs', value: recipe.carbohydrates, unit: 'g' },
              { label: 'Fat', value: recipe.fat, unit: 'g' },
            ].map(({ label, value, unit }) => value != null && (
              <div key={label} style={{
                textAlign: 'center', padding: '8px 4px',
                background: theme.accentLight, borderRadius: 8,
                border: `1px solid ${theme.accentBorder}`,
              }}>
                <div style={{ fontSize: bodySize * 1.4, fontWeight: 700, color: theme.accent }}>
                  {typeof value === 'number' ? Math.round(value) : value}{unit}
                </div>
                <div style={{ fontSize: labelSize, color: '#78716c', marginTop: 2 }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
          {recipe.fiber != null && (
            <p style={{ fontSize: labelSize, color: '#78716c', marginTop: 4 }}>
              Fiber: {Math.round(recipe.fiber)}g per serving
            </p>
          )}
        </div>
      )}

      {/* Tips */}
      {hasTips && (
        <div style={{
          marginBottom: sectionGap, padding: 12, borderRadius: 8,
          background: theme.tipsBg, border: `1px solid ${theme.tipsBorder}`,
        }}>
          <h3 style={{
            fontSize: labelSize, fontWeight: 700, color: theme.tipsTitle,
            textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6,
          }}>
            Chef&apos;s Tips
          </h3>
          {(recipe.tips as any[]).map((tip: any, idx: number) => (
            <p key={idx} style={{
              fontSize: bodySize, color: theme.tipsText, lineHeight: 1.5,
              marginBottom: idx < (recipe.tips as any[]).length - 1 ? 6 : 0,
            }}>
              &bull; {typeof tip === 'string' ? tip : tip.text}
            </p>
          ))}
        </div>
      )}

      {/* Variations */}
      {hasVariations && (
        <div style={{ marginBottom: sectionGap }}>
          <h3 style={{
            fontSize: labelSize, fontWeight: 700, color: theme.tipsTitle,
            textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6,
          }}>
            Variations
          </h3>
          {(recipe.variations as any[]).map((v: any, idx: number) => (
            <div key={idx} style={{ marginBottom: 6 }}>
              <p style={{ fontSize: bodySize, fontWeight: 600, color: '#292524' }}>
                {v.title}
              </p>
              <p style={{ fontSize: bodySize * 0.9, color: '#57534e', lineHeight: 1.4 }}>
                {v.description}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Page number */}
      <div style={{
        textAlign: 'center', fontSize: Math.min(9, w * 0.014), color: theme.pageNum,
        marginTop: 'auto', paddingTop: 8,
      }}>
        {index + 1}
      </div>
    </AutoFitPage>
  );
}

function BackPage({ layoutData, theme, w, h }: {
  layoutData: PrintLayoutData; theme: ThemeConfig; w: number; h: number;
}) {
  const m = MARGIN_OUTER * DPI;
  // Contrast follows the back page's own background, not the cover's
  const isDark = theme.bgBack.startsWith('#') ? isColorDark(theme.bgBack) : theme.coverDark;

  return (
    <div style={{
      width: w, height: h, background: theme.bgBack,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', padding: m, position: 'relative',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 6, background: theme.divider }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 6, background: theme.divider }} />

      <BookOpen style={{
        width: Math.min(64, w * 0.12), height: Math.min(64, w * 0.12),
        color: isDark ? 'rgba(255,255,255,0.15)' : '#d6d3d1', marginBottom: 16,
      }} />
      <h2 style={{
        fontFamily: theme.titleFont, fontWeight: 700, marginBottom: 8,
        fontSize: Math.min(24, w * 0.04),
        color: isDark ? '#fff' : '#44403c',
      }}>
        {layoutData?.title || 'My Cookbook'}
      </h2>

      {layoutData?.coverData?.backText && (
        <p style={{
          fontStyle: 'italic', maxWidth: '80%', marginBottom: 24,
          fontSize: Math.min(14, w * 0.022),
          color: isDark ? 'rgba(255,255,255,0.5)' : '#78716c',
        }}>
          {layoutData.coverData.backText}
        </p>
      )}

      <p style={{
        marginTop: 'auto',
        fontSize: Math.min(11, w * 0.018),
        color: isDark ? 'rgba(255,255,255,0.25)' : '#a8a29e',
      }}>
        Made with Grammie
      </p>
    </div>
  );
}

// ============================================================================
// Measurement Guides Overlay
// ============================================================================

function MeasurementGuides({ w, h }: { w: number; h: number }) {
  const bleed = BLEED * DPI;
  const mOuter = MARGIN_OUTER * DPI;
  const mInner = MARGIN_INNER * DPI;
  const mTop = MARGIN_TOP * DPI;
  const mBottom = MARGIN_BOTTOM * DPI;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 50 }}>
      {/* Bleed */}
      <div style={{
        position: 'absolute', top: bleed, left: bleed, right: bleed, bottom: bleed,
        border: '2px dashed rgba(239,68,68,0.5)',
      }} />
      <div style={{
        position: 'absolute', top: 2, left: bleed + 4, fontSize: 8,
        color: '#ef4444', background: 'rgba(255,255,255,0.85)', padding: '0 3px', borderRadius: 2,
      }}>
        Bleed {BLEED}&quot;
      </div>

      {/* Safe zone */}
      <div style={{
        position: 'absolute', top: mTop, left: mInner, right: mOuter, bottom: mBottom,
        border: '1px dashed rgba(59,130,246,0.4)',
      }} />
      <div style={{
        position: 'absolute', top: mTop + 2, left: mInner + 4, fontSize: 8,
        color: '#3b82f6', background: 'rgba(255,255,255,0.85)', padding: '0 3px', borderRadius: 2,
      }}>
        Safe zone ({MARGIN_INNER}&quot; gutter / {MARGIN_OUTER}&quot; outer)
      </div>

      {/* Dimensions */}
      <div style={{
        position: 'absolute', bottom: 4, right: 4, fontSize: 9,
        color: '#57534e', background: 'rgba(255,255,255,0.9)', padding: '2px 6px',
        borderRadius: 3, boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      }}>
        {(w / DPI).toFixed(2)}&quot; &times; {(h / DPI).toFixed(2)}&quot;
      </div>

      {/* Center cross */}
      <div style={{
        position: 'absolute', left: w / 2, top: mTop, bottom: mBottom,
        borderLeft: '1px dashed rgba(34,197,94,0.25)',
      }} />
      <div style={{
        position: 'absolute', top: h / 2, left: mInner, right: mOuter,
        borderTop: '1px dashed rgba(34,197,94,0.25)',
      }} />
    </div>
  );
}
