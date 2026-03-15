import type { BookSizeConfig, BindingType, PaperType, TrimSize } from '../lulu/types';
import type { NormalizedRecipe } from './types';
import { getBookSizeConfig } from '../lulu/book-sizes';
import { calculateSpineWidth } from '../lulu/spine-calculator';
import { execSync } from 'child_process';
import fs from 'fs';

export type ThemeId = 'classic' | 'modern' | 'rustic' | 'elegant';

export interface CookbookPrintData {
  title: string;
  subtitle?: string;
  authorName: string;
  templateId?: string;
  trimSize: string;
  bindingType: string;
  paperType: string;
  sections: {
    id: string;
    title: string;
    description?: string;
    sortOrder: number;
  }[];
  recipes: {
    sectionId?: string;
    sortOrder: number;
    layoutOverride?: string;
    data: NormalizedRecipe;
  }[];
  coverData?: CoverData;
  customizations?: {
    showNutrition?: boolean;
    showTips?: boolean;
    showVariations?: boolean;
  };
}

export interface CoverData {
  backgroundColor?: string;
  spineText?: string;
  backText?: string;
  frontImageUrl?: string;
}

interface GeneratedPdf {
  buffer: Buffer;
  pageCount: number;
}

// --- Theme configuration matching the preview component exactly ---

interface ThemeConfig {
  bg: string;
  bgCover: string;
  bgBack: string;
  titleFont: string;
  bodyFont: string;
  accent: string;
  accentLight: string;
  accentBorder: string;
  divider: string;
  stepNum: string;
  badgeBg: string;
  badgeText: string;
  tipsBg: string;
  tipsBorder: string;
  tipsTitle: string;
  tipsText: string;
  coverDark: boolean;
  pageNum: string;
}

const THEMES: Record<string, ThemeConfig> = {
  classic: {
    bg: '#fefbf3',
    bgCover: 'linear-gradient(135deg, #fef3c7, #fed7aa, #fef3c7)',
    bgBack: 'linear-gradient(135deg, #f5f5f4, #e7e5e4, #f5f5f4)',
    titleFont: "Georgia, 'Times New Roman', serif",
    bodyFont: "-apple-system, system-ui, sans-serif",
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
    bg: '#ffffff',
    bgCover: 'linear-gradient(135deg, #0f172a, #1e293b, #0f172a)',
    bgBack: 'linear-gradient(135deg, #0f172a, #1e293b, #0f172a)',
    titleFont: "-apple-system, system-ui, 'Segoe UI', sans-serif",
    bodyFont: "-apple-system, system-ui, sans-serif",
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
    bg: '#fefce8',
    bgCover: 'linear-gradient(135deg, #fef9c3, #fde68a, #fef9c3)',
    bgBack: 'linear-gradient(135deg, #fde68a, #fef9c3, #fde68a)',
    titleFont: "Georgia, 'Times New Roman', serif",
    bodyFont: "-apple-system, system-ui, sans-serif",
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
    bg: '#fafaf9',
    bgCover: 'linear-gradient(135deg, #292524, #44403c, #292524)',
    bgBack: 'linear-gradient(135deg, #292524, #44403c, #292524)',
    titleFont: "Georgia, 'Playfair Display', serif",
    bodyFont: "Georgia, serif",
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
};

// --- Chromium path discovery ---

function findChromiumPath(): string {
  // Check environment variable first
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  // Try puppeteer's bundled chromium
  try {
    const puppeteer = require('puppeteer');
    const bundledPath = puppeteer.executablePath();
    if (fs.existsSync(bundledPath)) {
      return bundledPath;
    }
  } catch (e) {
    // Puppeteer bundled chromium not available
  }

  // Common Nix store paths
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

// --- Public API ---

/**
 * Generate the full interior PDF for a cookbook.
 */
export async function generateInteriorPdf(
  cookbookData: CookbookPrintData
): Promise<GeneratedPdf> {
  const puppeteer = await import('puppeteer');

  const config = getBookSizeConfig(
    cookbookData.trimSize as TrimSize,
    cookbookData.bindingType as BindingType
  );

  const html = buildInteriorHtml(config, cookbookData);

  let executablePath: string | undefined;
  try {
    executablePath = findChromiumPath();
  } catch (e) {
    // Let puppeteer use its default
  }

  const browser = await puppeteer.default.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // Auto-fit: scale recipe content to fit within each page
    await page.evaluate(() => {
      const recipeContents = document.querySelectorAll('.recipe-content');
      recipeContents.forEach((el) => {
        const container = el as HTMLElement;
        const pageEl = container.closest('.page') as HTMLElement;
        if (!pageEl) return;

        const availH = parseFloat(container.getAttribute('data-avail-h') || '0');
        if (availH <= 0) return;

        const contentH = container.scrollHeight;
        if (contentH > availH && contentH > 0) {
          const scale = Math.max(0.45, availH / contentH);
          const availW = parseFloat(container.getAttribute('data-avail-w') || String(container.offsetWidth));
          container.style.transform = `scale(${scale})`;
          container.style.transformOrigin = 'top left';
          container.style.width = `${availW / scale}px`;
        }
      });
    });

    const pdfBuffer = await page.pdf({
      width: `${config.pageWidthWithBleed}in`,
      height: `${config.pageHeightWithBleed}in`,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    const pageCount = await page.evaluate(() => {
      return document.querySelectorAll('.page').length;
    });

    return {
      buffer: Buffer.from(pdfBuffer),
      pageCount,
    };
  } finally {
    await browser.close();
  }
}

/**
 * Generate the cover PDF for a cookbook.
 */
export async function generateCoverPdf(
  cookbookData: CookbookPrintData,
  pageCount: number
): Promise<Buffer> {
  const puppeteer = await import('puppeteer');

  const trimSize = cookbookData.trimSize as TrimSize;
  const bindingType = cookbookData.bindingType as BindingType;
  const paperType = cookbookData.paperType as PaperType;

  const config = getBookSizeConfig(trimSize, bindingType);
  const spineWidth = calculateSpineWidth(pageCount, paperType, bindingType);
  const bleed = 0.125;
  const isHardcover = bindingType === 'CW' || bindingType === 'LW';
  const wrap = isHardcover ? 0.75 : 0;

  const coverWidth = (bleed * 2) + (wrap * 2) + (config.trimWidthIn * 2) + spineWidth;
  const coverHeight = (bleed * 2) + (wrap * 2) + config.trimHeightIn;

  const coverData: CoverData = cookbookData.coverData || {};

  const html = buildCoverHtml(
    coverWidth,
    coverHeight,
    config.trimWidthIn,
    spineWidth,
    bleed,
    wrap,
    cookbookData,
    coverData
  );

  let executablePath: string | undefined;
  try {
    executablePath = findChromiumPath();
  } catch (e) {
    // Let puppeteer use its default
  }

  const browser = await puppeteer.default.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      width: `${coverWidth}in`,
      height: `${coverHeight}in`,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

// --- Helpers ---

function hasRecipeExtras(recipe: NormalizedRecipe, customizations?: CookbookPrintData['customizations']): boolean {
  if (!customizations) return false;
  if (customizations.showNutrition && recipe.nutritionInfo &&
      (recipe.nutritionInfo.calories || recipe.nutritionInfo.protein || recipe.nutritionInfo.carbohydrates || recipe.nutritionInfo.fat)) {
    return true;
  }
  if (customizations.showTips && recipe.tips && Array.isArray(recipe.tips) && recipe.tips.length > 0) return true;
  if (customizations.showVariations && recipe.variations && Array.isArray(recipe.variations) && recipe.variations.length > 0) return true;
  return false;
}

// --- HTML builders ---

function buildInteriorHtml(
  config: BookSizeConfig,
  cookbook: CookbookPrintData
): string {
  const pageCSS = generatePageCSS(config);
  const themeId = (cookbook.templateId || 'classic') as ThemeId;
  const theme = THEMES[themeId] || THEMES.classic;

  // Convert page dimensions to pixels (96 DPI for Puppeteer)
  const pageWPx = config.pageWidthWithBleed * 96;
  const pageHPx = config.pageHeightWithBleed * 96;

  const pages: string[] = [];
  let currentPage = 1;

  // 1. Interior cover/title page
  pages.push(buildTitlePageHtml(config, cookbook, theme, pageWPx, pageHPx));
  currentPage++;

  // 2. Blank verso
  pages.push(buildBlankPageHtml(config));
  currentPage++;

  // 3. TOC placeholder
  const tocPlaceholderIndex = pages.length;
  pages.push('');
  currentPage++;

  // Ensure next content starts on recto
  if (currentPage % 2 === 0) {
    pages.push(buildBlankPageHtml(config));
    currentPage++;
  }

  // 4. Recipe pages by section
  interface TocEntry { title: string; pageNumber: number; isSection: boolean }
  const tocEntries: TocEntry[] = [];

  const sortedSections = [...cookbook.sections].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const section of sortedSections) {
    const sectionRecipes = cookbook.recipes
      .filter((r) => r.sectionId === section.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    if (sectionRecipes.length === 0) continue;

    tocEntries.push({ title: section.title, pageNumber: currentPage, isSection: true });
    pages.push(buildSectionDividerHtml(config, section.title, section.description, theme, pageWPx, pageHPx));
    currentPage++;

    if (currentPage % 2 === 0) {
      pages.push(buildBlankPageHtml(config));
      currentPage++;
    }

    for (const recipe of sectionRecipes) {
      tocEntries.push({ title: recipe.data.title, pageNumber: currentPage, isSection: false });

      const layout = recipe.layoutOverride || 'full-page';
      if (layout === 'two-page-spread') {
        pages.push(buildRecipeSpreadLeftHtml(config, recipe.data, theme));
        currentPage++;
        pages.push(buildRecipePageHtml(config, recipe.data, currentPage, 'text-only', theme, pageWPx, pageHPx));
        currentPage++;
      } else {
        pages.push(buildRecipePageHtml(config, recipe.data, currentPage, layout === 'half-page' ? 'text-only' : 'single', theme, pageWPx, pageHPx));
        currentPage++;
      }

      // Extras page if applicable
      if (hasRecipeExtras(recipe.data, cookbook.customizations)) {
        pages.push(buildRecipeExtrasPageHtml(config, recipe.data, currentPage, theme, pageWPx, pageHPx, cookbook.customizations));
        currentPage++;
      }
    }
  }

  // Unsectioned recipes
  const unsectioned = cookbook.recipes
    .filter((r) => !r.sectionId)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  for (const recipe of unsectioned) {
    tocEntries.push({ title: recipe.data.title, pageNumber: currentPage, isSection: false });
    pages.push(buildRecipePageHtml(config, recipe.data, currentPage, 'single', theme, pageWPx, pageHPx));
    currentPage++;

    if (hasRecipeExtras(recipe.data, cookbook.customizations)) {
      pages.push(buildRecipeExtrasPageHtml(config, recipe.data, currentPage, theme, pageWPx, pageHPx, cookbook.customizations));
      currentPage++;
    }
  }

  // Back page
  pages.push(buildBackPageHtml(config, cookbook, theme, pageWPx, pageHPx));
  currentPage++;

  // Ensure even page count (required by Lulu)
  if (pages.length % 2 !== 0) {
    pages.push(buildBlankPageHtml(config));
  }

  // Build TOC
  pages[tocPlaceholderIndex] = buildTocPageHtml(config, 3, tocEntries, theme, pageWPx, pageHPx);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link href="https://fonts.googleapis.com/css2?family=Merriweather:ital,wght@0,300;0,400;0,700;0,900;1,300;1,400&family=Inter:wght@300;400;500;600;700;800&family=Caveat:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,700&family=Source+Serif+Pro:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400&display=swap" rel="stylesheet">
  <style>
    ${pageCSS}
  </style>
</head>
<body>
  ${pages.join('\n')}
</body>
</html>`;
}

function buildCoverHtml(
  totalWidth: number,
  totalHeight: number,
  trimWidth: number,
  spineWidth: number,
  bleed: number,
  wrap: number,
  cookbook: CookbookPrintData,
  coverData: CoverData
): string {
  const backWidth = bleed + wrap + trimWidth;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700;900&family=Inter:wght@400;700;800&family=Playfair+Display:wght@400;700;900&display=swap" rel="stylesheet">
  <style>
    @page { size: ${totalWidth}in ${totalHeight}in; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .cover-spread {
      width: ${totalWidth}in;
      height: ${totalHeight}in;
      position: relative;
      background-color: ${coverData.backgroundColor || '#2c1810'};
      overflow: hidden;
    }
    .back-cover {
      position: absolute;
      left: ${bleed + wrap}in;
      top: ${bleed + wrap}in;
      width: ${trimWidth}in;
      height: ${totalHeight - (bleed + wrap) * 2}in;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 0.5in;
    }
    .spine {
      position: absolute;
      left: ${backWidth}in;
      top: ${bleed + wrap}in;
      width: ${spineWidth}in;
      height: ${totalHeight - (bleed + wrap) * 2}in;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .spine-text {
      transform: rotate(-90deg);
      white-space: nowrap;
      font-family: 'Merriweather', serif;
      font-size: ${spineWidth > 0.5 ? '10pt' : '8pt'};
      color: #fff;
      letter-spacing: 1pt;
    }
    .front-cover {
      position: absolute;
      left: ${backWidth + spineWidth}in;
      top: ${bleed + wrap}in;
      width: ${trimWidth}in;
      height: ${totalHeight - (bleed + wrap) * 2}in;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 0.5in;
    }
    .front-title {
      font-family: 'Merriweather', serif;
      font-size: 32pt;
      font-weight: 900;
      color: #fff;
      text-align: center;
      line-height: 1.2;
      margin-bottom: 0.2in;
    }
    .front-subtitle {
      font-family: 'Merriweather', serif;
      font-size: 14pt;
      color: rgba(255,255,255,0.8);
      text-align: center;
      font-style: italic;
      margin-bottom: 0.3in;
    }
    .front-author {
      font-family: 'Merriweather', serif;
      font-size: 12pt;
      color: rgba(255,255,255,0.9);
      text-align: center;
    }
    .back-text {
      font-family: 'Merriweather', serif;
      font-size: 10pt;
      color: rgba(255,255,255,0.8);
      text-align: center;
      line-height: 1.6;
      max-width: 80%;
    }
  </style>
</head>
<body>
  <div class="cover-spread">
    ${coverData.frontImageUrl
      ? `<img src="${coverData.frontImageUrl}" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;opacity:0.3;" />`
      : ''
    }
    <div class="back-cover">
      ${coverData.backText ? `<p class="back-text">${escapeHtml(coverData.backText)}</p>` : ''}
    </div>
    <div class="spine">
      ${spineWidth > 0.3
        ? `<span class="spine-text">${escapeHtml(coverData.spineText || cookbook.title)}</span>`
        : ''
      }
    </div>
    <div class="front-cover">
      <h1 class="front-title">${escapeHtml(cookbook.title)}</h1>
      ${cookbook.subtitle ? `<p class="front-subtitle">${escapeHtml(cookbook.subtitle)}</p>` : ''}
      <div style="width:1.5in;height:1px;background:rgba(255,255,255,0.4);margin:0.15in 0;"></div>
      <p class="front-author">${escapeHtml(cookbook.authorName)}</p>
    </div>
  </div>
</body>
</html>`;
}

// --- Page CSS ---

function generatePageCSS(config: BookSizeConfig): string {
  return `
    @page {
      size: ${config.pageWidthWithBleed}in ${config.pageHeightWithBleed}in;
      margin: 0;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      width: ${config.pageWidthWithBleed}in;
      height: ${config.pageHeightWithBleed}in;
      position: relative;
      overflow: hidden;
      page-break-after: always;
    }
    .page:last-child {
      page-break-after: auto;
    }
    @media print {
      .page { page-break-after: always; }
      .page:last-child { page-break-after: auto; }
    }
  `;
}

// --- Individual page HTML builders ---

function buildBlankPageHtml(config: BookSizeConfig): string {
  return `<div class="page" style="width:${config.pageWidthWithBleed}in;height:${config.pageHeightWithBleed}in;page-break-after:always;"></div>`;
}

// --- Interior title page (matches preview CoverPage) ---

function buildTitlePageHtml(
  config: BookSizeConfig,
  cookbook: CookbookPrintData,
  theme: ThemeConfig,
  pageWPx: number,
  pageHPx: number
): string {
  const isDark = theme.coverDark;
  const titleSize = Math.min(36, pageWPx * 0.06);
  const subSize = Math.min(16, pageWPx * 0.025);
  const authorSize = Math.min(14, pageWPx * 0.022);
  const countSize = Math.min(12, pageWPx * 0.018);
  const m = 0.5 * 96; // margin in px equivalent

  const coverImageUrl = cookbook.coverData?.frontImageUrl;

  // BookOpen SVG icon for when there's no image
  const bookOpenSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.min(48, pageWPx * 0.1)}" height="${Math.min(48, pageWPx * 0.1)}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;

  return `<div class="page" style="width:${config.pageWidthWithBleed}in;height:${config.pageHeightWithBleed}in;background:${theme.bgCover};display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:${m / 96}in;position:relative;overflow:hidden;page-break-after:always;">
    <!-- Accent bars -->
    <div style="position:absolute;top:0;left:0;right:0;height:6px;background:${theme.divider};"></div>
    <div style="position:absolute;bottom:0;left:0;right:0;height:6px;background:${theme.divider};"></div>
    <!-- Border frame -->
    <div style="position:absolute;top:${m * 0.4 / 96}in;left:${m * 0.5 / 96}in;right:${m * 0.5 / 96}in;bottom:${m * 0.4 / 96}in;border:2px solid ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)'};border-radius:8px;pointer-events:none;"></div>

    ${coverImageUrl
      ? `<img src="${coverImageUrl}" style="width:${Math.min(120, pageWPx * 0.25)}px;height:${Math.min(120, pageWPx * 0.25)}px;border-radius:50%;object-fit:cover;margin-bottom:16px;box-shadow:0 8px 24px rgba(0,0,0,0.2);border:3px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)'};" />`
      : `<div style="width:${Math.min(96, pageWPx * 0.2)}px;height:${Math.min(96, pageWPx * 0.2)}px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${isDark ? 'rgba(255,255,255,0.1)' : theme.accent};margin-bottom:16px;box-shadow:0 8px 24px rgba(0,0,0,0.15);">${bookOpenSvg}</div>`
    }

    <h1 style="font-family:${theme.titleFont};font-weight:700;font-size:${titleSize}px;color:${isDark ? '#fff' : '#292524'};line-height:1.2;margin-bottom:8px;">${escapeHtml(cookbook.title)}</h1>
    ${cookbook.subtitle ? `<p style="font-style:italic;font-size:${subSize}px;max-width:70%;color:${isDark ? 'rgba(255,255,255,0.7)' : '#57534e'};margin-bottom:16px;">${escapeHtml(cookbook.subtitle)}</p>` : ''}

    <div style="margin-top:auto;">
      <p style="font-size:${authorSize}px;font-weight:500;text-transform:uppercase;letter-spacing:0.1em;color:${isDark ? 'rgba(255,255,255,0.5)' : '#78716c'};">by ${escapeHtml(cookbook.authorName)}</p>
      <p style="font-size:${countSize}px;margin-top:4px;color:${isDark ? 'rgba(255,255,255,0.3)' : '#a8a29e'};">${cookbook.recipes.length} recipe${cookbook.recipes.length !== 1 ? 's' : ''}</p>
    </div>
  </div>`;
}

// --- Section divider (matches preview SectionDividerPage) ---

function buildSectionDividerHtml(
  config: BookSizeConfig,
  title: string,
  description: string | undefined,
  theme: ThemeConfig,
  pageWPx: number,
  _pageHPx: number
): string {
  const titleSize = Math.min(30, pageWPx * 0.05);

  return `<div class="page section-divider" style="width:${config.pageWidthWithBleed}in;height:${config.pageHeightWithBleed}in;background:${theme.bg};display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;page-break-after:always;">
    <div style="width:60px;height:2px;background:${theme.divider};margin-bottom:16px;"></div>
    <h2 style="font-family:${theme.titleFont};font-weight:700;font-size:${titleSize}px;color:#292524;">${escapeHtml(title)}</h2>
    ${description ? `<p style="font-size:12pt;color:#57534e;font-style:italic;max-width:80%;line-height:1.5;margin-top:8px;">${escapeHtml(description)}</p>` : ''}
    <div style="width:60px;height:2px;background:${theme.divider};margin-top:16px;"></div>
  </div>`;
}

// --- TOC page (matches preview TocPage) ---

function buildTocPageHtml(
  config: BookSizeConfig,
  pageNumber: number,
  entries: { title: string; pageNumber: number; isSection: boolean }[],
  theme: ThemeConfig,
  pageWPx: number,
  _pageHPx: number
): string {
  const isRecto = pageNumber % 2 === 1;
  const pl = isRecto ? config.gutterMargin + config.safetyMargin : config.safetyMargin;
  const pr = isRecto ? config.safetyMargin : config.gutterMargin + config.safetyMargin;

  const titleSize = Math.min(22, pageWPx * 0.038);
  const itemSize = Math.min(13, pageWPx * 0.021);
  const numSize = Math.min(11, pageWPx * 0.017);

  const entriesHtml = entries.map((e) => `
    <div style="display:flex;width:100%;align-items:baseline;gap:6px;padding:3px 6px;${e.isSection ? 'margin-top:12px;' : ''}">
      ${!e.isSection ? `<span style="font-size:${numSize}px;color:#a8a29e;font-family:monospace;width:2em;flex-shrink:0;">${e.pageNumber}</span>` : ''}
      <span style="font-size:${e.isSection ? itemSize + 2 : itemSize}px;font-weight:${e.isSection ? '700' : '400'};color:${e.isSection ? '#292524' : '#44403c'};flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(e.title)}</span>
      ${!e.isSection ? `<span style="font-size:${numSize}px;color:#a8a29e;flex-shrink:0;">p.${e.pageNumber}</span>` : ''}
    </div>
  `).join('');

  return `<div class="page" style="width:${config.pageWidthWithBleed}in;height:${config.pageHeightWithBleed}in;background:${theme.bg};padding-top:${config.bleed + config.safetyMargin}in;padding-bottom:${config.bleed + config.safetyMargin}in;padding-left:${config.bleed + pl}in;padding-right:${config.bleed + pr}in;page-break-after:always;">
    <div style="text-align:center;margin-bottom:12px;">
      <h2 style="font-family:${theme.titleFont};font-weight:700;font-size:${titleSize}px;color:#292524;margin-bottom:4px;">Table of Contents</h2>
      <div style="width:48px;height:2px;background:${theme.divider};margin:0 auto;"></div>
    </div>
    ${entriesHtml}
  </div>`;
}

// --- Recipe page (matches preview RecipePage) ---

function buildRecipePageHtml(
  config: BookSizeConfig,
  recipe: NormalizedRecipe,
  pageNumber: number,
  layout: 'single' | 'text-only',
  theme: ThemeConfig,
  pageWPx: number,
  pageHPx: number
): string {
  const isRecto = pageNumber % 2 === 1;
  const padLeft = (isRecto ? config.gutterMargin + config.safetyMargin : config.safetyMargin) + config.bleed;
  const padRight = (isRecto ? config.safetyMargin : config.gutterMargin + config.safetyMargin) + config.bleed;
  const padTop = config.bleed + config.safetyMargin;
  const padBottom = config.bleed + config.safetyMargin;

  const showImage = layout !== 'text-only' && recipe.imageUrl;
  const imageHeightPct = showImage ? 30 : 0; // 30% of page height for image

  // Dynamic font sizes based on page width
  const titleSize = Math.min(20, pageWPx * 0.035);
  const bodySize = Math.min(11.5, pageWPx * 0.019);
  const labelSize = Math.min(10, pageWPx * 0.016);
  const pageNumSize = Math.min(9, pageWPx * 0.014);

  // Compute available content area in inches for auto-fit
  const contentTopIn = showImage ? padTop + (config.pageHeightWithBleed * imageHeightPct / 100) * 0.3 : padTop;
  const availHIn = config.pageHeightWithBleed - contentTopIn - padBottom;
  const availWIn = config.pageWidthWithBleed - padLeft - padRight;
  const availHPx = availHIn * 96;
  const availWPx = availWIn * 96;

  // Build image header HTML
  let imageHtml = '';
  if (showImage) {
    imageHtml = `
      <div style="position:relative;width:100%;height:${imageHeightPct}%;overflow:hidden;">
        <img src="${recipe.imageUrl}" style="width:100%;height:100%;object-fit:cover;display:block;" />
        <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 60%);"></div>
        <div style="position:absolute;bottom:0;left:0;right:0;padding:12px ${padRight}in 10px ${padLeft}in;">
          <h2 style="font-family:${theme.titleFont};font-weight:700;font-size:${titleSize}px;color:#fff;line-height:1.2;text-shadow:0 1px 3px rgba(0,0,0,0.3);">${escapeHtml(recipe.title)}</h2>
        </div>
      </div>`;
  }

  // Title (when no image)
  const titleHtml = !showImage ? `
    <div style="margin-bottom:6px;">
      <h2 style="font-family:${theme.titleFont};font-weight:700;font-size:${titleSize}px;color:#292524;line-height:1.2;">${escapeHtml(recipe.title)}</h2>
      <div style="width:40px;height:2px;background:${theme.divider};margin-top:4px;"></div>
    </div>` : '';

  // Badges
  const badges: string[] = [];
  if (recipe.prepTime) {
    badges.push(`<span style="font-size:${labelSize}px;background:${theme.badgeBg};color:${theme.badgeText};padding:2px 8px;border-radius:12px;">Prep: ${formatTimeHtml(recipe.prepTime)}</span>`);
  }
  if (recipe.cookTime) {
    badges.push(`<span style="font-size:${labelSize}px;background:${theme.badgeBg};color:${theme.badgeText};padding:2px 8px;border-radius:12px;">Cook: ${formatTimeHtml(recipe.cookTime)}</span>`);
  }
  if (recipe.servings) {
    badges.push(`<span style="font-size:${labelSize}px;background:#f5f5f4;color:#57534e;padding:2px 8px;border-radius:12px;">Serves ${escapeHtml(recipe.servings)}</span>`);
  }

  // Description
  const descHtml = recipe.description ? `<p style="font-size:${bodySize * 0.9}px;color:#57534e;font-style:italic;line-height:1.35;margin-bottom:6px;">${escapeHtml(recipe.description)}</p>` : '';

  // Ingredients column
  const ingredientsItems = recipe.ingredients.map((g) => {
    const headingHtml = g.heading ? `<p style="font-size:${bodySize}px;font-weight:600;color:#1c1917;margin-bottom:1px;margin-top:4px;">${escapeHtml(g.heading)}</p>` : '';
    const itemsHtml = g.items.map((item) =>
      `<div style="font-size:${bodySize}px;color:#44403c;line-height:1.35;margin-bottom:1px;">${escapeHtml(item)}</div>`
    ).join('');
    return headingHtml + itemsHtml;
  }).join('');

  // Instructions column with colored step numbers
  const instructionsHtml = recipe.instructions.map((s, idx) =>
    `<div style="font-size:${bodySize}px;color:#44403c;display:flex;gap:5px;line-height:1.4;margin-bottom:3px;">
      <span style="font-weight:700;color:${theme.stepNum};flex-shrink:0;">${idx + 1}.</span>
      <span>${escapeHtml(s.text)}</span>
    </div>`
  ).join('');

  return `<div class="page recipe-page" style="width:${config.pageWidthWithBleed}in;height:${config.pageHeightWithBleed}in;background:${theme.bg};overflow:hidden;position:relative;page-break-after:always;">
    ${imageHtml}
    <!-- Auto-fit content area -->
    <div class="recipe-content" data-avail-h="${availHPx}" data-avail-w="${availWPx}" style="position:absolute;top:${showImage ? imageHeightPct + '%' : padTop + 'in'};left:${padLeft}in;width:${availWIn}in;">
      ${titleHtml}
      <!-- Badges -->
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;">
        ${badges.join('')}
      </div>
      ${descHtml}
      <!-- Two-column grid: ingredients + instructions -->
      <div style="display:grid;grid-template-columns:1fr 1.6fr;gap:12px;">
        <div>
          <h3 style="font-size:${labelSize}px;font-weight:700;color:#292524;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Ingredients</h3>
          ${ingredientsItems}
        </div>
        <div>
          <h3 style="font-size:${labelSize}px;font-weight:700;color:#292524;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Instructions</h3>
          ${instructionsHtml}
        </div>
      </div>
      <!-- Page number -->
      <div style="text-align:center;font-size:${pageNumSize}px;color:${theme.pageNum};margin-top:8px;padding-top:4px;">${pageNumber}</div>
    </div>
  </div>`;
}

// --- Recipe spread left page (image only) ---

function buildRecipeSpreadLeftHtml(config: BookSizeConfig, recipe: NormalizedRecipe, theme: ThemeConfig): string {
  return `<div class="page recipe-spread-left" style="width:${config.pageWidthWithBleed}in;height:${config.pageHeightWithBleed}in;position:relative;page-break-after:always;overflow:hidden;">
    ${recipe.imageUrl
      ? `<img src="${recipe.imageUrl}" style="width:100%;height:100%;object-fit:cover;" />`
      : `<div style="width:100%;height:100%;background:${theme.bg};display:flex;align-items:center;justify-content:center;"><span style="font-family:${theme.titleFont};font-size:72pt;color:${theme.accent};opacity:0.15;">${escapeHtml(recipe.title.charAt(0))}</span></div>`
    }
  </div>`;
}

// --- Recipe extras page (matches preview RecipeExtrasPage) ---

function buildRecipeExtrasPageHtml(
  config: BookSizeConfig,
  recipe: NormalizedRecipe,
  pageNumber: number,
  theme: ThemeConfig,
  pageWPx: number,
  _pageHPx: number,
  customizations?: CookbookPrintData['customizations']
): string {
  const isRecto = pageNumber % 2 === 1;
  const padLeft = (isRecto ? config.gutterMargin + config.safetyMargin : config.safetyMargin) + config.bleed;
  const padRight = (isRecto ? config.safetyMargin : config.gutterMargin + config.safetyMargin) + config.bleed;
  const padTop = config.bleed + config.safetyMargin;
  const padBottom = config.bleed + config.safetyMargin;
  const availWIn = config.pageWidthWithBleed - padLeft - padRight;
  const availHIn = config.pageHeightWithBleed - padTop - padBottom;

  const titleSize = Math.min(16, pageWPx * 0.028);
  const bodySize = Math.min(12, pageWPx * 0.02);
  const labelSize = Math.min(10, pageWPx * 0.016);
  const pageNumSize = Math.min(9, pageWPx * 0.014);

  const showNutrition = customizations?.showNutrition ?? false;
  const showTips = customizations?.showTips ?? false;
  const showVariations = customizations?.showVariations ?? false;

  const hasNutrition = showNutrition && recipe.nutritionInfo &&
    (recipe.nutritionInfo.calories || recipe.nutritionInfo.protein || recipe.nutritionInfo.carbohydrates || recipe.nutritionInfo.fat);
  const hasTips = showTips && recipe.tips && Array.isArray(recipe.tips) && recipe.tips.length > 0;
  const hasVariations = showVariations && recipe.variations && Array.isArray(recipe.variations) && recipe.variations.length > 0;

  // Nutrition grid
  let nutritionHtml = '';
  if (hasNutrition && recipe.nutritionInfo) {
    const ni = recipe.nutritionInfo;
    const items = [
      { label: 'Calories', value: ni.calories, unit: '' },
      { label: 'Protein', value: ni.protein, unit: 'g' },
      { label: 'Carbs', value: ni.carbohydrates, unit: 'g' },
      { label: 'Fat', value: ni.fat, unit: 'g' },
    ].filter(i => i.value != null);

    const gridItems = items.map(({ label, value, unit }) => `
      <div style="text-align:center;padding:8px 4px;background:${theme.accentLight};border-radius:8px;border:1px solid ${theme.accentBorder};">
        <div style="font-size:${bodySize * 1.4}px;font-weight:700;color:${theme.accent};">${typeof value === 'number' ? Math.round(value) : value}${unit}</div>
        <div style="font-size:${labelSize}px;color:#78716c;margin-top:2px;">${label}</div>
      </div>
    `).join('');

    const fiberHtml = ni.fiber ? `<p style="font-size:${labelSize}px;color:#78716c;margin-top:4px;">Fiber: ${Math.round(parseFloat(ni.fiber))}g per serving</p>` : '';

    nutritionHtml = `
      <div style="margin-bottom:16px;">
        <h3 style="font-size:${labelSize}px;font-weight:700;color:${theme.tipsTitle};text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Nutrition per Serving</h3>
        <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:8px;">${gridItems}</div>
        ${fiberHtml}
      </div>`;
  }

  // Tips box
  let tipsHtml = '';
  if (hasTips && recipe.tips) {
    const tipItems = (recipe.tips as any[]).map((tip: any, idx: number) =>
      `<p style="font-size:${bodySize}px;color:${theme.tipsText};line-height:1.5;margin-bottom:${idx < (recipe.tips as any[]).length - 1 ? '6px' : '0'};">&bull; ${typeof tip === 'string' ? escapeHtml(tip) : escapeHtml(tip.text || '')}</p>`
    ).join('');

    tipsHtml = `
      <div style="margin-bottom:16px;padding:12px;border-radius:8px;background:${theme.tipsBg};border:1px solid ${theme.tipsBorder};">
        <h3 style="font-size:${labelSize}px;font-weight:700;color:${theme.tipsTitle};text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Chef&#39;s Tips</h3>
        ${tipItems}
      </div>`;
  }

  // Variations
  let variationsHtml = '';
  if (hasVariations && recipe.variations) {
    const varItems = (recipe.variations as any[]).map((v: any) =>
      `<div style="margin-bottom:6px;">
        <p style="font-size:${bodySize}px;font-weight:600;color:#292524;">${escapeHtml(v.title || '')}</p>
        <p style="font-size:${bodySize * 0.9}px;color:#57534e;line-height:1.4;">${escapeHtml(v.description || '')}</p>
      </div>`
    ).join('');

    variationsHtml = `
      <div style="margin-bottom:16px;">
        <h3 style="font-size:${labelSize}px;font-weight:700;color:${theme.tipsTitle};text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Variations</h3>
        ${varItems}
      </div>`;
  }

  return `<div class="page recipe-extras-page" style="width:${config.pageWidthWithBleed}in;height:${config.pageHeightWithBleed}in;background:${theme.bg};overflow:hidden;position:relative;page-break-after:always;">
    <div class="recipe-content" data-avail-h="${availHIn * 96}" data-avail-w="${availWIn * 96}" style="position:absolute;top:${padTop}in;left:${padLeft}in;width:${availWIn}in;">
      <!-- Header -->
      <div style="margin-bottom:16px;border-bottom:1px solid ${theme.accentBorder};padding-bottom:8px;">
        <p style="font-size:${labelSize}px;color:#78716c;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">Additional Info</p>
        <h2 style="font-family:${theme.titleFont};font-weight:700;font-size:${titleSize}px;color:#292524;">${escapeHtml(recipe.title)}</h2>
      </div>
      ${nutritionHtml}
      ${tipsHtml}
      ${variationsHtml}
      <!-- Page number -->
      <div style="text-align:center;font-size:${pageNumSize}px;color:${theme.pageNum};margin-top:8px;padding-top:4px;">${pageNumber} (continued)</div>
    </div>
  </div>`;
}

// --- Back page (matches preview BackPage) ---

function buildBackPageHtml(
  config: BookSizeConfig,
  cookbook: CookbookPrintData,
  theme: ThemeConfig,
  pageWPx: number,
  _pageHPx: number
): string {
  const isDark = theme.coverDark;
  const m = 0.5; // margin in inches

  const bookOpenSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.min(64, pageWPx * 0.12)}" height="${Math.min(64, pageWPx * 0.12)}" viewBox="0 0 24 24" fill="none" stroke="${isDark ? 'rgba(255,255,255,0.15)' : '#d6d3d1'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;

  return `<div class="page back-page" style="width:${config.pageWidthWithBleed}in;height:${config.pageHeightWithBleed}in;background:${theme.bgBack};display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:${m}in;position:relative;page-break-after:always;">
    <div style="position:absolute;top:0;left:0;right:0;height:6px;background:${theme.divider};"></div>
    <div style="position:absolute;bottom:0;left:0;right:0;height:6px;background:${theme.divider};"></div>

    <div style="margin-bottom:16px;">${bookOpenSvg}</div>
    <h2 style="font-family:${theme.titleFont};font-weight:700;margin-bottom:8px;font-size:${Math.min(24, pageWPx * 0.04)}px;color:${isDark ? '#fff' : '#44403c'};">${escapeHtml(cookbook.title)}</h2>

    ${cookbook.coverData?.backText ? `<p style="font-style:italic;max-width:80%;margin-bottom:24px;font-size:${Math.min(14, pageWPx * 0.022)}px;color:${isDark ? 'rgba(255,255,255,0.5)' : '#78716c'};">${escapeHtml(cookbook.coverData.backText)}</p>` : ''}

    <p style="margin-top:auto;font-size:${Math.min(11, pageWPx * 0.018)}px;color:${isDark ? 'rgba(255,255,255,0.25)' : '#a8a29e'};">Made with Grammie</p>
  </div>`;
}

// --- Utilities ---

function formatTimeHtml(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
