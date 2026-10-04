import type { CustomTemplateData, RecipeLayoutSpec } from './schema';

// Theme configuration shared by the PDF generator (server) and the print
// preview (client). Both renderers must derive identical values from a custom
// template, or the on-screen preview stops matching the printed book.

export interface ThemeConfig {
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
  /** Optional overrides from custom templates; renderers fall back to their neutral defaults */
  titleColor?: string;
  textColor?: string;
  /** Optional px overrides from custom templates; renderers fall back to their width-derived defaults */
  fontSizes?: {
    title?: number;
    subtitle?: number;
    sectionTitle?: number;
    recipeTitle?: number;
    body?: number;
  };
  /** Applied to the interior (bottom) corners of full-bleed recipe photos; outer corners are trimmed at bleed */
  imageRadius?: string;
  /** When set, recipe pages use the card layout (shared/recipe-card.ts) instead of the photo banner */
  recipeLayout?: RecipeLayoutSpec;
}

/** Parse a CSS length like '18px' into px, rejecting non-positive/invalid values */
function parsePx(value?: string): number | undefined {
  if (!value) return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Converts a CustomTemplateData JSONB object into the ThemeConfig used by all
 * HTML builders and preview page components. This is the key integration point —
 * custom templates map to the same structure as built-in themes.
 */
export function buildThemeConfigFromTemplate(data: CustomTemplateData): ThemeConfig {
  const colors = data.colors;
  const fonts = data.fonts;
  const cover = data.cover;

  // Derive accent-related colors from the main accent color
  const accentHex = colors.accentColor;

  // Build font family strings with fallbacks
  const headingFont = fonts.heading.source === 'google'
    ? `'${fonts.heading.family}', Georgia, serif`
    : `'${fonts.heading.family}', serif`;
  const bodyFont = fonts.body.source === 'google'
    ? `'${fonts.body.family}', -apple-system, system-ui, sans-serif`
    : `'${fonts.body.family}', sans-serif`;

  // Determine if cover is dark based on background color luminance
  const coverBg = cover?.backgroundColor || colors.bgColor;
  const coverDark = isColorDark(coverBg);

  const sizes = data.fontSizes;
  const fontSizes = sizes
    ? {
        title: parsePx(sizes.title),
        subtitle: parsePx(sizes.subtitle),
        sectionTitle: parsePx(sizes.sectionTitle),
        recipeTitle: parsePx(sizes.recipeTitle),
        body: parsePx(sizes.body),
      }
    : undefined;

  return {
    bg: colors.bgColor,
    bgCover: coverBg,
    bgBack: colors.sectionBg || colors.bgColor,
    titleFont: headingFont,
    bodyFont: bodyFont,
    accent: accentHex,
    accentLight: lightenColor(accentHex, 0.9),
    accentBorder: lightenColor(accentHex, 0.7),
    divider: accentHex,
    stepNum: accentHex,
    badgeBg: lightenColor(accentHex, 0.9),
    badgeText: darkenColor(accentHex, 0.3),
    tipsBg: colors.sectionBg || lightenColor(accentHex, 0.95),
    tipsBorder: lightenColor(accentHex, 0.8),
    tipsTitle: darkenColor(accentHex, 0.4),
    tipsText: darkenColor(accentHex, 0.2),
    coverDark,
    pageNum: '#a8a29e',
    titleColor: colors.titleColor,
    textColor: colors.textColor,
    fontSizes,
    imageRadius: data.decorative?.imageRadius,
    recipeLayout: data.layout,
  };
}

/** Check if a hex color is dark (for choosing light/dark text) */
export function isColorDark(color: string): boolean {
  // Handle non-hex colors (gradients, named colors)
  if (!color.startsWith('#')) return true;
  const hex = color.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  // Relative luminance formula
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
}

/** Lighten a hex color by mixing with white. factor: 0=original, 1=white */
export function lightenColor(hex: string, factor: number): string {
  if (!hex.startsWith('#')) return hex;
  const h = hex.replace('#', '');
  const r = Math.round(parseInt(h.substring(0, 2), 16) + (255 - parseInt(h.substring(0, 2), 16)) * factor);
  const g = Math.round(parseInt(h.substring(2, 4), 16) + (255 - parseInt(h.substring(2, 4), 16)) * factor);
  const b = Math.round(parseInt(h.substring(4, 6), 16) + (255 - parseInt(h.substring(4, 6), 16)) * factor);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** Darken a hex color by mixing with black. factor: 0=original, 1=black */
export function darkenColor(hex: string, factor: number): string {
  if (!hex.startsWith('#')) return hex;
  const h = hex.replace('#', '');
  const r = Math.round(parseInt(h.substring(0, 2), 16) * (1 - factor));
  const g = Math.round(parseInt(h.substring(2, 4), 16) * (1 - factor));
  const b = Math.round(parseInt(h.substring(4, 6), 16) * (1 - factor));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
