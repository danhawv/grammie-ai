// Turns an AI reading of cookbook photos into a CustomTemplateData. The AI's
// output is untrusted: fonts must come from a known Google Fonts list, colors
// must be hex, and every layout choice is checked against the allowed values.

import {
  customTemplateDataSchema,
  recipeLayoutSpecSchema,
  type CustomTemplateData,
  type RecipeLayoutSpec,
} from './schema';
import { CARD_LAYOUT_PRESET } from './recipe-card';
import { lightenColor, darkenColor, isColorDark } from './template-theme';

export const STYLE_FONTS = {
  serif: ['Playfair Display', 'Lora', 'Merriweather', 'Libre Baskerville', 'Cormorant Garamond', 'EB Garamond', 'DM Serif Display', 'Crimson Text', 'Fraunces', 'Abril Fatface', 'Bitter', 'Roboto Slab', 'Zilla Slab', 'Arvo', 'Source Serif 4'],
  sans: ['Inter', 'Montserrat', 'Poppins', 'Lato', 'Open Sans', 'Raleway', 'Nunito', 'Work Sans', 'Josefin Sans', 'Oswald', 'Bebas Neue', 'Archivo', 'Barlow Condensed', 'DM Sans', 'Karla'],
  script: ['Caveat', 'Dancing Script', 'Pacifico', 'Great Vibes', 'Satisfy', 'Kalam', 'Amatic SC'],
} as const;

const ALL_FONTS: string[] = [...STYLE_FONTS.serif, ...STYLE_FONTS.sans, ...STYLE_FONTS.script];

export interface StyleAnalysis {
  name?: unknown;
  description?: unknown;
  headingFont?: unknown;
  bodyFont?: unknown;
  colors?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  dividerStyle?: unknown;
}

function pickFont(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const v = value.trim().toLowerCase();
  return ALL_FONTS.find((f) => f.toLowerCase() === v) ?? fallback;
}

function pickHex(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  let v = value.trim();
  if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + v.slice(1).split('').map((c) => c + c).join('');
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback;
}

function cleanText(value: unknown, max: number, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const v = value.replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, max) : fallback;
}

/** Each layout field is validated on its own so one bad value doesn't discard the rest */
export function sanitizeLayout(raw: Record<string, unknown> | undefined): RecipeLayoutSpec {
  const out: Record<string, unknown> = { ...CARD_LAYOUT_PRESET };
  const shape = recipeLayoutSpecSchema.shape;
  for (const key of Object.keys(shape) as (keyof typeof shape)[]) {
    if (!raw || !(key in raw)) continue;
    let value = raw[key];
    if (key === 'titleScale' || key === 'cornerRadius') {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      value = key === 'titleScale' ? Math.min(1.6, Math.max(0.7, n)) : Math.min(24, Math.max(0, Math.round(n)));
    }
    const parsed = (shape[key] as any).safeParse(value);
    if (parsed.success) out[key] = parsed.data;
  }
  return recipeLayoutSpecSchema.parse(out);
}

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Photos often show titles over a dish photo (e.g. white); on the page they must read against the background */
function readableOn(color: string, background: string, minRatio: number, fallback: string): string {
  return contrastRatio(color, background) >= minRatio ? color : fallback;
}

export function templateFromStyleAnalysis(raw: StyleAnalysis): {
  name: string;
  description: string;
  templateData: CustomTemplateData;
} {
  const c = raw.colors ?? {};
  const background = pickHex(c.background, '#fffdf8');
  const darkBg = isColorDark(background);
  const text = readableOn(pickHex(c.text, darkBg ? '#f5f1ea' : '#2f2a24'), background, 4.5, darkBg ? '#f5f1ea' : '#2f2a24');
  const title = readableOn(pickHex(c.title, darkBg ? '#ffffff' : '#1f1a14'), background, 3, darkBg ? '#ffffff' : '#1f1a14');
  const accent = pickHex(c.accent, '#e3a72f');
  const panel = pickHex(c.panel, darkBg ? darkenColor(background, 0.15) : lightenColor(accent, 0.9));
  const coverBackground = pickHex(c.coverBackground, darkBg ? background : accent);
  const coverText = pickHex(c.coverText, isColorDark(coverBackground) ? '#ffffff' : '#1f1a14');

  const layout = sanitizeLayout(raw.layout);
  const divider = ['solid', 'dashed', 'dotted', 'double', 'none'].includes(String(raw.dividerStyle))
    ? (raw.dividerStyle as 'solid' | 'dashed' | 'dotted' | 'double' | 'none')
    : 'solid';

  const templateData = customTemplateDataSchema.parse({
    fonts: {
      heading: { family: pickFont(raw.headingFont, 'Playfair Display'), weight: '700', source: 'google' },
      body: { family: pickFont(raw.bodyFont, 'Inter'), weight: '400', source: 'google' },
    },
    colors: {
      titleColor: title,
      subtitleColor: darkBg ? lightenColor(text, 0.2) : lightenColor(text, 0.35),
      textColor: text,
      accentColor: accent,
      borderColor: lightenColor(accent, 0.7),
      bgColor: background,
      sectionBg: panel,
    },
    cover: { backgroundColor: coverBackground, textColor: coverText },
    decorative: { imageRadius: `${layout.cornerRadius}px`, dividerStyle: divider, borderWidth: '2px' },
    layout,
  });

  return {
    name: cleanText(raw.name, 60, 'Photo Match'),
    description: cleanText(raw.description, 200, 'Matched from cookbook photos'),
    templateData,
  };
}

/** Prompt for the vision model; lists the exact values the sanitizer accepts */
export function styleAnalysisPrompt(imageCount: number): string {
  return `You are a book designer. The ${imageCount} image(s) show pages from a printed cookbook or a recipe card. Describe its visual style so we can build a matching print template. Match the STYLE only: never copy logos, brand names, slogans or website addresses.

Return JSON only, exactly this shape:
{
  "name": "2-4 word name describing the style (e.g. 'Golden Farmhouse'), not the book's title or brand",
  "description": "one sentence describing the look",
  "headingFont": one of ${JSON.stringify(ALL_FONTS)},
  "bodyFont": one of ${JSON.stringify([...STYLE_FONTS.sans, ...STYLE_FONTS.serif])},
  "colors": {
    "title": "#rrggbb main heading color",
    "text": "#rrggbb body text color",
    "accent": "#rrggbb the signature accent (icons, numbers, rules)",
    "background": "#rrggbb page background",
    "panel": "#rrggbb tint behind ingredient/direction panels, or the background if none",
    "coverBackground": "#rrggbb",
    "coverText": "#rrggbb"
  },
  "layout": {
    "photo": "top" | "right" | "left" | "none"   (where the dish photo sits relative to the title),
    "titleAlign": "left" | "center",
    "titleCase": "normal" | "upper",
    "titleScale": number 0.7-1.6 (how large titles are; 1 = ordinary, 1.4 = very large display titles),
    "badges": boolean (row of prep/cook/serves info),
    "badgeStyle": "circle" | "pill" | "plain" (icons in filled circles, rounded tags, or plain text),
    "columns": "auto" | "one" | "two" (ingredients and directions side by side = "two"),
    "ingredientMarker": "dot" | "check" | "dash" | "none",
    "stepMarker": "circle" | "number" | "none" (numbers in filled circles vs plain numbers),
    "panels": "boxed" | "plain" (tinted/rounded boxes behind sections vs none),
    "headingRule": boolean (line extending after section headings),
    "nutritionBox": boolean,
    "tipsBox": boolean,
    "cornerRadius": number 0-24 (px rounding of photos and boxes)
  },
  "dividerStyle": "solid" | "dashed" | "dotted" | "double" | "none"
}
Pick the closest font from the lists by look (serif vs sans, weight, width). Sample colors from the images.`;
}
