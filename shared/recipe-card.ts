// Recipe "card" page: title beside the photo, icon badges, ingredients and
// directions panels, nutrition and tips boxes. Produces an HTML string so the
// PDF generator (server) and the print preview (client) render the exact same
// markup. Page size, margins and the photo position all come in as inputs.

import type { RecipeLayoutSpec } from './schema';
import type { ThemeConfig } from './template-theme';
import type { NormalizedRecipe } from './print-recipe-types';

export const CARD_LAYOUT_PRESET: RecipeLayoutSpec = {
  photo: 'right',
  titleAlign: 'left',
  titleCase: 'normal',
  titleScale: 1.25,
  badges: true,
  badgeStyle: 'circle',
  columns: 'auto',
  ingredientMarker: 'dot',
  stepMarker: 'circle',
  panels: 'boxed',
  headingRule: true,
  nutritionBox: true,
  tipsBox: true,
  cornerRadius: 10,
};

/** Built-in "Recipe Card" theme: warm white page, golden accents, bold serif titles */
export const CARD_THEME: ThemeConfig = {
  bg: '#fffdf8',
  bgCover: 'linear-gradient(135deg, #fff6dc, #f9e3a8, #fff6dc)',
  bgBack: 'linear-gradient(135deg, #fffaf0, #f6ecd2, #fffaf0)',
  titleFont: "'Playfair Display', Georgia, serif",
  bodyFont: "'Inter', -apple-system, system-ui, sans-serif",
  accent: '#e3a72f',
  accentLight: '#fdf6e6',
  accentBorder: '#f1d698',
  divider: '#e3a72f',
  stepNum: '#e3a72f',
  badgeBg: '#fdf3d9',
  badgeText: '#8a5a00',
  tipsBg: '#fdf8ec',
  tipsBorder: '#f1d698',
  tipsTitle: '#2a2118',
  tipsText: '#3d3428',
  coverDark: false,
  pageNum: '#b8a98a',
  titleColor: '#1f1a14',
  textColor: '#2f2a24',
  recipeLayout: CARD_LAYOUT_PRESET,
};

export interface CardGeometry {
  /** Full page size including bleed, inches */
  widthIn: number;
  heightIn: number;
  /** Bleed on each edge, inches (0 in the on-screen preview) */
  bleedIn: number;
  /** Distance from page edge to content, inches (includes bleed) */
  padTopIn: number;
  padBottomIn: number;
  padLeftIn: number;
  padRightIn: number;
  pageNumber?: number;
}

export interface CardOptions {
  includePhoto?: boolean;
  /** Override the template: hide the nutrition/tips panels */
  showNutrition?: boolean;
  showTips?: boolean;
  /** Extra HTML placed after the recipe, before the page number (family photo slot) */
  beforePageNumber?: string;
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMinutes(min?: number): string {
  if (!min) return '';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} hr ${m} min` : `${h} hr${h > 1 ? 's' : ''}`;
}

const ICONS: Record<string, string> = {
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pot: '<path d="M4.5 10h15v5.5a4 4 0 0 1-4 4h-7a4 4 0 0 1-4-4z"/><path d="M2.5 10h19M9 6.5c0-1.2 1.3-2 3-2s3 .8 3 2"/>',
  utensils: '<path d="M7 3v7.5a2 2 0 0 0 2 2V21M5 3v5M9 3v5M17 3c-2 2.2-2 6.5 0 8.5V21"/>',
  flame: '<path d="M12 3c.8 3.6 5 5.2 5 10a5 5 0 0 1-10 0c0-2.6 1.6-3.8 2-6.2 1 1 1.9 2.3 2.5 3.9.9-2.5.9-5.2.5-7.7z"/>',
  check: '<path d="M5.5 12.5l4 4 9-9.5"/>',
};

function icon(name: string, sizePt: number, color: string, strokeWidth = 2): string {
  return `<svg width="${sizePt}pt" height="${sizePt}pt" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" style="display:block;">${ICONS[name]}</svg>`;
}

function nutritionRows(n: NormalizedRecipe['nutritionInfo']): [string, string][] {
  if (!n) return [];
  const num = (v?: string | number) => {
    if (v == null || v === '') return undefined;
    const x = Number(String(v).replace(/[^\d.]/g, ''));
    return Number.isFinite(x) ? Math.round(x * 10) / 10 : undefined;
  };
  const rows: [string, string][] = [];
  const add = (label: string, v: string | number | undefined, unit: string) => {
    const x = num(v);
    if (x != null) rows.push([label, `${x}${unit}`]);
  };
  add('Calories', n.calories, '');
  add('Protein', n.protein, ' g');
  add('Carbohydrates', n.carbohydrates, ' g');
  add('Fat', n.fat, ' g');
  add('Fiber', n.fiber, ' g');
  add('Sugar', n.sugar, ' g');
  add('Sodium', n.sodium, ' mg');
  add('Cholesterol', n.cholesterol, ' mg');
  return rows;
}

/**
 * Builds one recipe page as a full-size, absolutely positioned block. The
 * text sits in a `.recipe-content` element carrying data-avail-h/-w (px) so
 * both renderers can shrink it to fit when a recipe is unusually long.
 */
export function buildRecipeCardHtml(
  recipe: NormalizedRecipe,
  specIn: Partial<RecipeLayoutSpec> | undefined,
  theme: ThemeConfig,
  geo: CardGeometry,
  opts: CardOptions = {},
): string {
  const spec: RecipeLayoutSpec = { ...CARD_LAYOUT_PRESET, ...(specIn || {}) };
  const availWIn = geo.widthIn - geo.padLeftIn - geo.padRightIn;
  const wide = availWIn >= 6;
  // Scale everything off the content width so 6x9 and 8.5x11 both look balanced
  const k = Math.max(0.88, Math.min(1.05, availWIn / 7));
  const pt = (n: number) => `${(n * k).toFixed(2)}pt`;

  const accent = theme.accent;
  const titleColor = theme.titleColor || '#1f1a14';
  const textColor = theme.textColor || '#2f2a24';
  const muted = '#6b6152';
  const radius = `${spec.cornerRadius}px`;
  const boxed = spec.panels === 'boxed';
  const panelBg = boxed ? theme.accentLight : 'transparent';
  const panelPad = boxed ? `${pt(9)} ${pt(11)}` : `${pt(2)} 0`;

  const hasPhoto = opts.includePhoto !== false && !!recipe.imageUrl && spec.photo !== 'none';
  const photoMode: RecipeLayoutSpec['photo'] = !hasPhoto ? 'none'
    : (spec.photo === 'right' || spec.photo === 'left') && !wide ? 'top' : spec.photo;
  const twoCol = spec.columns === 'two' || (spec.columns === 'auto' && wide);

  // --- Header: title + description (+ side photo) ---
  const titleSizePt = (wide ? 30 : 24) * spec.titleScale;
  const titleHtml = `<h2 style="font-family:${theme.titleFont};font-weight:800;font-size:${pt(titleSizePt)};line-height:1.05;color:${titleColor};margin:0 0 ${pt(6)};text-align:${spec.titleAlign};${spec.titleCase === 'upper' ? 'text-transform:uppercase;letter-spacing:0.02em;' : ''}">${esc(recipe.title)}</h2>`;
  const accentRule = `<div style="width:${pt(46)};height:3px;background:${accent};border-radius:2px;margin:${pt(2)} ${spec.titleAlign === 'center' ? 'auto' : '0'} ${pt(8)};"></div>`;
  const descHtml = recipe.description
    ? `<p style="font-size:${pt(10.5)};line-height:1.45;color:${textColor};margin:0;text-align:${spec.titleAlign};">${esc(recipe.description)}</p>`
    : '';
  const titleBlock = `<div>${titleHtml}${accentRule}${descHtml}</div>`;

  const sidePhotoH = Math.min(geo.heightIn * 0.32, 3.4);
  const sidePhoto = `<div style="height:${sidePhotoH}in;border-radius:${radius};overflow:hidden;"><img src="${recipe.imageUrl}" style="width:100%;height:100%;object-fit:cover;display:block;" /></div>`;

  let headerHtml: string;
  if (photoMode === 'right' || photoMode === 'left') {
    const cols = photoMode === 'right' ? '1.05fr 1fr' : '1fr 1.05fr';
    const cells = photoMode === 'right' ? titleBlock + sidePhoto : sidePhoto + titleBlock;
    headerHtml = `<div style="display:grid;grid-template-columns:${cols};gap:${pt(16)};align-items:center;margin-bottom:${pt(12)};">${cells}</div>`;
  } else {
    headerHtml = `<div style="margin-bottom:${pt(10)};">${titleBlock}</div>`;
  }

  // --- Badges row ---
  const badgeItems: { icon: string; label: string; value: string }[] = [];
  if (recipe.prepTime) badgeItems.push({ icon: 'clock', label: 'Prep time', value: formatMinutes(recipe.prepTime) });
  if (recipe.cookTime) badgeItems.push({ icon: 'pot', label: 'Cook time', value: formatMinutes(recipe.cookTime) });
  if (recipe.servings || recipe.yield) badgeItems.push({ icon: 'utensils', label: recipe.yield ? 'Makes' : 'Serves', value: String(recipe.yield || recipe.servings) });
  const kcal = recipe.nutritionInfo?.calories;
  if (kcal) badgeItems.push({ icon: 'flame', label: 'Calories', value: `~${Math.round(Number(kcal))}` });

  let badgesHtml = '';
  if (spec.badges && badgeItems.length) {
    const circle = pt(26);
    const cell = (b: typeof badgeItems[number]) => {
      const lead = spec.badgeStyle === 'circle'
        ? `<div style="width:${circle};height:${circle};border-radius:50%;background:${accent};display:flex;align-items:center;justify-content:center;flex-shrink:0;">${icon(b.icon, 14 * k, '#fff', 2.2)}</div>`
        : spec.badgeStyle === 'pill' ? '' : `<div style="flex-shrink:0;">${icon(b.icon, 15 * k, accent)}</div>`;
      const pill = spec.badgeStyle === 'pill' ? `background:${theme.badgeBg};border-radius:999px;padding:${pt(4)} ${pt(10)};` : '';
      return `<div style="display:flex;align-items:center;gap:${pt(6)};${pill}">
        ${lead}
        <div style="line-height:1.15;">
          <div style="font-size:${pt(7.5)};font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${muted};">${esc(b.label)}</div>
          <div style="font-size:${pt(10.5)};font-weight:700;color:${titleColor};">${esc(b.value)}</div>
        </div>
      </div>`;
    };
    const sep = spec.badgeStyle === 'circle' ? `<div style="width:1px;align-self:stretch;background:${theme.accentBorder};"></div>` : '';
    badgesHtml = `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:${pt(10)} ${pt(12)};margin-bottom:${pt(12)};">${badgeItems.map(cell).join(sep)}</div>`;
  }

  // --- Panels ---
  const heading = (text: string) => `<div style="display:flex;align-items:center;gap:${pt(8)};margin-bottom:${pt(6)};">
      <h3 style="font-family:${theme.titleFont};font-weight:700;font-size:${pt(15)};color:${titleColor};margin:0;white-space:nowrap;">${esc(text)}</h3>
      ${spec.headingRule ? `<div style="flex:1;height:1.5px;background:${accent};opacity:0.8;"></div>` : ''}
    </div>`;

  const marker = (() => {
    switch (spec.ingredientMarker) {
      case 'dot': return `<span style="width:${pt(5.5)};height:${pt(5.5)};border-radius:50%;background:${accent};flex-shrink:0;margin-top:${pt(4.2)};"></span>`;
      case 'check': return `<span style="flex-shrink:0;margin-top:${pt(1.5)};">${icon('check', 9.5 * k, accent, 3)}</span>`;
      case 'dash': return `<span style="flex-shrink:0;color:${accent};font-weight:700;">–</span>`;
      default: return '';
    }
  })();

  const ingredientsInner = recipe.ingredients.map((g) => {
    const h = g.heading ? `<div style="font-size:${pt(9)};font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${muted};margin:${pt(5)} 0 ${pt(2)};break-after:avoid;">${esc(g.heading)}</div>` : '';
    const items = g.items.map((it) => `<div style="display:flex;gap:${pt(6)};font-size:${pt(10)};line-height:1.4;color:${textColor};margin-bottom:${pt(2.5)};break-inside:avoid;">${marker}<span>${esc(it)}</span></div>`).join('');
    return h + items;
  }).join('');
  const ingredientCount = recipe.ingredients.reduce((n, g) => n + g.items.length, 0);
  // Stacked layout on narrow pages: split a long ingredient list into two columns
  const ingCols = !twoCol && ingredientCount > 6 ? `column-count:2;column-gap:${pt(14)};` : '';
  const ingredientsPanel = `<div style="background:${panelBg};border-radius:${radius};padding:${panelPad};">
      ${heading('Ingredients')}
      <div style="${ingCols}">${ingredientsInner}</div>
    </div>`;

  const stepLead = (i: number) => {
    if (spec.stepMarker === 'circle') {
      const d = pt(17);
      return `<span style="width:${d};height:${d};border-radius:50%;background:${accent};color:#fff;font-weight:700;font-size:${pt(9.5)};display:flex;align-items:center;justify-content:center;flex-shrink:0;">${i + 1}</span>`;
    }
    if (spec.stepMarker === 'number') return `<span style="font-family:${theme.titleFont};font-weight:700;font-size:${pt(12)};color:${accent};flex-shrink:0;min-width:${pt(14)};">${i + 1}.</span>`;
    return '';
  };
  const stepsInner = recipe.instructions.map((s, i) =>
    `<div style="display:flex;gap:${pt(8)};align-items:flex-start;margin-bottom:${pt(6)};break-inside:avoid;">${stepLead(i)}<span style="font-size:${pt(10)};line-height:1.45;color:${textColor};padding-top:${spec.stepMarker === 'circle' ? pt(1.5) : '0'};">${esc(s.text)}</span></div>`
  ).join('');
  const directionsPanel = `<div style="background:${panelBg};border-radius:${radius};padding:${panelPad};">
      ${heading('Directions')}
      ${stepsInner}
    </div>`;

  const bodyHtml = twoCol
    ? `<div style="display:grid;grid-template-columns:0.9fr 1.25fr;gap:${pt(12)};align-items:start;margin-bottom:${pt(12)};">${ingredientsPanel}${directionsPanel}</div>`
    : `<div style="display:flex;flex-direction:column;gap:${pt(10)};margin-bottom:${pt(12)};">${ingredientsPanel}${directionsPanel}</div>`;

  // --- Nutrition + tips ---
  const showNutrition = spec.nutritionBox && opts.showNutrition !== false;
  const showTips = spec.tipsBox && opts.showTips !== false;
  const nRows = showNutrition ? nutritionRows(recipe.nutritionInfo) : [];
  const tips = showTips
    ? (recipe.tips || []).map((t: any) => (typeof t === 'string' ? t : t?.text)).filter(Boolean).slice(0, wide ? 4 : 2) as string[]
    : [];

  const smallBox = (title: string, sub: string, inner: string) => `<div style="border:1px solid ${theme.accentBorder};border-radius:${radius};padding:${pt(8)} ${pt(11)};background:${boxed ? '#fff' : 'transparent'};">
      <div style="display:flex;align-items:baseline;gap:${pt(5)};border-bottom:1.5px solid ${accent};padding-bottom:${pt(3)};margin-bottom:${pt(5)};">
        <span style="font-family:${theme.titleFont};font-weight:700;font-size:${pt(12)};color:${titleColor};">${esc(title)}</span>
        ${sub ? `<span style="font-size:${pt(8.5)};color:${muted};">${esc(sub)}</span>` : ''}
      </div>
      ${inner}
    </div>`;

  // Narrow pages get one compact nutrition line instead of a full table
  const compactNutrition = !wide && nRows.length
    ? `<div style="font-size:${pt(8.5)};line-height:1.4;color:${textColor};border-top:1.5px solid ${accent};border-bottom:1px solid ${theme.accentBorder};padding:${pt(4)} 0;"><span style="font-family:${theme.titleFont};font-weight:700;color:${titleColor};">Nutrition</span> <span style="color:${muted};">per serving</span> &nbsp;${nRows.filter(([l]) => ['Calories', 'Protein', 'Carbohydrates', 'Fat'].includes(l)).map(([l, v]) => `<b style="color:${titleColor};">${esc(v)}</b> ${esc(l === 'Calories' ? 'cal' : l === 'Carbohydrates' ? 'carbs' : l.toLowerCase())}`).join(' &middot; ')}</div>`
    : '';
  const nutritionBox = compactNutrition || (nRows.length
    ? smallBox('Nutrition', recipe.servings ? '(per serving)' : '',
        `<div style="display:grid;grid-template-columns:1fr 1fr;column-gap:${pt(12)};row-gap:${pt(1.5)};">${nRows.map(([l, v]) =>
          `<div style="display:flex;justify-content:space-between;gap:${pt(6)};font-size:${pt(8.5)};line-height:1.35;"><span style="font-weight:600;color:${titleColor};">${esc(l)}:</span><span style="color:${textColor};">${esc(v)}</span></div>`).join('')}</div>`)
    : '');
  const tipsBox = tips.length
    ? smallBox('Recipe Tips', '',
        tips.map((t) => `<div style="display:flex;gap:${pt(6)};align-items:flex-start;font-size:${pt(8.5)};line-height:1.4;color:${textColor};margin-bottom:${pt(2.5)};">
          <span style="width:${pt(11)};height:${pt(11)};border-radius:50%;background:${accent};display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:${pt(0.5)};">${icon('check', 7.5 * k, '#fff', 3.2)}</span><span>${esc(t)}</span></div>`).join(''))
    : '';
  const extrasHtml = nutritionBox || tipsBox
    ? `<div style="display:grid;grid-template-columns:${nutritionBox && tipsBox && wide ? '1fr 1.1fr' : '1fr'};gap:${pt(10)};align-items:start;">${nutritionBox}${tipsBox}</div>`
    : '';

  const pageNumHtml = geo.pageNumber != null
    ? `<div style="text-align:center;font-size:${pt(8)};color:${theme.pageNum};margin-top:${pt(10)};">${geo.pageNumber}</div>`
    : '';

  // --- Assemble ---
  const topPhotoH = photoMode === 'top' ? Math.min(geo.heightIn * (wide ? 0.3 : 0.24), 3.2) : 0;
  const topPhoto = photoMode === 'top'
    ? `<div style="position:absolute;top:0;left:0;right:0;height:${topPhotoH}in;overflow:hidden;"><img src="${recipe.imageUrl}" style="width:100%;height:100%;object-fit:cover;display:block;" /></div>`
    : '';
  const contentTopIn = photoMode === 'top' ? topPhotoH + 0.22 : geo.padTopIn;
  const availHIn = geo.heightIn - contentTopIn - geo.padBottomIn;

  return `<div class="recipe-card" style="position:relative;width:${geo.widthIn}in;height:${geo.heightIn}in;background:${theme.bg};overflow:hidden;font-family:${theme.bodyFont};color:${textColor};">
    ${topPhoto}
    <div class="recipe-content" data-avail-h="${(availHIn * 96).toFixed(1)}" data-avail-w="${(availWIn * 96).toFixed(1)}" style="position:absolute;top:${contentTopIn}in;left:${geo.padLeftIn}in;width:${availWIn}in;">
      ${headerHtml}
      ${badgesHtml}
      ${bodyHtml}
      ${extrasHtml}
      ${opts.beforePageNumber || ''}
      ${pageNumHtml}
    </div>
  </div>`;
}
