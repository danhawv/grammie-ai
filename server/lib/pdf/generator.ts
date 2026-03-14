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

// --- HTML builders ---

function buildInteriorHtml(
  config: BookSizeConfig,
  cookbook: CookbookPrintData
): string {
  const pageCSS = generatePageCSS(config);
  const themeId = cookbook.templateId || 'classic';

  const pages: string[] = [];
  let currentPage = 1;

  // 1. Title page
  pages.push(buildTitlePageHtml(config, cookbook));
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
    pages.push(buildSectionDividerHtml(config, section.title, section.description));
    currentPage++;

    if (currentPage % 2 === 0) {
      pages.push(buildBlankPageHtml(config));
      currentPage++;
    }

    for (const recipe of sectionRecipes) {
      tocEntries.push({ title: recipe.data.title, pageNumber: currentPage, isSection: false });

      const layout = recipe.layoutOverride || 'full-page';
      if (layout === 'two-page-spread') {
        pages.push(buildRecipeSpreadLeftHtml(config, recipe.data));
        currentPage++;
        pages.push(buildRecipeSpreadRightHtml(config, recipe.data, currentPage));
        currentPage++;
      } else {
        pages.push(buildRecipePageHtml(config, recipe.data, currentPage, layout === 'half-page' ? 'text-only' : 'single'));
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
    pages.push(buildRecipePageHtml(config, recipe.data, currentPage, 'single'));
    currentPage++;
  }

  // Ensure even page count (required by Lulu)
  if (pages.length % 2 !== 0) {
    pages.push(buildBlankPageHtml(config));
  }

  // Build TOC
  pages[tocPlaceholderIndex] = buildTocPageHtml(config, 3, tocEntries);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link href="https://fonts.googleapis.com/css2?family=Merriweather:ital,wght@0,300;0,400;0,700;0,900;1,300;1,400&family=Inter:wght@300;400;500;600;700;800&family=Caveat:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,700&family=Source+Serif+Pro:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400&display=swap" rel="stylesheet">
  <style>
    ${pageCSS}
    ${getThemeVars(themeId)}
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

// --- Theme CSS variables ---

function getThemeVars(themeId: string): string {
  const themes: Record<string, string> = {
    classic: `
      :root {
        --heading-font: 'Merriweather', serif;
        --body-font: 'Merriweather', serif;
        --title-color: #2c1810;
        --subtitle-color: #5a3e28;
        --text-color: #333;
        --accent-color: #8b6914;
        --border-color: #d4c5a9;
        --section-bg: #faf8f5;
        --title-size: 36pt;
        --recipe-title-size: 20pt;
        --section-title-size: 28pt;
        --body-size: 9pt;
        --subsection-size: 11pt;
        --image-radius: 4px;
      }`,
    modern: `
      :root {
        --heading-font: 'Inter', sans-serif;
        --body-font: 'Inter', sans-serif;
        --title-color: #1a1a1a;
        --subtitle-color: #666;
        --text-color: #2d2d2d;
        --accent-color: #e85d4a;
        --border-color: #e5e5e5;
        --section-bg: #f7f7f7;
        --title-size: 42pt;
        --recipe-title-size: 22pt;
        --section-title-size: 32pt;
        --body-size: 9pt;
        --subsection-size: 10pt;
        --image-radius: 8px;
      }`,
    rustic: `
      :root {
        --heading-font: 'Caveat', cursive;
        --body-font: 'Lora', serif;
        --title-color: #3e2723;
        --subtitle-color: #6d4c41;
        --text-color: #4e342e;
        --accent-color: #8d6e63;
        --border-color: #bcaaa4;
        --section-bg: #f5f0e8;
        --title-size: 48pt;
        --recipe-title-size: 28pt;
        --section-title-size: 36pt;
        --body-size: 9.5pt;
        --subsection-size: 12pt;
        --image-radius: 0;
      }`,
    elegant: `
      :root {
        --heading-font: 'Playfair Display', serif;
        --body-font: 'Source Serif Pro', serif;
        --title-color: #1b2838;
        --subtitle-color: #546e7a;
        --text-color: #37474f;
        --accent-color: #b8860b;
        --border-color: #cfd8dc;
        --section-bg: #f5f7fa;
        --title-size: 40pt;
        --recipe-title-size: 22pt;
        --section-title-size: 30pt;
        --body-size: 9pt;
        --subsection-size: 10pt;
        --image-radius: 2px;
      }`,
  };
  return themes[themeId] || themes.classic;
}

// --- Page CSS ---

function generatePageCSS(config: BookSizeConfig): string {
  return `
    @page {
      size: ${config.pageWidthWithBleed}in ${config.pageHeightWithBleed}in;
      margin: 0;
    }
    * { box-sizing: border-box; }
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

function buildTitlePageHtml(config: BookSizeConfig, cookbook: CookbookPrintData): string {
  return `<div class="page title-page" style="width:${config.pageWidthWithBleed}in;height:${config.pageHeightWithBleed}in;padding:${config.bleed + config.safetyMargin}in;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;page-break-after:always;">
    <h1 style="font-family:var(--heading-font);font-size:var(--title-size);font-weight:700;color:var(--title-color);line-height:1.2;margin-bottom:0.2in;">${escapeHtml(cookbook.title)}</h1>
    ${cookbook.subtitle ? `<p style="font-family:var(--body-font);font-size:var(--subtitle-size,16pt);color:var(--subtitle-color);font-style:italic;margin-bottom:0.3in;">${escapeHtml(cookbook.subtitle)}</p>` : ''}
    <div style="width:2in;height:1px;background:var(--accent-color);margin:0.2in 0;"></div>
    <p style="font-family:var(--body-font);font-size:14pt;color:var(--text-color);margin-top:0.2in;">${escapeHtml(cookbook.authorName)}</p>
  </div>`;
}

function buildSectionDividerHtml(config: BookSizeConfig, title: string, description?: string): string {
  return `<div class="page section-divider" style="width:${config.pageWidthWithBleed}in;height:${config.pageHeightWithBleed}in;padding:${config.bleed + config.safetyMargin}in;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;page-break-after:always;background:var(--section-bg);">
    <div style="width:1.5in;height:2px;background:var(--accent-color);margin-bottom:0.3in;"></div>
    <h2 style="font-family:var(--heading-font);font-size:var(--section-title-size);font-weight:700;color:var(--title-color);margin-bottom:0.15in;">${escapeHtml(title)}</h2>
    ${description ? `<p style="font-family:var(--body-font);font-size:12pt;color:var(--subtitle-color);font-style:italic;max-width:80%;line-height:1.5;">${escapeHtml(description)}</p>` : ''}
    <div style="width:1.5in;height:2px;background:var(--accent-color);margin-top:0.3in;"></div>
  </div>`;
}

function buildTocPageHtml(
  config: BookSizeConfig,
  pageNumber: number,
  entries: { title: string; pageNumber: number; isSection: boolean }[]
): string {
  const isRecto = pageNumber % 2 === 1;
  const pl = isRecto ? config.gutterMargin + config.safetyMargin : config.safetyMargin;
  const pr = isRecto ? config.safetyMargin : config.gutterMargin + config.safetyMargin;

  const entriesHtml = entries.map((e) => `
    <div style="display:flex;align-items:baseline;margin-bottom:${e.isSection ? '0.15in' : '0.08in'};${e.isSection ? 'margin-top:0.2in;' : ''}">
      <span style="font-family:${e.isSection ? 'var(--heading-font)' : 'var(--body-font)'};font-size:${e.isSection ? '13pt' : '11pt'};font-weight:${e.isSection ? '700' : '400'};color:${e.isSection ? 'var(--title-color)' : 'var(--text-color)'};white-space:nowrap;">${escapeHtml(e.title)}</span>
      <span style="flex:1;border-bottom:${e.isSection ? 'none' : '1px dotted #ccc'};margin:0 0.1in;min-width:0.5in;"></span>
      ${!e.isSection ? `<span style="font-family:var(--body-font);font-size:11pt;color:var(--text-color);">${e.pageNumber}</span>` : ''}
    </div>
  `).join('');

  return `<div class="page" style="width:${config.pageWidthWithBleed}in;height:${config.pageHeightWithBleed}in;padding-top:${config.bleed + config.safetyMargin}in;padding-bottom:${config.bleed + config.safetyMargin}in;padding-left:${config.bleed + pl}in;padding-right:${config.bleed + pr}in;page-break-after:always;">
    <h2 style="font-family:var(--heading-font);font-size:var(--section-title-size,24pt);color:var(--title-color);text-align:center;margin-bottom:0.4in;">Table of Contents</h2>
    ${entriesHtml}
  </div>`;
}

function buildRecipePageHtml(
  config: BookSizeConfig,
  recipe: NormalizedRecipe,
  pageNumber: number,
  layout: 'single' | 'text-only'
): string {
  const isRecto = pageNumber % 2 === 1;
  const pl = isRecto ? config.gutterMargin + config.safetyMargin : config.safetyMargin;
  const pr = isRecto ? config.safetyMargin : config.gutterMargin + config.safetyMargin;
  const showImage = layout !== 'text-only' && recipe.imageUrl;

  const metaItems: string[] = [];
  if (recipe.prepTime) metaItems.push(`<span><small style="text-transform:uppercase;letter-spacing:0.3pt;color:var(--subtitle-color);font-size:7pt;">Prep</small> <strong>${formatTimeHtml(recipe.prepTime)}</strong></span>`);
  if (recipe.cookTime) metaItems.push(`<span><small style="text-transform:uppercase;letter-spacing:0.3pt;color:var(--subtitle-color);font-size:7pt;">Cook</small> <strong>${formatTimeHtml(recipe.cookTime)}</strong></span>`);
  if (recipe.servings) metaItems.push(`<span><small style="text-transform:uppercase;letter-spacing:0.3pt;color:var(--subtitle-color);font-size:7pt;">Serves</small> <strong>${escapeHtml(recipe.servings)}</strong></span>`);

  const ingredientsHtml = recipe.ingredients.map((g) => `
    ${g.heading ? `<p style="font-size:9pt;font-weight:600;margin-bottom:0.02in;">${escapeHtml(g.heading)}</p>` : ''}
    <ul style="margin:0;padding-left:0.12in;list-style:disc;">
      ${g.items.map((item) => `<li style="font-family:var(--body-font);font-size:var(--body-size);line-height:1.4;margin-bottom:0.02in;">${escapeHtml(item)}</li>`).join('')}
    </ul>
  `).join('');

  const instructionsHtml = recipe.instructions.map((s) =>
    `<li style="font-family:var(--body-font);font-size:var(--body-size);line-height:1.5;margin-bottom:0.06in;">${escapeHtml(s.text)}</li>`
  ).join('');

  const notesHtml = recipe.notes && recipe.notes.length > 0 ? `
    <div style="margin-top:0.1in;">
      <h4 style="font-family:var(--heading-font);font-size:9pt;font-weight:700;color:var(--title-color);margin-bottom:0.04in;text-transform:uppercase;letter-spacing:0.5pt;">Notes</h4>
      ${recipe.notes.map((n) => `<p style="font-family:var(--body-font);font-size:8pt;color:var(--subtitle-color);font-style:italic;line-height:1.4;">${escapeHtml(n)}</p>`).join('')}
    </div>` : '';

  return `<div class="page recipe-page" style="width:${config.pageWidthWithBleed}in;height:${config.pageHeightWithBleed}in;padding-top:${config.bleed + config.safetyMargin}in;padding-bottom:${config.bleed + config.safetyMargin}in;padding-left:${config.bleed + pl}in;padding-right:${config.bleed + pr}in;page-break-after:always;position:relative;overflow:hidden;">
    <h2 style="font-family:var(--heading-font);font-size:var(--recipe-title-size);font-weight:700;color:var(--title-color);margin-bottom:0.08in;line-height:1.2;">${escapeHtml(recipe.title)}</h2>
    ${recipe.description ? `<p style="font-family:var(--body-font);font-size:9pt;color:var(--subtitle-color);font-style:italic;margin-bottom:0.1in;line-height:1.4;">${escapeHtml(recipe.description)}</p>` : ''}
    <div style="display:flex;gap:0.2in;margin-bottom:0.12in;padding-bottom:0.08in;border-bottom:1px solid var(--border-color);flex-wrap:wrap;font-family:var(--body-font);font-size:9pt;color:var(--text-color);">
      ${metaItems.join('')}
    </div>
    ${showImage ? `<div style="width:100%;height:35%;margin-bottom:0.12in;overflow:hidden;border-radius:var(--image-radius,4px);"><img src="${recipe.imageUrl}" style="width:100%;height:100%;object-fit:cover;" /></div>` : ''}
    <div style="display:flex;gap:0.15in;">
      <div style="width:35%;min-width:35%;">
        <h3 style="font-family:var(--heading-font);font-size:var(--subsection-size);font-weight:700;color:var(--title-color);margin-bottom:0.06in;text-transform:uppercase;letter-spacing:0.5pt;">Ingredients</h3>
        ${ingredientsHtml}
      </div>
      <div style="flex:1;">
        <h3 style="font-family:var(--heading-font);font-size:var(--subsection-size);font-weight:700;color:var(--title-color);margin-bottom:0.06in;text-transform:uppercase;letter-spacing:0.5pt;">Instructions</h3>
        <ol style="margin:0;padding-left:0.15in;">${instructionsHtml}</ol>
        ${notesHtml}
      </div>
    </div>
    <div style="position:absolute;bottom:${config.bleed + config.safetyMargin * 0.6}in;${isRecto ? `right:${config.bleed + config.safetyMargin}in` : `left:${config.bleed + config.safetyMargin}in`};font-size:9pt;color:#666;">${pageNumber}</div>
  </div>`;
}

function buildRecipeSpreadLeftHtml(config: BookSizeConfig, recipe: NormalizedRecipe): string {
  return `<div class="page recipe-spread-left" style="width:${config.pageWidthWithBleed}in;height:${config.pageHeightWithBleed}in;position:relative;page-break-after:always;overflow:hidden;">
    ${recipe.imageUrl
      ? `<img src="${recipe.imageUrl}" style="width:100%;height:100%;object-fit:cover;" />`
      : `<div style="width:100%;height:100%;background:var(--section-bg);display:flex;align-items:center;justify-content:center;"><span style="font-family:var(--heading-font);font-size:72pt;color:var(--accent-color);opacity:0.15;">${escapeHtml(recipe.title.charAt(0))}</span></div>`
    }
  </div>`;
}

function buildRecipeSpreadRightHtml(config: BookSizeConfig, recipe: NormalizedRecipe, pageNumber: number): string {
  return buildRecipePageHtml(config, recipe, pageNumber, 'text-only');
}

// --- Utilities ---

function formatTimeHtml(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hrs} hr ${mins} min` : `${hrs} hr`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
