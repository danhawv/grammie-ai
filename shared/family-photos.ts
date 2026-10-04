// Family photos in a printed cookbook. Photos only ever fill empty space left
// under a recipe; recipe text is never moved or shrunk for them. The planner
// below decides which photo goes on which recipe from measured gaps; the
// renderers (PDF + preview) then size each photo to whatever room is really
// there at render time, hiding it if a later edit took the room away.

import type { FamilyPhotoEntry } from './schema';
import type { ThemeConfig } from './template-theme';

/** Smallest photo worth printing in a gap, and the largest we'll make one */
export const MIN_PHOTO_IN = 1.5;
export const MAX_PHOTO_IN = 4.5;
/** Space between the recipe and the photo frame (px at 96/in) */
export const PHOTO_GAP_PX = 12;
/** Frame padding + border around the image (px), counted against the gap */
const FRAME_PX = 10;

export interface RecipeGap {
  recipeId: string;
  title: string;
  /** Empty height under the recipe's content, inches */
  freeHIn: number;
  /** Content width, inches */
  widthIn: number;
}

/** Largest size a photo of this shape can print at in a gap, or null if too small */
export function fitPhotoInGap(aspect: number, gap: RecipeGap): { hIn: number; wIn: number } | null {
  const usableH = gap.freeHIn - (PHOTO_GAP_PX + FRAME_PX * 2) / 96;
  const usableW = gap.widthIn - (FRAME_PX * 2) / 96;
  let h = Math.min(usableH, MAX_PHOTO_IN);
  let w = h * aspect;
  if (w > usableW) {
    w = usableW;
    h = w / aspect;
  }
  if (h < MIN_PHOTO_IN || w < MIN_PHOTO_IN * 0.8) return null;
  return { hIn: h, wIn: w };
}

/**
 * Assigns photos to recipe gaps. Album choices are kept; pinned photos go to
 * their recipe if it has room; the rest are spread through the book, each
 * gap taking the photo that fills it best (landscape photos for short wide
 * gaps, portrait for tall ones). Photos with nowhere to go come back
 * 'unplaced' with a reason.
 */
export function planFamilyPhotos(photos: FamilyPhotoEntry[], gaps: RecipeGap[]): FamilyPhotoEntry[] {
  const result = photos.map((p) => ({ ...p }));
  const taken = new Set<string>();
  const byId = new Map(gaps.map((g) => [g.recipeId, g]));

  // Pinned photos first
  for (const p of result) {
    if (p.placement?.type === 'album' || !p.pinnedRecipeId) continue;
    const gap = byId.get(p.pinnedRecipeId);
    if (gap && !taken.has(gap.recipeId) && fitPhotoInGap(p.width / p.height, gap)) {
      p.placement = { type: 'recipe', recipeId: gap.recipeId };
      taken.add(gap.recipeId);
    } else {
      p.placement = {
        type: 'unplaced',
        reason: gap
          ? taken.has(gap.recipeId)
            ? `Another photo is already on "${gap.title}"`
            : `Not enough room under "${gap.title}"`
          : 'That recipe is no longer in the book',
      };
    }
  }

  const pool = result.filter((p) => p.placement?.type !== 'album' && !p.pinnedRecipeId);
  const eligible = gaps.filter((g) => !taken.has(g.recipeId) && pool.some((p) => fitPhotoInGap(p.width / p.height, g)));

  // Spread photos evenly when there are more gaps than photos
  let chosen = eligible;
  if (pool.length > 0 && pool.length < eligible.length) {
    const step = eligible.length / pool.length;
    chosen = Array.from({ length: pool.length }, (_, i) => eligible[Math.floor(i * step + step / 2)]);
  }

  const remaining = new Set(pool);
  for (const gap of chosen) {
    let best: FamilyPhotoEntry | null = null;
    let bestScore = 0;
    remaining.forEach((p) => {
      const fit = fitPhotoInGap(p.width / p.height, gap);
      if (!fit) return;
      const score = (fit.hIn * fit.wIn) / (Math.max(gap.freeHIn, 0.01) * gap.widthIn);
      if (score > bestScore) { best = p; bestScore = score; }
    });
    if (best) {
      (best as FamilyPhotoEntry).placement = { type: 'recipe', recipeId: gap.recipeId };
      remaining.delete(best);
      taken.add(gap.recipeId);
    }
  }
  remaining.forEach((p) => {
    p.placement = { type: 'unplaced', reason: 'No recipe page has enough room left' };
  });

  return result;
}

/** Photo frame inserted (hidden) into a recipe's content; sized at render time */
export function familyPhotoSlotHtml(src: string, theme: ThemeConfig): string {
  const radius = theme.recipeLayout ? `${Math.min(theme.recipeLayout.cornerRadius, 10)}px` : (theme.imageRadius || '3px');
  return `<div class="family-photo-slot" data-min-h="${MIN_PHOTO_IN * 96}" data-max-h="${MAX_PHOTO_IN * 96}" style="display:none;box-sizing:border-box;height:0;padding-top:${PHOTO_GAP_PX}px;text-align:center;break-inside:avoid;">
    <span style="display:inline-block;height:100%;max-width:100%;box-sizing:border-box;padding:${FRAME_PX - 1}px;background:#fff;border:1px solid ${theme.accentBorder};border-radius:${radius};box-shadow:0 1px 4px rgba(0,0,0,0.12);">
      <img src="${src}" style="display:block;height:100%;width:auto;max-width:100%;object-fit:cover;object-position:center 35%;border-radius:${radius};" />
    </span>
  </div>`;
}

/**
 * Sizes every .family-photo-slot to the empty space below its recipe. `scale`
 * is screen px per page px (1 in the PDF; the preview's zoom on screen).
 * Written without named inner functions so it can be passed to the PDF
 * renderer as source text.
 */
export function fitFamilyPhotoSlots(root: ParentNode, scale: number): void {
  root.querySelectorAll('.family-photo-slot').forEach((el) => {
    const slot = el as HTMLElement;
    const content = slot.closest('.recipe-content') as HTMLElement | null;
    if (!content) return;
    const availH = parseFloat(content.getAttribute('data-avail-h') || '0');
    const minH = parseFloat(slot.getAttribute('data-min-h') || '144');
    const maxH = parseFloat(slot.getAttribute('data-max-h') || '432');

    slot.style.display = 'none';
    const box = content.getBoundingClientRect();
    const free = (box.top + availH * scale - box.bottom) / scale;

    // How many page px one CSS px of slot height becomes (content may be zoomed)
    slot.style.display = 'block';
    slot.style.height = '100px';
    const per = (content.getBoundingClientRect().height - box.height) / scale / 100;
    if (!(per > 0)) { slot.style.display = 'none'; return; }

    const room = Math.min(free, maxH + 40);
    if (room < minH + 30) { slot.style.display = 'none'; return; }
    slot.style.height = `${Math.floor(room / per) - 1}px`;
  });
}

export interface AlbumPhoto {
  src: string;
  aspect: number;
}

/** Up to four photos per Family Album page */
export function chunkAlbum<T>(photos: T[]): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < photos.length; i += 4) pages.push(photos.slice(i, i + 4));
  return pages;
}

export interface AlbumGeometry {
  widthIn: number;
  heightIn: number;
  padTopIn: number;
  padBottomIn: number;
  padLeftIn: number;
  padRightIn: number;
  pageNumber?: number;
}

/** One Family Album page: 1-4 photos in a simple grid, framed like the recipe photos */
export function buildAlbumPageHtml(photos: AlbumPhoto[], theme: ThemeConfig, geo: AlbumGeometry): string {
  const radius = theme.recipeLayout ? `${Math.min(theme.recipeLayout.cornerRadius, 10)}px` : (theme.imageRadius || '3px');
  // Explicit tracks: auto-sized tracks let one photo's natural size take over the page
  const sideBySide = photos.length === 2 && photos.every((p) => p.aspect < 1);
  // Single-quoted: these go inside a double-quoted style attribute
  const [areas, cols, rows] = photos.length === 1 ? [`'a'`, '1fr', '1fr']
    : photos.length === 2 ? (sideBySide ? [`'a b'`, '1fr 1fr', '1fr'] : [`'a' 'b'`, '1fr', '1fr 1fr'])
    : photos.length === 3 ? [`'a a' 'b c'`, '1fr 1fr', '1.2fr 1fr']
    : [`'a b' 'c d'`, '1fr 1fr', '1fr 1fr'];
  const cells = photos.map((p, i) => `<div style="grid-area:${'abcd'[i]};min-height:0;min-width:0;box-sizing:border-box;padding:7px;background:#fff;border:1px solid ${theme.accentBorder};border-radius:${radius};box-shadow:0 1px 4px rgba(0,0,0,0.12);">
      <img src="${p.src}" style="display:block;width:100%;height:100%;object-fit:cover;object-position:center 35%;border-radius:${radius};" />
    </div>`).join('');
  const numH = geo.pageNumber != null ? 0.3 : 0;
  return `<div style="position:relative;width:${geo.widthIn}in;height:${geo.heightIn}in;background:${theme.bg};overflow:hidden;">
    <div style="position:absolute;top:${geo.padTopIn}in;left:${geo.padLeftIn}in;right:${geo.padRightIn}in;bottom:${geo.padBottomIn + numH}in;display:grid;grid-template-areas:${areas};grid-template-columns:${cols};grid-template-rows:${rows};gap:0.18in;">${cells}</div>
    ${geo.pageNumber != null ? `<div style="position:absolute;left:0;right:0;bottom:${geo.padBottomIn}in;text-align:center;font-size:8pt;color:${theme.pageNum};font-family:${theme.bodyFont};">${geo.pageNumber}</div>` : ''}
  </div>`;
}

export const FAMILY_ALBUM_TITLE = 'Family Album';
