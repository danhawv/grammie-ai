import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  Ruler, Loader2,
} from "lucide-react";
import type { PrintLayoutData } from "@shared/schema";
import { BOOK_SIZES, type TrimSizeId } from "@/lib/print-constants";
import { Previewer } from "pagedjs";

// --- Constants ---
const DPI = 96;
const BLEED = 0.125;
const MARGIN_OUTER = 0.5;
const MARGIN_INNER = 0.75;
const MARGIN_TOP = 0.5;
const MARGIN_BOTTOM = 0.5;
const SAFE_ZONE = 0.25;

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

// Theme configurations
const THEMES = {
  classic: {
    coverBg: "#fef3c7",
    coverAccent: "#f59e0b",
    pageBg: "#fffbeb",
    sectionBg: "#fef3c7",
    titleFont: "'Georgia', serif",
    bodyFont: "'Georgia', serif",
    titleColor: "#292524",
    subtitleColor: "#57534e",
    bodyColor: "#44403c",
    accentColor: "#ea580c",
    mutedColor: "#78716c",
    lightColor: "#a8a29e",
    badgeBg: "#fff7ed",
    badgeColor: "#c2410c",
    tipBg: "#fffbeb",
    tipBorder: "#fde68a",
    tipColor: "#92400e",
    dividerColor: "#f59e0b",
    sectionDecor: "&#10022;", // ✦
    borderStyle: "2px solid rgba(245, 158, 11, 0.3)",
    headingDecor: "~",
  },
  modern: {
    coverBg: "#f9fafb",
    coverAccent: "#111827",
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
    sectionDecor: "&mdash;",
    borderStyle: "1px solid #e5e7eb",
    headingDecor: "|",
  },
  rustic: {
    coverBg: "#fef3c7",
    coverAccent: "#92400e",
    pageBg: "#fefce8",
    sectionBg: "#fef9c3",
    titleFont: "'Georgia', 'Cambria', serif",
    bodyFont: "'Georgia', serif",
    titleColor: "#78350f",
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
    sectionDecor: "&#10087;", // ❧
    borderStyle: "2px solid rgba(180, 83, 9, 0.3)",
    headingDecor: "~",
  },
  elegant: {
    coverBg: "#f8fafc",
    coverAccent: "#475569",
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
    sectionDecor: "&#9670;", // ◆
    borderStyle: "1px solid #e2e8f0",
    headingDecor: ".",
  },
};

type ThemeConfig = typeof THEMES.classic;

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
    0.25: "&#188;", 0.33: "&#8531;", 0.5: "&#189;", 0.66: "&#8532;", 0.75: "&#190;",
    0.125: "&#8539;", 0.375: "&#8540;", 0.625: "&#8541;", 0.875: "&#8542;",
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// --- HTML Content Generators ---

function generateCoverHtml(layoutData: PrintLayoutData, theme: ThemeConfig, recipeCount: number): string {
  return `
    <section class="page-cover">
      <div class="cover-accent-top"></div>
      <div class="cover-accent-bottom"></div>
      <div class="cover-border"></div>
      <div class="cover-content">
        <div class="cover-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
          </svg>
        </div>
        <h1 class="cover-title">${escapeHtml(layoutData.title || "My Cookbook")}</h1>
        ${layoutData.subtitle ? `<p class="cover-subtitle">${escapeHtml(layoutData.subtitle)}</p>` : ''}
        <div class="cover-footer">
          ${layoutData.authorName ? `<p class="cover-author">by ${escapeHtml(layoutData.authorName)}</p>` : ''}
          <p class="cover-recipe-count">${recipeCount} recipe${recipeCount !== 1 ? "s" : ""}</p>
        </div>
      </div>
    </section>
  `;
}

function generateDedicationHtml(layoutData: PrintLayoutData, theme: ThemeConfig): string {
  if (!layoutData.dedication) return '';
  return `
    <section class="page-dedication">
      <div class="dedication-content">
        <p class="dedication-text">${escapeHtml(layoutData.dedication)}</p>
      </div>
    </section>
  `;
}

function generateTocHtml(
  sections: PrintLayoutData["sections"],
  recipesById: Map<string, Recipe>,
  theme: ThemeConfig
): string {
  let globalIdx = 0;
  let tocItems = '';

  sections.forEach((section, sIdx) => {
    if (sections.length > 1) {
      tocItems += `<div class="toc-section-title">${escapeHtml(section.title)}</div>`;
    }
    section.recipeIds.forEach((id) => {
      const recipe = recipesById.get(String(id));
      if (!recipe) return;
      const idx = globalIdx++;
      const time = formatTime(recipe.totalTimeMinutes || recipe.cookTimeMinutes);
      tocItems += `
        <div class="toc-entry">
          <span class="toc-number">${idx + 1}</span>
          <span class="toc-title">${escapeHtml(recipe.title)}</span>
          <span class="toc-dots"></span>
          ${time ? `<span class="toc-time">${time}</span>` : ''}
        </div>
      `;
    });
  });

  return `
    <section class="page-toc">
      <h2 class="toc-heading">Table of Contents</h2>
      <div class="toc-divider"></div>
      <div class="toc-list">
        ${tocItems}
      </div>
    </section>
  `;
}

function generateSectionDividerHtml(title: string, theme: ThemeConfig): string {
  return `
    <section class="page-section-divider">
      <div class="section-decor">${theme.sectionDecor}</div>
      <h2 class="section-title">${escapeHtml(title)}</h2>
      <div class="section-rule"></div>
    </section>
  `;
}

function generateRecipeHtml(recipe: Recipe, index: number, theme: ThemeConfig, pageWidthIn: number): string {
  const ingredients = recipe.normalizedIngredients ||
    (recipe.ingredients || []).map((raw: any) =>
      typeof raw === "string" ? { raw, item: raw } : raw
    );
  const instructions = recipe.normalizedInstructions ||
    (recipe.instructions || []).map((text: any, i: number) =>
      typeof text === "string" ? { stepNumber: i + 1, text } : text
    );

  const imgSrc = recipe.dishImageThumbnail || recipe.dishImage;
  const useColumns = pageWidthIn >= 5.5;

  let imageSection = '';
  if (imgSrc) {
    imageSection = `
      <div class="recipe-hero">
        <img src="${imgSrc}" alt="${escapeHtml(recipe.title)}" class="recipe-hero-img" />
        <div class="recipe-hero-gradient"></div>
        <div class="recipe-hero-title-overlay">
          <h2 class="recipe-title recipe-title-on-image">${escapeHtml(recipe.title)}</h2>
        </div>
      </div>
    `;
  }

  let titleSection = '';
  if (!imgSrc) {
    titleSection = `
      <div class="recipe-title-block">
        <h2 class="recipe-title">${escapeHtml(recipe.title)}</h2>
        <div class="recipe-title-rule"></div>
      </div>
    `;
  }

  // Time badges
  let badges = '';
  if (recipe.prepTimeMinutes || recipe.cookTimeMinutes || recipe.servings) {
    let badgeItems = '';
    if (recipe.prepTimeMinutes) {
      badgeItems += `<span class="recipe-badge">Prep: ${formatTime(recipe.prepTimeMinutes)}</span>`;
    }
    if (recipe.cookTimeMinutes) {
      badgeItems += `<span class="recipe-badge">Cook: ${formatTime(recipe.cookTimeMinutes)}</span>`;
    }
    if (recipe.servings) {
      badgeItems += `<span class="recipe-badge recipe-badge-muted">Serves ${recipe.servings}</span>`;
    }
    badges = `<div class="recipe-badges">${badgeItems}</div>`;
  }

  // Description
  let descSection = '';
  if (recipe.description) {
    descSection = `<p class="recipe-description">${escapeHtml(recipe.description)}</p>`;
  }

  // Ingredients
  let ingredientItems = ingredients.map((ing: any) => {
    const qStr = formatQuantity(ing.quantity, ing.unit);
    const itemName = escapeHtml(ing.item || ing.name || ing.raw || "");
    const prep = ing.preparation ? `<span class="ingredient-prep">, ${escapeHtml(ing.preparation)}</span>` : '';
    return `<li class="ingredient-item">${qStr ? `<span class="ingredient-qty">${qStr}</span> ` : ''}${itemName}${prep}</li>`;
  }).join('\n');

  // Instructions
  let instructionItems = instructions.map((step: any, idx: number) => {
    const text = typeof step === "string" ? step : (step.text || step.instruction || "");
    return `<li class="instruction-item"><span class="step-number">${idx + 1}.</span> <span class="step-text">${escapeHtml(text)}</span></li>`;
  }).join('\n');

  // Tips
  let tipsSection = '';
  if (recipe.tips && (recipe.tips as any[]).length > 0) {
    const tipItems = (recipe.tips as any[]).map((tip: any) => {
      const text = typeof tip === "string" ? tip : (tip.text || "");
      return `<p class="tip-text">${escapeHtml(text)}</p>`;
    }).join('\n');
    tipsSection = `
      <div class="recipe-tips">
        <h4 class="tips-heading">Tips</h4>
        ${tipItems}
      </div>
    `;
  }

  return `
    <section class="recipe-page">
      ${imageSection}
      ${titleSection}
      ${badges}
      ${descSection}
      <div class="recipe-body ${useColumns ? 'recipe-body-columns' : ''}">
        <div class="ingredients-column">
          <h3 class="recipe-section-heading">Ingredients</h3>
          <ul class="ingredient-list">${ingredientItems}</ul>
        </div>
        <div class="instructions-column">
          <h3 class="recipe-section-heading">Instructions</h3>
          <ol class="instruction-list">${instructionItems}</ol>
        </div>
      </div>
      ${tipsSection}
    </section>
  `;
}

function generateBackCoverHtml(layoutData: PrintLayoutData, theme: ThemeConfig): string {
  return `
    <section class="page-back-cover">
      <div class="cover-accent-top"></div>
      <div class="cover-accent-bottom"></div>
      <div class="back-cover-content">
        <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="${theme.lightColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="back-cover-icon">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
        </svg>
        <h2 class="back-cover-title">${escapeHtml(layoutData.title || "My Cookbook")}</h2>
        ${layoutData.subtitle ? `<p class="back-cover-subtitle">${escapeHtml(layoutData.subtitle)}</p>` : ''}
        ${layoutData.coverData?.backText ? `<p class="back-cover-text">${escapeHtml(layoutData.coverData.backText)}</p>` : ''}
        <p class="back-cover-branding">Made with Grammie</p>
      </div>
    </section>
  `;
}

// --- CSS Generation ---

function generatePagedCSS(
  theme: ThemeConfig,
  pageWidthIn: number,
  pageHeightIn: number,
  templateStyle: string
): string {
  const contentW = pageWidthIn - MARGIN_OUTER - MARGIN_INNER;
  const isSmallPage = pageWidthIn < 6;
  const isLargePage = pageWidthIn >= 8;
  const titleSize = isSmallPage ? 16 : isLargePage ? 24 : 20;
  const bodySize = isSmallPage ? 9 : isLargePage ? 11 : 10;
  const headingSize = isSmallPage ? 10 : isLargePage ? 13 : 11;
  const imageHeight = isSmallPage ? '1.5in' : isLargePage ? '2.5in' : '2in';

  return `
    @page {
      size: ${pageWidthIn}in ${pageHeightIn}in;
      margin-top: ${MARGIN_TOP}in;
      margin-bottom: ${MARGIN_BOTTOM}in;
      margin-inside: ${MARGIN_INNER}in;
      margin-outside: ${MARGIN_OUTER}in;

      @bottom-center {
        content: counter(page);
        font-family: ${theme.bodyFont};
        font-size: 8pt;
        color: ${theme.lightColor};
      }
    }

    @page :first {
      @bottom-center { content: none; }
    }

    @page cover {
      margin: 0;
      @bottom-center { content: none; }
    }

    @page back-cover {
      margin: 0;
      @bottom-center { content: none; }
    }

    @page section-divider {
      margin: 0;
      @bottom-center { content: none; }
    }

    @page dedication {
      @bottom-center { content: none; }
    }

    /* ---- Base Reset ---- */
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: ${theme.bodyFont};
      font-size: ${bodySize}pt;
      color: ${theme.bodyColor};
      background: ${theme.pageBg};
      line-height: 1.5;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ---- Cover ---- */
    .page-cover {
      page: cover;
      break-before: page;
      break-after: page;
      width: ${pageWidthIn}in;
      height: ${pageHeightIn}in;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      background: ${theme.coverBg};
      overflow: hidden;
    }

    .cover-accent-top, .cover-accent-bottom {
      position: absolute;
      left: 0; right: 0;
      height: 6px;
      background: ${theme.coverAccent};
    }
    .cover-accent-top { top: 0; }
    .cover-accent-bottom { bottom: 0; }

    .cover-border {
      position: absolute;
      top: 18px; left: 18px; right: 18px; bottom: 18px;
      border: ${theme.borderStyle};
      border-radius: 4px;
      pointer-events: none;
    }

    .cover-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 0.75in;
      width: 100%;
      height: 100%;
      justify-content: center;
    }

    .cover-icon {
      width: 64px; height: 64px;
      border-radius: 50%;
      background: ${theme.coverAccent};
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
    }

    .cover-title {
      font-family: ${theme.titleFont};
      font-size: ${titleSize + 8}pt;
      font-weight: 700;
      color: ${theme.titleColor};
      line-height: 1.2;
      margin-bottom: 8px;
      max-width: 90%;
    }

    .cover-subtitle {
      font-size: ${bodySize + 2}pt;
      font-style: italic;
      color: ${theme.subtitleColor};
      margin-bottom: 16px;
      max-width: 80%;
    }

    .cover-footer {
      margin-top: auto;
      padding-top: 24px;
    }

    .cover-author {
      font-size: ${bodySize}pt;
      color: ${theme.mutedColor};
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }

    .cover-recipe-count {
      font-size: ${bodySize - 1}pt;
      color: ${theme.lightColor};
      margin-top: 4px;
    }

    /* ---- Dedication ---- */
    .page-dedication {
      page: dedication;
      break-before: page;
      break-after: page;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100%;
    }

    .dedication-content {
      max-width: 80%;
      text-align: center;
    }

    .dedication-text {
      font-family: ${theme.titleFont};
      font-size: ${bodySize + 2}pt;
      font-style: italic;
      color: ${theme.subtitleColor};
      line-height: 1.8;
    }

    /* ---- TOC ---- */
    .page-toc {
      break-before: page;
    }

    .toc-heading {
      font-family: ${theme.titleFont};
      font-size: ${titleSize}pt;
      font-weight: 700;
      color: ${theme.titleColor};
      text-align: center;
      margin-bottom: 4px;
    }

    .toc-divider {
      width: 48px;
      height: 2px;
      background: ${theme.dividerColor};
      margin: 0 auto 16px;
    }

    .toc-section-title {
      font-size: ${bodySize - 1}pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: ${theme.accentColor};
      margin-top: 12px;
      margin-bottom: 4px;
      padding-bottom: 3px;
      border-bottom: 1px solid ${theme.dividerColor}40;
    }

    .toc-entry {
      display: flex;
      align-items: baseline;
      gap: 6px;
      padding: 3px 2px;
      font-family: ${theme.bodyFont};
    }

    .toc-number {
      font-size: ${bodySize - 1}pt;
      color: ${theme.lightColor};
      font-family: monospace;
      width: 18px;
      flex-shrink: 0;
      text-align: right;
    }

    .toc-title {
      font-size: ${bodySize}pt;
      color: ${theme.bodyColor};
      flex: 1;
    }

    .toc-dots {
      flex: 1;
      border-bottom: 1px dotted ${theme.lightColor};
      min-width: 20px;
      margin-bottom: 3px;
    }

    .toc-time {
      font-size: ${bodySize - 1}pt;
      color: ${theme.lightColor};
      flex-shrink: 0;
    }

    /* ---- Section Dividers ---- */
    .page-section-divider {
      page: section-divider;
      break-before: page;
      break-after: page;
      width: ${pageWidthIn}in;
      height: ${pageHeightIn}in;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      background: ${theme.sectionBg};
    }

    .section-decor {
      font-size: 28pt;
      color: ${theme.lightColor};
      margin-bottom: 12px;
    }

    .section-title {
      font-family: ${theme.titleFont};
      font-size: ${titleSize + 2}pt;
      font-weight: 700;
      color: ${theme.titleColor};
      margin-bottom: 8px;
    }

    .section-rule {
      width: 40px;
      height: 2px;
      background: ${theme.dividerColor};
    }

    /* ---- Recipe Pages ---- */
    .recipe-page {
      break-before: page;
      break-inside: auto;
    }

    .recipe-hero {
      position: relative;
      width: calc(100% + ${MARGIN_OUTER}in + ${MARGIN_INNER}in);
      height: ${imageHeight};
      margin-top: -${MARGIN_TOP}in;
      margin-left: -${MARGIN_INNER}in;
      margin-right: -${MARGIN_OUTER}in;
      margin-bottom: 10px;
      overflow: hidden;
    }

    /* Override for right-hand pages */
    .pagedjs_right_page .recipe-hero {
      margin-left: -${MARGIN_OUTER}in;
      margin-right: -${MARGIN_INNER}in;
    }

    .recipe-hero-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .recipe-hero-gradient {
      position: absolute;
      inset: 0;
      background: linear-gradient(to top, rgba(0,0,0,0.65), transparent 60%);
    }

    .recipe-hero-title-overlay {
      position: absolute;
      bottom: 0; left: 0; right: 0;
      padding: 10px 14px;
    }

    .recipe-title {
      font-family: ${theme.titleFont};
      font-size: ${titleSize}pt;
      font-weight: 700;
      color: ${theme.titleColor};
      line-height: 1.2;
      margin-bottom: 4px;
    }

    .recipe-title-on-image {
      color: white;
      text-shadow: 0 1px 4px rgba(0,0,0,0.3);
    }

    .recipe-title-block {
      margin-bottom: 8px;
    }

    .recipe-title-rule {
      width: 32px;
      height: 2px;
      background: ${theme.dividerColor};
      margin-top: 4px;
    }

    /* Badges */
    .recipe-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 8px;
    }

    .recipe-badge {
      font-size: ${bodySize - 1}pt;
      background: ${theme.badgeBg};
      color: ${theme.badgeColor};
      padding: 1px 8px;
      border-radius: 10px;
      white-space: nowrap;
    }

    .recipe-badge-muted {
      background: ${theme.tipBg};
      color: ${theme.mutedColor};
    }

    .recipe-description {
      font-size: ${bodySize}pt;
      font-style: italic;
      color: ${theme.subtitleColor};
      line-height: 1.5;
      margin-bottom: 10px;
    }

    /* Two-column layout */
    .recipe-body-columns {
      display: grid;
      grid-template-columns: 1fr 1.5fr;
      gap: 14px;
    }

    .recipe-section-heading {
      font-family: ${theme.titleFont};
      font-size: ${headingSize}pt;
      font-weight: 700;
      color: ${theme.titleColor};
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 6px;
      padding-bottom: 3px;
      border-bottom: 1px solid ${theme.dividerColor}30;
    }

    .ingredient-list {
      list-style: none;
      padding: 0;
      margin: 0 0 10px 0;
    }

    .ingredient-item {
      font-size: ${bodySize}pt;
      color: ${theme.bodyColor};
      padding: 1.5px 0;
      line-height: 1.35;
    }

    .ingredient-qty {
      font-weight: 600;
      color: ${theme.titleColor};
    }

    .ingredient-prep {
      color: ${theme.mutedColor};
    }

    .instruction-list {
      list-style: none;
      padding: 0;
      margin: 0 0 10px 0;
    }

    .instruction-item {
      font-size: ${bodySize}pt;
      color: ${theme.bodyColor};
      padding: 2.5px 0;
      line-height: 1.45;
    }

    .step-number {
      font-weight: 700;
      color: ${theme.accentColor};
    }

    /* Tips */
    .recipe-tips {
      margin-top: 10px;
      padding: 8px 10px;
      background: ${theme.tipBg};
      border-radius: 4px;
      border: 1px solid ${theme.tipBorder};
      break-inside: avoid;
    }

    .tips-heading {
      font-size: ${bodySize - 1}pt;
      font-weight: 700;
      color: ${theme.tipColor};
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 3px;
    }

    .tip-text {
      font-size: ${bodySize - 1}pt;
      color: ${theme.tipColor};
      line-height: 1.4;
    }

    /* ---- Back Cover ---- */
    .page-back-cover {
      page: back-cover;
      break-before: page;
      width: ${pageWidthIn}in;
      height: ${pageHeightIn}in;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      background: ${theme.coverBg};
      overflow: hidden;
    }

    .back-cover-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 0.75in;
      width: 100%;
      height: 100%;
      justify-content: center;
    }

    .back-cover-icon {
      margin-bottom: 16px;
    }

    .back-cover-title {
      font-family: ${theme.titleFont};
      font-size: ${titleSize}pt;
      font-weight: 700;
      color: ${theme.titleColor};
      margin-bottom: 8px;
    }

    .back-cover-subtitle {
      font-size: ${bodySize + 1}pt;
      font-style: italic;
      color: ${theme.mutedColor};
      max-width: 70%;
      margin-bottom: 24px;
    }

    .back-cover-text {
      font-size: ${bodySize}pt;
      color: ${theme.bodyColor};
      max-width: 80%;
      line-height: 1.6;
      margin-bottom: 24px;
    }

    .back-cover-branding {
      font-size: ${bodySize - 1}pt;
      color: ${theme.lightColor};
      margin-top: auto;
    }

    /* ---- Paged.js container overrides ---- */
    .pagedjs_page {
      background: ${theme.pageBg};
      margin-bottom: 0 !important;
    }

    /* Keep ingredients together when possible */
    .ingredient-item {
      break-inside: avoid;
    }

    .instruction-item {
      break-inside: avoid;
    }

    .recipe-tips {
      break-inside: avoid;
    }

    .recipe-badges {
      break-inside: avoid;
    }

    .recipe-title-block {
      break-after: avoid;
    }

    .recipe-section-heading {
      break-after: avoid;
    }
  `;
}

// --- Main Component ---

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
  const [totalPages, setTotalPages] = useState(0);
  const [rendering, setRendering] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pagedContainerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLElement[]>([]);
  const theme = THEMES[templateStyle] || THEMES.classic;

  // Get trim size dimensions
  const sizeId = (trimSize || "0600X0900") as TrimSizeId;
  const sizeConfig = BOOK_SIZES[sizeId] || BOOK_SIZES["0600X0900"];
  const pageWidthIn = sizeConfig.width;
  const pageHeightIn = sizeConfig.height;

  const stageW = pageWidthIn * DPI;
  const stageH = pageHeightIn * DPI;

  // Calculate scale to fit viewport
  const [viewScale, setViewScale] = useState(1);
  useEffect(() => {
    if (!open || !containerRef.current) return;
    const updateScale = () => {
      const container = containerRef.current;
      if (!container) return;
      const availW = container.clientWidth - 120;
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

  // Generate HTML content for Paged.js
  const htmlContent = useMemo(() => {
    if (recipesById.size === 0 && allRecipeIds.length > 0) return null;

    let html = '';
    html += generateCoverHtml(layoutData, theme, allOrderedRecipes.length);
    html += generateDedicationHtml(layoutData, theme);

    const hasRecipes = layoutData.sections.some(s =>
      s.recipeIds.some(id => recipesById.has(String(id)))
    );
    if (hasRecipes) {
      html += generateTocHtml(layoutData.sections, recipesById, theme);
    }

    let recipeIndex = 0;
    layoutData.sections.forEach(section => {
      const sectionRecipes = section.recipeIds
        .map(id => recipesById.get(String(id)))
        .filter(Boolean) as Recipe[];

      if (sectionRecipes.length > 0 && layoutData.sections.length > 1) {
        html += generateSectionDividerHtml(section.title, theme);
      }

      sectionRecipes.forEach(recipe => {
        html += generateRecipeHtml(recipe, recipeIndex++, theme, pageWidthIn);
      });
    });

    html += generateBackCoverHtml(layoutData, theme);
    return html;
  }, [layoutData, recipesById, theme, allOrderedRecipes.length, pageWidthIn, allRecipeIds.length]);

  const cssContent = useMemo(
    () => generatePagedCSS(theme, pageWidthIn, pageHeightIn, templateStyle),
    [theme, pageWidthIn, pageHeightIn, templateStyle]
  );

  // Run Paged.js whenever content changes
  useEffect(() => {
    if (!open || !htmlContent || !pagedContainerRef.current) return;

    let cancelled = false;
    const container = pagedContainerRef.current;

    const runPaged = async () => {
      setRendering(true);

      // Clear previous render
      container.innerHTML = '';
      pagesRef.current = [];

      try {
        const previewer = new Previewer();
        const cssBlob = new Blob([cssContent], { type: 'text/css' });
        const cssUrl = URL.createObjectURL(cssBlob);

        const result = await previewer.preview(
          htmlContent,
          [cssUrl],
          container
        );

        URL.revokeObjectURL(cssUrl);

        if (cancelled) return;

        // Collect rendered pages
        const renderedPages = container.querySelectorAll('.pagedjs_page');
        pagesRef.current = Array.from(renderedPages) as HTMLElement[];
        setTotalPages(pagesRef.current.length);
        setCurrentPage(0);
      } catch (err) {
        console.error('Paged.js rendering error:', err);
      } finally {
        if (!cancelled) setRendering(false);
      }
    };

    runPaged();
    return () => { cancelled = true; };
  }, [open, htmlContent, cssContent]);

  // Show/hide pages based on currentPage
  useEffect(() => {
    pagesRef.current.forEach((page, idx) => {
      page.style.display = idx === currentPage ? '' : 'none';
    });
  }, [currentPage, totalPages]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setCurrentPage(0);
      setZoom(1);
    }
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

  const isLeftPage = currentPage % 2 === 0;
  const bleedPx = BLEED * DPI;
  const marginOuterPx = MARGIN_OUTER * DPI;
  const marginInnerPx = MARGIN_INNER * DPI;
  const safeZonePx = SAFE_ZONE * DPI;
  const marginTopPx = MARGIN_TOP * DPI;
  const marginBottomPx = MARGIN_BOTTOM * DPI;

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
                {rendering ? (
                  <span className="text-amber-400">Rendering pages...</span>
                ) : (
                  <>
                    Page {currentPage + 1} of {totalPages}
                    {" \u00B7 "}
                    <span className="text-amber-400 font-mono">
                      {pageWidthIn}" x {pageHeightIn}"
                    </span>
                    {" \u00B7 "}
                    {sizeConfig.name}
                    {" \u00B7 "}
                    {templateStyle.charAt(0).toUpperCase() + templateStyle.slice(1)}
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
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
            {/* Bleed area guide */}
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

            {/* Trim edge - page content rendered by Paged.js */}
            <div
              className="relative overflow-hidden"
              style={{
                width: stageW * viewScale,
                height: stageH * viewScale,
                boxShadow: "0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)",
                borderRadius: 2,
              }}
            >
              {/* Paged.js rendered content */}
              <div
                ref={pagedContainerRef}
                className="paged-preview-container"
                style={{
                  width: stageW,
                  height: stageH,
                  transform: `scale(${viewScale})`,
                  transformOrigin: "top left",
                  position: "relative",
                  background: theme.pageBg,
                  overflow: "hidden",
                }}
              />

              {/* Loading overlay */}
              {rendering && (
                <div
                  className="absolute inset-0 flex items-center justify-center"
                  style={{ background: 'rgba(0,0,0,0.5)', zIndex: 40 }}
                >
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-8 w-8 text-white animate-spin" />
                    <span className="text-sm text-white">Rendering pages...</span>
                  </div>
                </div>
              )}

              {/* Margin guides overlay (on top of Paged.js output) */}
              {showGuides && !rendering && (
                <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 20 }}>
                  {/* Scale wrapper for guides */}
                  <div style={{
                    width: stageW,
                    height: stageH,
                    transform: `scale(${viewScale})`,
                    transformOrigin: "top left",
                    position: "absolute",
                    top: 0,
                    left: 0,
                  }}>
                    {/* Top margin */}
                    <div className="absolute left-0 right-0" style={{ top: 0, height: marginTopPx }}>
                      <div className="w-full h-full" style={{ background: 'rgba(59, 130, 246, 0.06)' }} />
                      <div className="absolute bottom-0 left-0 right-0 border-b border-dashed" style={{ borderColor: 'rgba(59, 130, 246, 0.35)' }} />
                      <span className="absolute right-2 top-1 text-[8px] font-mono" style={{ color: 'rgba(59, 130, 246, 0.6)' }}>
                        {MARGIN_TOP}"
                      </span>
                    </div>
                    {/* Bottom margin */}
                    <div className="absolute left-0 right-0" style={{ bottom: 0, height: marginBottomPx }}>
                      <div className="w-full h-full" style={{ background: 'rgba(59, 130, 246, 0.06)' }} />
                      <div className="absolute top-0 left-0 right-0 border-t border-dashed" style={{ borderColor: 'rgba(59, 130, 246, 0.35)' }} />
                      <span className="absolute right-2 bottom-1 text-[8px] font-mono" style={{ color: 'rgba(59, 130, 246, 0.6)' }}>
                        {MARGIN_BOTTOM}"
                      </span>
                    </div>
                    {/* Inner margin (gutter/binding side) */}
                    <div className="absolute top-0 bottom-0" style={{
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
                    <div className="absolute top-0 bottom-0" style={{
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

                    {/* Safe zone */}
                    <div className="absolute" style={{
                      top: marginTopPx + safeZonePx,
                      bottom: marginBottomPx + safeZonePx,
                      left: (isLeftPage ? marginInnerPx : marginOuterPx) + safeZonePx,
                      right: (isLeftPage ? marginOuterPx : marginInnerPx) + safeZonePx,
                      border: '1px dotted rgba(34, 197, 94, 0.3)',
                    }}>
                      <span className="absolute -top-3 left-0 text-[7px] font-mono" style={{ color: 'rgba(34, 197, 94, 0.5)' }}>
                        Safe zone
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Dimension labels outside page */}
            {showGuides && (
              <>
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

        {/* Bottom bar */}
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
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i}
                onClick={() => setCurrentPage(i)}
                title={`Page ${i + 1}`}
                className={`shrink-0 rounded transition-all ${
                  i === currentPage
                    ? "bg-white w-5 h-2"
                    : "bg-neutral-600 hover:bg-neutral-500 w-2 h-2"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-neutral-500">
              Content area: {(pageWidthIn - MARGIN_OUTER - MARGIN_INNER).toFixed(2)}" x {(pageHeightIn - MARGIN_TOP - MARGIN_BOTTOM).toFixed(2)}"
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
