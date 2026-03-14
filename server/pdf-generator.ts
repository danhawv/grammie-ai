import puppeteer from 'puppeteer';
import type { PrintLayoutData } from '@shared/schema';
import { execSync } from 'child_process';
import fs from 'fs';

// Find Chromium executable path dynamically (works in dev and production)
function findChromiumPath(): string {
  // Check environment variable first
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  
  // Try puppeteer's bundled chromium
  try {
    const bundledPath = puppeteer.executablePath();
    if (fs.existsSync(bundledPath)) {
      return bundledPath;
    }
  } catch (e) {
    // Puppeteer bundled chromium not available
  }
  
  // Common Nix store paths (check multiple versions)
  const nixPaths = [
    '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium',
    '/nix/store/x205pbkd5xh5g4iv0g58xjla55has3cx-chromium-125.0.6422.141/bin/chromium',
  ];
  
  for (const path of nixPaths) {
    if (fs.existsSync(path)) {
      return path;
    }
  }
  
  // Try to find chromium using which command
  try {
    const chromiumPath = execSync('which chromium 2>/dev/null').toString().trim();
    if (chromiumPath && fs.existsSync(chromiumPath)) {
      return chromiumPath;
    }
  } catch (e) {
    // which command failed
  }
  
  // Try common Linux paths
  const commonPaths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];
  
  for (const path of commonPaths) {
    if (fs.existsSync(path)) {
      return path;
    }
  }
  
  // Fallback - let puppeteer try to figure it out
  throw new Error('Chromium executable not found. Please set PUPPETEER_EXECUTABLE_PATH environment variable.');
}

interface Recipe {
  id: string;
  title: string;
  description?: string | null;
  dishImageThumbnail?: string | null;
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

type TemplateStyle = 'classic' | 'modern' | 'rustic' | 'minimalist';

const PAGE_SIZE_DIMENSIONS = {
  '6x9': { width: '6in', height: '9in' },
  '8.5x11': { width: '8.5in', height: '11in' },
  'a4': { width: '210mm', height: '297mm' },
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generateRecipeHTML(recipe: Recipe, showNutrition: boolean): string {
  let html = `<article class="recipe-page" data-recipe-id="${recipe.id}">`;
  
  html += `<h3 class="recipe-title">${escapeHtml(recipe.title)}</h3>`;
  
  if (recipe.dishImageThumbnail) {
    html += `<div class="recipe-image"><img src="${recipe.dishImageThumbnail}" alt="${escapeHtml(recipe.title)}" /></div>`;
  }

  if (recipe.description) {
    html += `<p class="recipe-description">${escapeHtml(recipe.description)}</p>`;
  }

  html += '<div class="recipe-meta">';
  if (recipe.prepTimeMinutes) {
    html += `<span class="meta-item">Prep: ${recipe.prepTimeMinutes} min</span>`;
  }
  if (recipe.cookTimeMinutes) {
    html += `<span class="meta-item">Cook: ${recipe.cookTimeMinutes} min</span>`;
  }
  if (recipe.servings) {
    html += `<span class="meta-item">Serves: ${recipe.servings}</span>`;
  }
  if (recipe.difficulty) {
    html += `<span class="meta-item">Difficulty: ${recipe.difficulty}</span>`;
  }
  html += '</div>';

  if (recipe.ingredients && recipe.ingredients.length > 0) {
    html += '<div class="recipe-ingredients"><h4>Ingredients</h4><ul>';
    recipe.ingredients.forEach(ing => {
      const qty = ing.quantity ? `${ing.quantity} ` : '';
      const unit = ing.unit ? `${ing.unit} ` : '';
      html += `<li>${qty}${unit}${escapeHtml(ing.name)}</li>`;
    });
    html += '</ul></div>';
  }

  if (recipe.instructions && recipe.instructions.length > 0) {
    html += '<div class="recipe-instructions"><h4>Instructions</h4><ol>';
    recipe.instructions.forEach(inst => {
      html += `<li>${escapeHtml(inst.instruction)}</li>`;
    });
    html += '</ol></div>';
  }

  if (showNutrition && recipe.nutritionInfo) {
    const { calories, protein, carbs, fat } = recipe.nutritionInfo;
    html += '<div class="recipe-nutrition"><h4>Nutrition (per serving)</h4><div class="nutrition-grid">';
    if (calories) html += `<span>Calories: ${calories}</span>`;
    if (protein) html += `<span>Protein: ${protein}g</span>`;
    if (carbs) html += `<span>Carbs: ${carbs}g</span>`;
    if (fat) html += `<span>Fat: ${fat}g</span>`;
    html += '</div></div>';
  }

  html += '</article>';
  return html;
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

  sections.forEach((section) => {
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

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 0;
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
      margin: 0;
    }

    .recipe-ingredients li {
      padding: 0.2em 0;
      border-bottom: 1px dotted #ddd;
    }

    .recipe-instructions ol {
      padding-left: 1.5em;
      margin: 0;
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
        font-weight: 700;
        font-size: 10pt;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        color: #333;
      }
      .cookbook-modern .recipe-ingredients li {
        border-bottom: none;
        padding: 0.15em 0;
        font-size: 10pt;
      }
      .cookbook-modern .recipe-instructions li {
        font-size: 10pt;
        line-height: 1.6;
      }
    `,
    rustic: `
      .cookbook-rustic {
        font-family: 'Courier Prime', 'Courier New', monospace;
        color: #3d3d3d;
        background: #faf8f5;
      }
      .cookbook-rustic .book-title {
        font-size: 30pt;
        font-weight: bold;
        color: #5c4033;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        border-bottom: 4px solid #8b7355;
        padding-bottom: 0.3em;
      }
      .cookbook-rustic .book-subtitle {
        font-size: 14pt;
        color: #6b5344;
        margin-top: 0.75em;
      }
      .cookbook-rustic .book-author {
        font-size: 12pt;
        color: #8b7355;
        margin-top: 2em;
      }
      .cookbook-rustic .dedication-text {
        font-size: 14pt;
        color: #5c4033;
        line-height: 1.8;
        border: 2px solid #d4c4a7;
        padding: 1em;
        background: #fff;
      }
      .cookbook-rustic .toc-title {
        font-size: 22pt;
        color: #5c4033;
        border-bottom: 2px solid #8b7355;
      }
      .cookbook-rustic .toc-section {
        font-size: 12pt;
        color: #6b5344;
        background: #f0ebe3;
        padding: 0.3em 0.5em;
        border: none;
      }
      .cookbook-rustic .toc-entry {
        font-size: 10pt;
      }
      .cookbook-rustic .section-title {
        font-size: 28pt;
        color: #5c4033;
        text-transform: uppercase;
      }
      .cookbook-rustic .recipe-title {
        font-size: 18pt;
        color: #5c4033;
        border-bottom: 2px solid #8b7355;
        padding-bottom: 0.25em;
      }
      .cookbook-rustic .recipe-description {
        color: #6b5344;
        font-size: 10pt;
      }
      .cookbook-rustic .recipe-meta {
        background: #f0ebe3;
        padding: 0.5em;
        border: 1px dashed #c4a77d;
      }
      .cookbook-rustic .recipe-ingredients h4,
      .cookbook-rustic .recipe-instructions h4,
      .cookbook-rustic .recipe-nutrition h4 {
        color: #5c4033;
        font-size: 11pt;
        letter-spacing: 0.1em;
      }
      .cookbook-rustic .recipe-ingredients li {
        border-bottom: 1px dashed #d4c4a7;
        font-size: 10pt;
      }
      .cookbook-rustic .recipe-image {
        border: 3px solid #d4c4a7;
      }
    `,
    minimalist: `
      .cookbook-minimalist {
        font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: #222;
      }
      .cookbook-minimalist .book-title {
        font-size: 28pt;
        font-weight: 300;
        color: #111;
        letter-spacing: 0.02em;
      }
      .cookbook-minimalist .book-subtitle {
        font-size: 12pt;
        font-weight: 300;
        font-style: normal;
        color: #666;
        margin-top: 0.5em;
      }
      .cookbook-minimalist .book-author {
        font-size: 11pt;
        font-weight: 400;
        color: #888;
        margin-top: 1.5em;
      }
      .cookbook-minimalist .dedication-text {
        font-size: 13pt;
        font-weight: 300;
        color: #444;
        line-height: 1.8;
      }
      .cookbook-minimalist .toc-title {
        font-size: 16pt;
        font-weight: 500;
        color: #111;
        text-align: left;
        border-bottom: 1px solid #ddd;
        padding-bottom: 0.5em;
      }
      .cookbook-minimalist .toc-section {
        font-size: 11pt;
        font-weight: 500;
        color: #333;
        border: none;
        margin-top: 1.5em;
      }
      .cookbook-minimalist .toc-entry {
        font-size: 10pt;
        font-weight: 300;
        color: #555;
      }
      .cookbook-minimalist .section-title {
        font-size: 22pt;
        font-weight: 300;
        color: #111;
      }
      .cookbook-minimalist .recipe-title {
        font-size: 16pt;
        font-weight: 500;
        color: #111;
        border: none;
        margin-bottom: 0.25em;
      }
      .cookbook-minimalist .recipe-description {
        font-weight: 300;
        font-style: normal;
        color: #666;
        font-size: 10pt;
      }
      .cookbook-minimalist .recipe-meta {
        border: none;
        border-top: 1px solid #eee;
        border-bottom: 1px solid #eee;
        padding: 0.5em 0;
        gap: 2em;
      }
      .cookbook-minimalist .recipe-meta .meta-item {
        font-size: 9pt;
        font-weight: 400;
        color: #666;
      }
      .cookbook-minimalist .recipe-ingredients h4,
      .cookbook-minimalist .recipe-instructions h4,
      .cookbook-minimalist .recipe-nutrition h4 {
        font-size: 10pt;
        font-weight: 600;
        color: #333;
        letter-spacing: 0.05em;
      }
      .cookbook-minimalist .recipe-ingredients li {
        border: none;
        font-size: 10pt;
        padding: 0.1em 0;
      }
      .cookbook-minimalist .recipe-instructions li {
        font-size: 10pt;
        line-height: 1.6;
      }
      .cookbook-minimalist .recipe-image {
        border: none;
      }
    `
  };

  return baseCSS + (styleVariants[templateStyle] || '');
}

export interface PdfGenerationResult {
  success: boolean;
  pdfBuffer?: Buffer;
  pageCount?: number;
  error?: string;
}

export interface CoverPdfResult {
  success: boolean;
  pdfBuffer?: Buffer;
  error?: string;
}

interface CoverOptions {
  title: string;
  subtitle?: string;
  authorName?: string;
  pageCount: number;
  pageSize: string;
  templateStyle: string;
}

const COVER_PAGE_SIZES: Record<string, { trimWidth: number; trimHeight: number }> = {
  '6x9': { trimWidth: 6, trimHeight: 9 },
  '8.5x11': { trimWidth: 8.5, trimHeight: 11 },
  'a4': { trimWidth: 8.27, trimHeight: 11.69 },
};

const LULU_PAGE_LIMITS = {
  MIN_PAGES: 24,
  MAX_PAGES: 800,
  MIN_SPINE_WIDTH: 0.054, // Minimum spine width for 24 pages (24/444)
};

function calculateCoverDimensions(pageCount: number, pageSize: string) {
  const trim = COVER_PAGE_SIZES[pageSize] || COVER_PAGE_SIZES['6x9'];
  const bleed = 0.125;
  
  // Clamp page count to Lulu's allowed range
  const clampedPageCount = Math.max(LULU_PAGE_LIMITS.MIN_PAGES, Math.min(LULU_PAGE_LIMITS.MAX_PAGES, pageCount));
  
  // Calculate spine width (60# white paper = 444 pages per inch)
  const spineWidth = Math.max(LULU_PAGE_LIMITS.MIN_SPINE_WIDTH, clampedPageCount / 444);
  
  const coverWidth = (trim.trimWidth * 2) + spineWidth + (bleed * 2);
  const coverHeight = trim.trimHeight + (bleed * 2);
  
  return {
    width: coverWidth,
    height: coverHeight,
    spineWidth,
    bleed,
    trimWidth: trim.trimWidth,
    trimHeight: trim.trimHeight,
    actualPageCount: clampedPageCount,
  };
}

function generateCoverHTML(options: CoverOptions): string {
  const dims = calculateCoverDimensions(options.pageCount, options.pageSize);
  const { title, subtitle, authorName, templateStyle } = options;
  
  const backWidth = dims.trimWidth + dims.bleed;
  const frontWidth = dims.trimWidth + dims.bleed;
  const fullHeight = dims.height;
  
  return `
    <div class="cover-wrapper cover-${templateStyle}">
      <div class="back-cover" style="left: 0; width: ${backWidth}in; height: ${fullHeight}in;">
        <div class="back-content">
          <p class="back-tagline">A collection of treasured recipes</p>
        </div>
      </div>
      
      <div class="spine" style="left: ${backWidth}in; width: ${dims.spineWidth}in; height: ${fullHeight}in;">
        <div class="spine-content">
          <span class="spine-title">${escapeHtml(title)}</span>
          ${authorName ? `<span class="spine-author">${escapeHtml(authorName)}</span>` : ''}
        </div>
      </div>
      
      <div class="front-cover" style="left: ${backWidth + dims.spineWidth}in; width: ${frontWidth}in; height: ${fullHeight}in;">
        <div class="front-content">
          <h1 class="cover-title">${escapeHtml(title)}</h1>
          ${subtitle ? `<p class="cover-subtitle">${escapeHtml(subtitle)}</p>` : ''}
          ${authorName ? `<p class="cover-author">by ${escapeHtml(authorName)}</p>` : ''}
        </div>
      </div>
    </div>
  `;
}

function generateCoverCSS(options: CoverOptions): string {
  const dims = calculateCoverDimensions(options.pageCount, options.pageSize);
  
  const styleColors: Record<string, { bg: string; text: string; accent: string }> = {
    classic: { bg: '#f8f4ef', text: '#3d2914', accent: '#8b7355' },
    modern: { bg: '#1a1a1a', text: '#ffffff', accent: '#666666' },
    rustic: { bg: '#d4c4a7', text: '#5c4033', accent: '#8b7355' },
    minimalist: { bg: '#ffffff', text: '#111111', accent: '#888888' },
  };
  
  const colors = styleColors[options.templateStyle] || styleColors.classic;
  
  return `
    @page {
      size: ${dims.width}in ${dims.height}in;
      margin: 0;
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      margin: 0;
      padding: 0;
      background: ${colors.bg};
    }
    
    .cover-wrapper {
      position: relative;
      width: ${dims.width}in;
      height: ${dims.height}in;
      background: ${colors.bg};
      font-family: Georgia, serif;
    }
    
    .back-cover, .spine, .front-cover {
      position: absolute;
      top: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .back-cover {
      background: ${colors.bg};
    }
    
    .back-content {
      text-align: center;
      padding: 1in;
    }
    
    .back-tagline {
      font-size: 14pt;
      font-style: italic;
      color: ${colors.accent};
    }
    
    .spine {
      background: ${colors.accent};
      writing-mode: vertical-rl;
      text-orientation: mixed;
    }
    
    .spine-content {
      display: flex;
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
      height: 100%;
      padding: 0.5in 0;
      color: ${colors.bg};
      font-size: ${Math.max(8, Math.min(12, dims.spineWidth * 40))}pt;
    }
    
    .spine-title {
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    
    .spine-author {
      font-size: 0.8em;
    }
    
    .front-cover {
      background: ${colors.bg};
    }
    
    .front-content {
      text-align: center;
      padding: 1in;
    }
    
    .cover-title {
      font-size: 36pt;
      font-weight: bold;
      color: ${colors.text};
      margin-bottom: 0.5em;
      line-height: 1.2;
    }
    
    .cover-subtitle {
      font-size: 18pt;
      font-style: italic;
      color: ${colors.accent};
      margin-bottom: 1em;
    }
    
    .cover-author {
      font-size: 14pt;
      color: ${colors.text};
      margin-top: 2em;
    }
    
    .cover-classic .cover-title { border-bottom: 2px solid ${colors.accent}; padding-bottom: 0.3em; }
    .cover-modern .cover-title { font-weight: 200; letter-spacing: 0.1em; text-transform: uppercase; }
    .cover-rustic .cover-title { font-family: 'Courier Prime', monospace; }
    .cover-minimalist .cover-title { font-weight: 300; font-size: 28pt; }
  `;
}

export async function generateCoverPdf(options: CoverOptions): Promise<CoverPdfResult> {
  let browser = null;
  
  try {
    const dims = calculateCoverDimensions(options.pageCount, options.pageSize);
    const coverHTML = generateCoverHTML(options);
    const coverCSS = generateCoverCSS(options);
    
    const fullHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Cover - ${escapeHtml(options.title)}</title>
  <style>${coverCSS}</style>
</head>
<body>${coverHTML}</body>
</html>
`;

    const executablePath = findChromiumPath();
    console.log(`[Cover PDF] Using Chromium at: ${executablePath}`);
    
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
        '--disable-software-rasterizer',
      ],
    });

    const page = await browser.newPage();
    await page.setContent(fullHTML, { waitUntil: 'networkidle0', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 1000));

    const pdfBuffer = await page.pdf({
      width: `${dims.width}in`,
      height: `${dims.height}in`,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    await browser.close();

    return {
      success: true,
      pdfBuffer: Buffer.from(pdfBuffer),
    };
  } catch (error) {
    if (browser) await browser.close();
    console.error('Cover PDF generation error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during cover PDF generation',
    };
  }
}

export async function generateCookbookPdf(
  layoutData: PrintLayoutData,
  templateStyle: TemplateStyle,
  recipes: Recipe[]
): Promise<PdfGenerationResult> {
  let browser = null;
  
  try {
    const recipesById = new Map<string, Recipe>();
    recipes.forEach(r => recipesById.set(r.id, r));

    const contentHTML = generatePrintHTML(layoutData, templateStyle, recipesById);
    const pageSize = layoutData.customizations?.pageSize || '6x9';
    const cssContent = generatePrintCSS(templateStyle, pageSize);

    const dimensions = PAGE_SIZE_DIMENSIONS[pageSize as keyof typeof PAGE_SIZE_DIMENSIONS] || PAGE_SIZE_DIMENSIONS['6x9'];

    const fullHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(layoutData.title || 'My Cookbook')}</title>
  <script src="https://unpkg.com/pagedjs@0.5.0-alpha.0/dist/paged.polyfill.min.js"></script>
  <style>
    ${cssContent}
  </style>
</head>
<body>
  ${contentHTML}
</body>
</html>
`;

    const executablePath = findChromiumPath();
    console.log(`[PDF Generation] Using Chromium at: ${executablePath}`);
    
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
        '--disable-software-rasterizer',
      ],
    });

    const page = await browser.newPage();

    await page.setContent(fullHTML, {
      waitUntil: 'networkidle0',
      timeout: 120000,
    });

    await page.waitForFunction(() => {
      return (window as any).PagedPolyfill?.ready || 
             document.querySelector('.pagedjs_pages') !== null;
    }, { timeout: 120000 });

    await new Promise(resolve => setTimeout(resolve, 2000));

    const pageCount = await page.evaluate(() => {
      const pages = document.querySelectorAll('.pagedjs_page');
      return pages.length;
    });

    const pdfBuffer = await page.pdf({
      width: dimensions.width,
      height: dimensions.height,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    await browser.close();

    return {
      success: true,
      pdfBuffer: Buffer.from(pdfBuffer),
      pageCount,
    };
  } catch (error) {
    if (browser) {
      await browser.close();
    }
    
    console.error('PDF generation error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during PDF generation',
    };
  }
}
