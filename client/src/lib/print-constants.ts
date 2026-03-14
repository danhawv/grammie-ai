// Book sizes available for print-on-demand
export const BOOK_SIZES = {
  '0425X0687': { name: 'Pocket Book', width: 4.25, height: 6.875, description: '4.25" x 6.875"' },
  '0500X0800': { name: 'Novella', width: 5, height: 8, description: '5" x 8"' },
  '0550X0850': { name: 'Digest', width: 5.5, height: 8.5, description: '5.5" x 8.5"' },
  '0600X0900': { name: 'US Trade', width: 6, height: 9, description: '6" x 9" (Most Popular)' },
  '0614X0921': { name: 'Royal', width: 6.14, height: 9.21, description: '6.14" x 9.21"' },
  '0700X1000': { name: 'Executive', width: 7, height: 10, description: '7" x 10"' },
  '0744X0968': { name: 'Crown Quarto', width: 7.44, height: 9.68, description: '7.44" x 9.68"' },
  '0750X0750': { name: 'Square (Small)', width: 7.5, height: 7.5, description: '7.5" x 7.5"' },
  '0827X1169': { name: 'A4', width: 8.27, height: 11.69, description: '8.27" x 11.69" (A4)' },
  '0850X1100': { name: 'US Letter', width: 8.5, height: 11, description: '8.5" x 11"' },
  '0850X0850': { name: 'Square (Large)', width: 8.5, height: 8.5, description: '8.5" x 8.5"' },
} as const;

export type TrimSizeId = keyof typeof BOOK_SIZES;

// Binding types
export const BINDING_TYPES = {
  PB: { name: 'Paperback', description: 'Perfect bound softcover. Most popular and cost-effective.' },
  CW: { name: 'Hardcover', description: 'Case wrap hardcover with printed cover.' },
  LW: { name: 'Linen Wrap', description: 'Hardcover with linen material and optional foil stamping.' },
  CO: { name: 'Coil Bound', description: 'Spiral coil binding. Lays flat when open — great for cookbooks.' },
  SS: { name: 'Saddle Stitch', description: 'Staple-bound booklet. Best for shorter cookbooks (up to 80 pages).' },
} as const;

export type BindingTypeId = keyof typeof BINDING_TYPES;

// Paper types
export const PAPER_TYPES = {
  '060UW444': { name: '60# White Uncoated', description: 'Standard white paper. Good for text-heavy layouts.' },
  '060UC444': { name: '60# Cream Uncoated', description: 'Warm cream paper. Classic cookbook feel.' },
  '080CW444': { name: '80# White Coated', description: 'Glossy coated paper. Best for full-color photo cookbooks.' },
} as const;

export type PaperTypeId = keyof typeof PAPER_TYPES;

// Color types
export const COLOR_TYPES = {
  BW: { name: 'Black & White', description: 'Lower cost, great for text-focused cookbooks.' },
  FC: { name: 'Full Color', description: 'Vibrant photos and colored design elements.' },
} as const;

export type ColorTypeId = keyof typeof COLOR_TYPES;

// Cover finishes
export const COVER_FINISHES = {
  M: { name: 'Matte', description: 'Soft, non-reflective finish. Elegant feel.' },
  G: { name: 'Glossy', description: 'Shiny, reflective finish. Makes colors pop.' },
} as const;

export type CoverFinishId = keyof typeof COVER_FINISHES;

// Valid binding + paper combinations
export const BINDING_PAPER_COMPATIBILITY: Record<BindingTypeId, PaperTypeId[]> = {
  PB: ['060UW444', '060UC444', '080CW444'],
  CW: ['060UW444', '060UC444', '080CW444'],
  LW: ['060UW444', '060UC444'],
  CO: ['060UW444', '060UC444', '080CW444'],
  SS: ['060UW444', '080CW444'],
};

// Page count limits per binding type
export const BINDING_PAGE_LIMITS: Record<BindingTypeId, { min: number; max: number }> = {
  PB: { min: 32, max: 800 },
  CW: { min: 32, max: 800 },
  LW: { min: 32, max: 800 },
  CO: { min: 24, max: 300 },
  SS: { min: 4, max: 80 },
};

// Theme options
export const THEMES = [
  { id: 'classic', name: 'Classic', description: 'Traditional cookbook layout with elegant serif typography' },
  { id: 'modern', name: 'Modern', description: 'Clean, contemporary design with bold sans-serif fonts' },
  { id: 'rustic', name: 'Rustic', description: 'Warm, handwritten feel with earthy tones' },
  { id: 'elegant', name: 'Elegant', description: 'Sophisticated design with refined Playfair Display typography' },
] as const;

export type ThemeId = typeof THEMES[number]['id'];

// Recipe layout options
export const RECIPE_LAYOUTS = [
  { id: 'full-page', name: 'Full Page', description: 'Recipe with photo on a single page' },
  { id: 'text-only', name: 'Text Only', description: 'Recipe without photo (fits more content)' },
  { id: 'two-page-spread', name: 'Two-Page Spread', description: 'Photo on left, recipe on right' },
] as const;

export type RecipeLayoutId = typeof RECIPE_LAYOUTS[number]['id'];

// Default print configuration
export const DEFAULT_PRINT_CONFIG = {
  trimSize: '0600X0900' as TrimSizeId,
  bindingType: 'PB' as BindingTypeId,
  colorType: 'FC' as ColorTypeId,
  paperType: '080CW444' as PaperTypeId,
  coverFinish: 'M' as CoverFinishId,
  theme: 'classic' as ThemeId,
};
