import { useEffect, useRef, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Loader2 } from "lucide-react";
import type { PrintLayoutData } from "@shared/schema";

interface Recipe {
  id: string;
  title: string;
  description?: string | null;
  dishImage?: string | null;
  dishImageThumbnail?: string | null;
  handwrittenImage?: string | null;
  ingredients?: Array<{ name: string; quantity?: string; unit?: string }> | null;
  instructions?: Array<{ step: number; instruction: string }> | null;
  prepTimeMinutes?: number | null;
  cookTimeMinutes?: number | null;
  totalTimeMinutes?: number | null;
  servings?: number | null;
  cuisineType?: string | null;
  difficulty?: string | null;
  nutritionInfo?: {
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
  } | null;
}

interface CookbookPrintPreviewProps {
  open: boolean;
  onClose: () => void;
  layoutData: PrintLayoutData;
  templateStyle: 'classic' | 'modern' | 'rustic' | 'minimalist';
  cookbookId: number;
}

const PAGE_SIZE_DIMENSIONS = {
  '6x9': { width: '6in', height: '9in' },
  '8.5x11': { width: '8.5in', height: '11in' },
  'a4': { width: '210mm', height: '297mm' },
};

export function CookbookPrintPreview({
  open,
  onClose,
  layoutData,
  templateStyle,
  cookbookId,
}: CookbookPrintPreviewProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(0.5);

  const allRecipeIds = layoutData.sections.flatMap(s => s.recipeIds);

  const { data: recipesData, isLoading: recipesLoading } = useQuery<{ recipes: Recipe[] }>({
    queryKey: ['/api/recipes/batch', allRecipeIds],
    queryFn: async () => {
      if (allRecipeIds.length === 0) return { recipes: [] };
      const response = await fetch(`/api/recipes/batch?ids=${allRecipeIds.join(',')}`);
      if (!response.ok) throw new Error('Failed to load recipes');
      return response.json();
    },
    enabled: open && allRecipeIds.length > 0,
  });

  const recipesById = useMemo(() => {
    const map = new Map<string, Recipe>();
    recipesData?.recipes.forEach(r => map.set(r.id, r));
    return map;
  }, [recipesData?.recipes]);

  useEffect(() => {
    if (!open || recipesLoading || !previewRef.current || recipesById.size === 0) return;

    const renderPreview = async () => {
      setIsRendering(true);
      try {
        const { Previewer } = await import('pagedjs');
        const previewer = new Previewer();
        
        const container = previewRef.current;
        if (!container) return;

        container.innerHTML = '';

        const content = document.createElement('div');
        content.innerHTML = DOMPurify.sanitize(generatePrintHTML(layoutData, templateStyle, recipesById));

        const styleContent = generatePrintCSS(templateStyle, layoutData.customizations?.pageSize || '6x9');

        await previewer.preview(content, [styleContent], container);
        
        const pages = container.querySelectorAll('.pagedjs_page');
        setPageCount(pages.length);
        setCurrentPage(1);
      } catch (error) {
        console.error('Failed to render preview:', error);
      } finally {
        setIsRendering(false);
      }
    };

    const timer = setTimeout(renderPreview, 100);
    return () => clearTimeout(timer);
  }, [open, recipesLoading, layoutData, templateStyle, recipesById]);

  const scrollToPage = (pageNum: number) => {
    if (!previewRef.current) return;
    const pages = previewRef.current.querySelectorAll('.pagedjs_page');
    if (pages[pageNum - 1]) {
      pages[pageNum - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
      setCurrentPage(pageNum);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-6xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="p-4 border-b flex-shrink-0">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle>Print Preview</DialogTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setZoom(z => Math.max(0.25, z - 0.1))}
                data-testid="button-zoom-out"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Badge variant="secondary">{Math.round(zoom * 100)}%</Badge>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setZoom(z => Math.min(1.5, z + 0.1))}
                data-testid="button-zoom-in"
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <div className="h-6 w-px bg-border mx-2" />
              <Button
                variant="outline"
                size="icon"
                onClick={() => scrollToPage(Math.max(1, currentPage - 1))}
                disabled={currentPage <= 1}
                data-testid="button-prev-page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm min-w-[80px] text-center" data-testid="text-page-number">
                Page {currentPage} of {pageCount || '?'}
              </span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => scrollToPage(Math.min(pageCount, currentPage + 1))}
                disabled={currentPage >= pageCount}
                data-testid="button-next-page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <div className="h-6 w-px bg-border mx-2" />
              <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-preview">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 bg-muted/50">
          {(isRendering || recipesLoading) && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-3 text-muted-foreground">Rendering preview...</span>
            </div>
          )}
          <div
            ref={previewRef}
            className="pagedjs-preview mx-auto py-8"
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: 'top center',
              minHeight: zoom < 1 ? `${100 / zoom}%` : undefined,
            }}
            data-testid="preview-container"
          />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function generatePrintHTML(
  layoutData: PrintLayoutData,
  templateStyle: string,
  recipesById: Map<string, Recipe>
): string {
  const { title, subtitle, authorName, dedication, sections, customizations } = layoutData;
  
  let html = `<div class="cookbook cookbook-${templateStyle}">`;

  html += `
    <section class="title-page">
      <div class="title-content">
        <h1 class="book-title">${escapeHtml(title || 'My Cookbook')}</h1>
        ${subtitle ? `<p class="book-subtitle">${escapeHtml(subtitle)}</p>` : ''}
        ${authorName ? `<p class="book-author">by ${escapeHtml(authorName)}</p>` : ''}
      </div>
    </section>
  `;

  if (dedication) {
    html += `
      <section class="dedication-page">
        <div class="dedication-content">
          <p class="dedication-text">${escapeHtml(dedication)}</p>
        </div>
      </section>
    `;
  }

  html += `
    <section class="toc-page">
      <h2 class="toc-title">Table of Contents</h2>
      <div class="toc-entries">
  `;

  sections.forEach((section, sectionIdx) => {
    html += `<div class="toc-section">
      <span class="toc-section-title">${escapeHtml(section.title)}</span>
    </div>`;
    
    section.recipeIds.forEach((recipeId) => {
      const recipe = recipesById.get(recipeId);
      if (recipe) {
        html += `<div class="toc-entry">
          <span class="toc-recipe-title">${escapeHtml(recipe.title)}</span>
          <span class="toc-page-ref"></span>
        </div>`;
      }
    });
  });

  html += `</div></section>`;

  sections.forEach((section) => {
    html += `
      <section class="section-divider">
        <h2 class="section-title">${escapeHtml(section.title)}</h2>
      </section>
    `;

    section.recipeIds.forEach((recipeId) => {
      const recipe = recipesById.get(recipeId);
      if (recipe) {
        html += generateRecipeHTML(recipe, customizations?.showNutrition !== false);
      }
    });
  });

  html += '</div>';
  return html;
}

function generateRecipeHTML(recipe: Recipe, showNutrition: boolean): string {
  // Use unified print-recipe classes that match single recipe print layout
  let html = `<article class="recipe-page print-recipe" data-recipe-id="${recipe.id}">`;
  
  // Header with title and description
  html += `<div class="print-recipe-header">`;
  html += `<h1 class="print-recipe-title">${escapeHtml(recipe.title)}</h1>`;
  if (recipe.description) {
    html += `<p class="print-recipe-description">${escapeHtml(recipe.description)}</p>`;
  }
  html += `</div>`;

  // Images side by side: dish image left, handwritten right
  const hasDishImage = recipe.dishImageThumbnail || recipe.dishImage;
  const hasHandwrittenImage = recipe.handwrittenImage;
  if (hasDishImage || hasHandwrittenImage) {
    html += `<div class="print-recipe-images">`;
    if (hasDishImage) {
      const imgSrc = recipe.dishImageThumbnail || recipe.dishImage;
      html += `<img src="${imgSrc}" alt="${escapeHtml(recipe.title)}" class="print-recipe-dish-image" />`;
    }
    if (hasHandwrittenImage) {
      html += `<img src="${recipe.handwrittenImage}" alt="Original recipe" class="print-recipe-handwritten-image" />`;
    }
    html += `</div>`;
  }

  // Prep time info on single line
  html += '<div class="print-recipe-info">';
  if (recipe.prepTimeMinutes) {
    html += `<span>Prep: ${recipe.prepTimeMinutes} min</span>`;
  }
  if (recipe.cookTimeMinutes) {
    html += `<span>Cook: ${recipe.cookTimeMinutes} min</span>`;
  }
  const totalTime = (recipe.prepTimeMinutes || 0) + (recipe.cookTimeMinutes || 0);
  if (totalTime > 0) {
    html += `<span>Total: ${totalTime} min</span>`;
  }
  if (recipe.servings) {
    html += `<span>Serves: ${recipe.servings}</span>`;
  }
  html += '</div>';

  // Two-column layout for ingredients and instructions
  html += '<div class="print-recipe-content">';
  
  if (recipe.ingredients && recipe.ingredients.length > 0) {
    html += '<div class="print-recipe-ingredients"><h2>Ingredients</h2><ul>';
    recipe.ingredients.forEach(ing => {
      const qty = ing.quantity ? `${ing.quantity} ` : '';
      const unit = ing.unit ? `${ing.unit} ` : '';
      html += `<li>${qty}${unit}${escapeHtml(ing.name)}</li>`;
    });
    html += '</ul></div>';
  }

  if (recipe.instructions && recipe.instructions.length > 0) {
    html += '<div class="print-recipe-instructions"><h2>Instructions</h2><ol>';
    recipe.instructions.forEach(inst => {
      html += `<li>${escapeHtml(inst.instruction)}</li>`;
    });
    html += '</ol></div>';
  }

  html += '</div>'; // close print-recipe-content

  if (showNutrition && recipe.nutritionInfo) {
    const { calories, protein, carbs, fat } = recipe.nutritionInfo;
    html += '<div class="print-recipe-nutrition"><h2>Nutrition (per serving)</h2><div class="nutrition-grid">';
    if (calories) html += `<span>Calories: ${calories}</span>`;
    if (protein) html += `<span>Protein: ${protein}g</span>`;
    if (carbs) html += `<span>Carbs: ${carbs}g</span>`;
    if (fat) html += `<span>Fat: ${fat}g</span>`;
    html += '</div></div>';
  }

  html += '</article>';
  return html;
}

function generatePrintCSS(templateStyle: string, pageSize: string): string {
  const dimensions = PAGE_SIZE_DIMENSIONS[pageSize as keyof typeof PAGE_SIZE_DIMENSIONS] || PAGE_SIZE_DIMENSIONS['6x9'];
  
  const baseCSS = `
    @page {
      size: ${dimensions.width} ${dimensions.height};
      margin: 0.75in 0.625in;
      @bottom-center {
        content: counter(page);
        font-size: 10pt;
      }
    }

    @page :first {
      @bottom-center { content: none; }
    }

    .cookbook {
      font-family: Georgia, serif;
      font-size: 11pt;
      line-height: 1.5;
      color: #1a1a1a;
    }

    .title-page {
      page: title;
      break-after: page;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      text-align: center;
    }

    @page title {
      @bottom-center { content: none; }
    }

    .book-title {
      font-size: 32pt;
      font-weight: bold;
      margin-bottom: 0.5em;
    }

    .book-subtitle {
      font-size: 16pt;
      font-style: italic;
      color: #666;
      margin-bottom: 1em;
    }

    .book-author {
      font-size: 14pt;
      color: #444;
    }

    .dedication-page {
      page: dedication;
      break-after: page;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      text-align: center;
    }

    @page dedication {
      @bottom-center { content: none; }
    }

    .dedication-text {
      font-style: italic;
      font-size: 14pt;
      max-width: 4in;
      margin: 0 auto;
    }

    .toc-page {
      break-after: page;
    }

    .toc-title {
      font-size: 24pt;
      text-align: center;
      margin-bottom: 1em;
    }

    .toc-section {
      font-weight: bold;
      margin-top: 1em;
      padding-bottom: 0.25em;
      border-bottom: 1px solid #ccc;
    }

    .toc-entry {
      display: flex;
      justify-content: space-between;
      padding: 0.25em 0 0.25em 1em;
    }

    .section-divider {
      page: section;
      break-before: page;
      break-after: page;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      text-align: center;
    }

    @page section {
      @bottom-center { content: none; }
    }

    .section-title {
      font-size: 28pt;
      font-weight: bold;
    }

    .recipe-page {
      break-before: page;
      break-inside: avoid-page;
    }

    .recipe-title {
      font-size: 18pt;
      font-weight: bold;
      margin-bottom: 0.5em;
      color: #333;
    }

    .recipe-image {
      width: 100%;
      max-height: 3in;
      overflow: hidden;
      margin-bottom: 0.5em;
    }

    .recipe-image img {
      width: 100%;
      height: auto;
      object-fit: cover;
    }

    .recipe-description {
      font-style: italic;
      color: #555;
      margin-bottom: 0.75em;
    }

    .recipe-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 1em;
      font-size: 10pt;
      color: #666;
      margin-bottom: 1em;
      padding-bottom: 0.5em;
      border-bottom: 1px solid #ddd;
    }

    .recipe-ingredients,
    .recipe-instructions,
    .recipe-nutrition {
      margin-bottom: 1em;
    }

    .recipe-ingredients h4,
    .recipe-instructions h4,
    .recipe-nutrition h4 {
      font-size: 12pt;
      font-weight: bold;
      margin-bottom: 0.5em;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .recipe-ingredients ul {
      list-style: none;
      padding: 0;
    }

    .recipe-ingredients li {
      padding: 0.2em 0;
      border-bottom: 1px dotted #ddd;
    }

    .recipe-instructions ol {
      padding-left: 1.5em;
    }

    .recipe-instructions li {
      margin-bottom: 0.5em;
    }

    .nutrition-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 1em;
      font-size: 10pt;
    }

    /* Unified print-recipe styles (shared with single recipe print) */
    .print-recipe {
      background: white;
      color: black;
      font-family: Georgia, 'Times New Roman', serif;
    }

    .print-recipe-header {
      text-align: center;
      margin-bottom: 0.25rem;
      padding-bottom: 0.25rem;
    }

    .print-recipe-title {
      font-size: 16pt;
      font-weight: bold;
      margin: 0 0 0.15rem;
      color: #1a1a1a;
    }

    .print-recipe-description {
      font-size: 8pt;
      font-style: italic;
      color: #444;
      margin: 0 0 0.25rem;
    }

    .print-recipe-images {
      display: flex;
      justify-content: center;
      align-items: flex-start;
      gap: 1rem;
      margin-bottom: 0.25rem;
    }

    .print-recipe-dish-image,
    .print-recipe-handwritten-image {
      max-width: 2.5in;
      max-height: 2in;
      width: auto;
      height: auto;
      border-radius: 4px;
      object-fit: cover;
      border: 1px solid #ddd;
    }

    .print-recipe-info {
      display: flex;
      justify-content: center;
      gap: 1rem;
      padding: 0.15rem 0;
      margin-bottom: 0.3rem;
      font-size: 8pt;
      color: #555;
      border-bottom: 1px solid #ddd;
    }

    .print-recipe-content {
      display: flex;
      flex-direction: row;
      gap: 0.5rem;
      margin-bottom: 0.25rem;
    }

    .print-recipe-content > .print-recipe-ingredients {
      flex: 1;
      min-width: 0;
    }

    .print-recipe-content > .print-recipe-instructions {
      flex: 2;
      min-width: 0;
    }

    .print-recipe-ingredients {
      background: #f9f9f9;
      padding: 0.3rem 0.5rem;
      border-radius: 4px;
      border: 1px solid #e0e0e0;
      color: #000;
    }

    .print-recipe-instructions {
      color: #000;
    }

    .print-recipe-ingredients h2,
    .print-recipe-instructions h2,
    .print-recipe-nutrition h2 {
      font-size: 9pt;
      font-weight: bold;
      margin: 0 0 0.2rem;
      color: #1a1a1a;
      border-bottom: 1px solid #ccc;
      padding-bottom: 0.15rem;
    }

    .print-recipe-ingredients ul {
      list-style: disc;
      padding-left: 1rem;
      margin: 0;
      color: #000;
      columns: 2;
      column-gap: 0.5rem;
    }

    .print-recipe-ingredients li {
      font-size: 8pt;
      margin-bottom: 0.1rem;
      line-height: 1.2;
      color: #000;
      break-inside: avoid;
    }

    .print-recipe-instructions ol {
      list-style: decimal;
      padding-left: 1rem;
      margin: 0;
      color: #000;
    }

    .print-recipe-instructions li {
      font-size: 8pt;
      margin-bottom: 0.2rem;
      line-height: 1.25;
      color: #000;
    }

    .print-recipe-nutrition {
      margin-top: 0.3rem;
      padding: 0.3rem 0.5rem;
      background: #f5f5f5;
      border-radius: 4px;
    }
  `;

  const styleVariants: Record<string, string> = {
    classic: `
      .cookbook-classic {
        font-family: 'Playfair Display', Georgia, 'Times New Roman', serif;
        color: #2c2c2c;
      }
      .cookbook-classic .title-content {
        border: 3px double #8b7355;
        padding: 1.5em 2em;
      }
      .cookbook-classic .book-title {
        font-family: 'Playfair Display', Georgia, serif;
        font-size: 36pt;
        font-weight: 700;
        color: #3d2914;
        text-transform: none;
        letter-spacing: 0.02em;
        border-bottom: 2px solid #c4a77d;
        padding-bottom: 0.3em;
      }
      .cookbook-classic .book-subtitle {
        font-size: 18pt;
        font-style: italic;
        color: #5c4033;
        margin-top: 0.5em;
      }
      .cookbook-classic .book-author {
        font-size: 14pt;
        font-variant: small-caps;
        letter-spacing: 0.1em;
        color: #6b5344;
        margin-top: 1.5em;
      }
      .cookbook-classic .dedication-text {
        font-family: 'Playfair Display', Georgia, serif;
        font-size: 16pt;
        font-style: italic;
        color: #4a3728;
        line-height: 1.8;
      }
      .cookbook-classic .toc-title {
        font-family: 'Playfair Display', Georgia, serif;
        font-size: 26pt;
        color: #3d2914;
        border-bottom: 1px solid #c4a77d;
        padding-bottom: 0.3em;
      }
      .cookbook-classic .toc-section {
        font-family: 'Playfair Display', Georgia, serif;
        font-size: 13pt;
        color: #5c4033;
        border-bottom: 1px solid #d4c4a7;
      }
      .cookbook-classic .toc-entry {
        font-size: 11pt;
        color: #4a4a4a;
      }
      .cookbook-classic .section-title {
        font-family: 'Playfair Display', Georgia, serif;
        font-size: 32pt;
        color: #3d2914;
        font-weight: 700;
      }
      .cookbook-classic .section-divider::before {
        content: "✦";
        display: block;
        font-size: 24pt;
        color: #c4a77d;
        margin-bottom: 0.5em;
      }
      .cookbook-classic .recipe-title {
        font-family: 'Playfair Display', Georgia, serif;
        font-size: 20pt;
        color: #3d2914;
        border-bottom: 1px solid #c4a77d;
        padding-bottom: 0.25em;
      }
      .cookbook-classic .recipe-description {
        font-style: italic;
        color: #5c4033;
        font-size: 11pt;
        line-height: 1.6;
      }
      .cookbook-classic .recipe-meta {
        background: linear-gradient(to right, #f8f4ef, transparent);
        padding: 0.5em 0.75em;
        border-left: 3px solid #c4a77d;
        border-bottom: none;
        color: #5c4033;
      }
      .cookbook-classic .recipe-ingredients h4,
      .cookbook-classic .recipe-instructions h4,
      .cookbook-classic .recipe-nutrition h4 {
        font-family: 'Playfair Display', Georgia, serif;
        color: #5c4033;
        font-size: 13pt;
        letter-spacing: 0.08em;
        border-bottom: 1px dotted #d4c4a7;
        padding-bottom: 0.25em;
      }
      .cookbook-classic .recipe-ingredients li {
        border-bottom-color: #e8dfd4;
      }
      .cookbook-classic .recipe-image {
        border: 1px solid #d4c4a7;
        padding: 4px;
        background: #f8f4ef;
      }
    `,
    modern: `
      .cookbook-modern {
        font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
        color: #1a1a1a;
      }
      .cookbook-modern .title-page {
        background: linear-gradient(135deg, #f5f5f5 0%, #ffffff 100%);
      }
      .cookbook-modern .book-title {
        font-weight: 200;
        font-size: 42pt;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        color: #1a1a1a;
      }
      .cookbook-modern .book-subtitle {
        font-weight: 300;
        font-size: 14pt;
        font-style: normal;
        letter-spacing: 0.3em;
        text-transform: uppercase;
        color: #666;
        margin-top: 1em;
      }
      .cookbook-modern .book-author {
        font-weight: 400;
        font-size: 12pt;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: #888;
        margin-top: 2em;
      }
      .cookbook-modern .dedication-text {
        font-weight: 300;
        font-size: 14pt;
        font-style: normal;
        color: #555;
        line-height: 2;
        letter-spacing: 0.02em;
      }
      .cookbook-modern .toc-title {
        font-weight: 200;
        font-size: 20pt;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        text-align: left;
        border-left: 4px solid #1a1a1a;
        padding-left: 0.5em;
      }
      .cookbook-modern .toc-section {
        font-weight: 600;
        font-size: 11pt;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        color: #333;
        border-bottom: 2px solid #1a1a1a;
        padding-bottom: 0.3em;
      }
      .cookbook-modern .toc-entry {
        font-weight: 300;
        font-size: 10pt;
        letter-spacing: 0.05em;
      }
      .cookbook-modern .section-title {
        font-weight: 100;
        font-size: 36pt;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: #1a1a1a;
      }
      .cookbook-modern .section-divider::after {
        content: "";
        display: block;
        width: 60px;
        height: 2px;
        background: #1a1a1a;
        margin: 1em auto 0;
      }
      .cookbook-modern .recipe-title {
        font-weight: 600;
        font-size: 18pt;
        letter-spacing: 0.05em;
        color: #1a1a1a;
        text-transform: uppercase;
      }
      .cookbook-modern .recipe-description {
        font-weight: 300;
        font-style: normal;
        color: #666;
        font-size: 10pt;
        letter-spacing: 0.02em;
      }
      .cookbook-modern .recipe-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0;
        border: 1px solid #e0e0e0;
        padding: 0;
        background: #fafafa;
      }
      .cookbook-modern .recipe-meta .meta-item {
        flex: 1 1 auto;
        min-width: 80px;
        padding: 0.5em 0.75em;
        text-align: center;
        border-right: 1px solid #e0e0e0;
        font-size: 9pt;
        text-transform: uppercase;
        letter-spacing: 0.1em;
      }
      .cookbook-modern .recipe-meta .meta-item:last-child {
        border-right: none;
      }
      .cookbook-modern .recipe-ingredients h4,
      .cookbook-modern .recipe-instructions h4,
      .cookbook-modern .recipe-nutrition h4 {
        font-weight: 600;
        font-size: 10pt;
        letter-spacing: 0.15em;
        color: #333;
        border-bottom: 1px solid #1a1a1a;
        padding-bottom: 0.3em;
        margin-bottom: 0.75em;
      }
      .cookbook-modern .recipe-ingredients li {
        border-bottom: none;
        padding: 0.15em 0;
        font-weight: 300;
      }
      .cookbook-modern .recipe-ingredients li::before {
        content: "—";
        margin-right: 0.5em;
        color: #999;
      }
      .cookbook-modern .recipe-instructions li {
        font-weight: 300;
      }
      .cookbook-modern .recipe-image {
        max-height: 2.5in;
      }
      .cookbook-modern .recipe-image img {
        filter: grayscale(10%);
      }
    `,
    rustic: `
      .cookbook-rustic {
        font-family: 'Merriweather', 'Cambria', Georgia, serif;
        color: #2e1a0a;
        background-color: #faf6f1;
      }
      .cookbook-rustic .title-content {
        background: 
          radial-gradient(ellipse at center, rgba(196, 167, 125, 0.1) 0%, transparent 70%);
      }
      .cookbook-rustic .book-title {
        font-family: 'Merriweather', Georgia, serif;
        font-size: 34pt;
        font-weight: 700;
        color: #3d2914;
      }
      .cookbook-rustic .book-title::before,
      .cookbook-rustic .book-title::after {
        content: "❧";
        display: block;
        font-size: 18pt;
        color: #8b7355;
        margin: 0.3em 0;
      }
      .cookbook-rustic .book-subtitle {
        font-size: 16pt;
        font-style: italic;
        color: #4a3020;
      }
      .cookbook-rustic .book-author {
        font-size: 14pt;
        color: #5c4033;
        font-style: italic;
      }
      .cookbook-rustic .dedication-text {
        font-family: 'Merriweather', Georgia, serif;
        font-size: 15pt;
        font-style: italic;
        color: #3d2914;
        line-height: 1.9;
        border-left: 3px solid #8b7355;
        padding-left: 1em;
        text-align: left;
      }
      .cookbook-rustic .toc-title {
        font-family: 'Merriweather', Georgia, serif;
        font-size: 24pt;
        color: #3d2914;
        text-align: center;
      }
      .cookbook-rustic .toc-title::after {
        content: "";
        display: block;
        width: 100px;
        height: 3px;
        background: linear-gradient(to right, transparent, #8b7355, transparent);
        margin: 0.5em auto 0;
      }
      .cookbook-rustic .toc-section {
        font-size: 12pt;
        color: #3d2914;
        border-bottom: 2px solid #8b7355;
        background: linear-gradient(to right, rgba(139, 115, 85, 0.1), transparent);
        padding: 0.3em 0.5em;
      }
      .cookbook-rustic .toc-entry {
        color: #4a3020;
        font-size: 11pt;
      }
      .cookbook-rustic .section-title {
        font-family: 'Merriweather', Georgia, serif;
        font-size: 30pt;
        color: #3d2914;
      }
      .cookbook-rustic .section-divider {
        background: 
          radial-gradient(ellipse at center, rgba(139, 115, 85, 0.1) 0%, transparent 60%);
      }
      .cookbook-rustic .section-divider::before,
      .cookbook-rustic .section-divider::after {
        content: "✿";
        display: block;
        font-size: 20pt;
        color: #8b7355;
      }
      .cookbook-rustic .section-divider::before { margin-bottom: 0.5em; }
      .cookbook-rustic .section-divider::after { margin-top: 0.5em; }
      .cookbook-rustic .recipe-title {
        font-family: 'Merriweather', Georgia, serif;
        font-size: 19pt;
        color: #3d2914;
        padding-bottom: 0.3em;
        border-bottom: 2px solid #8b7355;
      }
      .cookbook-rustic .recipe-description {
        font-style: italic;
        color: #4a3020;
        font-size: 11pt;
        background: rgba(139, 115, 85, 0.06);
        padding: 0.5em 0.75em;
        border-radius: 3px;
      }
      .cookbook-rustic .recipe-meta {
        background: rgba(139, 115, 85, 0.08);
        padding: 0.6em 0.75em;
        border: 1px solid #b8a690;
        border-radius: 4px;
        color: #3d2914;
      }
      .cookbook-rustic .recipe-ingredients h4,
      .cookbook-rustic .recipe-instructions h4,
      .cookbook-rustic .recipe-nutrition h4 {
        font-family: 'Merriweather', Georgia, serif;
        color: #3d2914;
        font-size: 12pt;
        letter-spacing: 0.05em;
      }
      .cookbook-rustic .recipe-ingredients li {
        border-bottom: 1px dashed #b8a690;
        color: #2e1a0a;
      }
      .cookbook-rustic .recipe-instructions li {
        color: #2e1a0a;
      }
      .cookbook-rustic .recipe-image {
        border: 3px solid #8b7355;
        padding: 5px;
        background: #faf6f1;
      }
      .cookbook-rustic .nutrition-grid {
        background: rgba(139, 115, 85, 0.06);
        padding: 0.5em;
        border-radius: 3px;
        color: #3d2914;
      }
    `,
    minimalist: `
      .cookbook-minimalist {
        font-family: 'Source Sans Pro', 'Segoe UI', Roboto, sans-serif;
        color: #333;
      }
      .cookbook-minimalist .title-page {
        padding: 2in 0;
      }
      .cookbook-minimalist .book-title {
        font-weight: 300;
        font-size: 28pt;
        color: #222;
        letter-spacing: 0.02em;
      }
      .cookbook-minimalist .book-subtitle {
        font-weight: 300;
        font-size: 12pt;
        font-style: normal;
        color: #888;
        margin-top: 0.75em;
      }
      .cookbook-minimalist .book-author {
        font-weight: 400;
        font-size: 11pt;
        color: #666;
        margin-top: 3em;
      }
      .cookbook-minimalist .dedication-text {
        font-weight: 300;
        font-size: 13pt;
        font-style: normal;
        color: #555;
        line-height: 2;
        max-width: 3.5in;
      }
      .cookbook-minimalist .toc-title {
        font-weight: 300;
        font-size: 18pt;
        text-align: left;
        color: #333;
        margin-bottom: 1.5em;
      }
      .cookbook-minimalist .toc-section {
        font-weight: 500;
        font-size: 11pt;
        color: #222;
        border-bottom: 1px solid #eee;
        padding-bottom: 0.2em;
        margin-top: 1.5em;
      }
      .cookbook-minimalist .toc-entry {
        font-weight: 300;
        font-size: 10pt;
        color: #666;
        padding: 0.2em 0 0.2em 0;
      }
      .cookbook-minimalist .section-title {
        font-weight: 300;
        font-size: 24pt;
        color: #222;
      }
      .cookbook-minimalist .recipe-page {
        padding-top: 0.5in;
      }
      .cookbook-minimalist .recipe-title {
        font-weight: 500;
        font-size: 16pt;
        color: #222;
        margin-bottom: 0.3em;
      }
      .cookbook-minimalist .recipe-description {
        font-weight: 300;
        font-style: normal;
        color: #666;
        font-size: 10pt;
        margin-bottom: 1em;
      }
      .cookbook-minimalist .recipe-meta {
        font-size: 9pt;
        color: #888;
        border-bottom: none;
        padding-bottom: 0;
        margin-bottom: 1.5em;
        gap: 1.5em;
      }
      .cookbook-minimalist .recipe-meta .meta-item {
        font-weight: 400;
      }
      .cookbook-minimalist .recipe-ingredients h4,
      .cookbook-minimalist .recipe-instructions h4,
      .cookbook-minimalist .recipe-nutrition h4 {
        font-weight: 500;
        text-transform: none;
        font-size: 11pt;
        letter-spacing: 0;
        color: #333;
        margin-bottom: 0.75em;
      }
      .cookbook-minimalist .recipe-ingredients ul {
        columns: 2;
        column-gap: 1.5em;
      }
      .cookbook-minimalist .recipe-ingredients li {
        font-weight: 300;
        font-size: 10pt;
        border-bottom: none;
        padding: 0.15em 0;
        break-inside: avoid;
      }
      .cookbook-minimalist .recipe-instructions li {
        font-weight: 300;
        font-size: 10pt;
        line-height: 1.7;
        margin-bottom: 0.75em;
      }
      .cookbook-minimalist .recipe-image {
        max-height: 2in;
        margin-bottom: 1em;
      }
      .cookbook-minimalist .nutrition-grid {
        font-size: 9pt;
        color: #888;
        font-weight: 300;
      }
    `,
  };

  return baseCSS + (styleVariants[templateStyle] || '');
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
