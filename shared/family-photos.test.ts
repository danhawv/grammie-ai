import { describe, it, expect } from 'vitest';
import { planFamilyPhotos, fitPhotoInGap, buildAlbumPageHtml, type RecipeGap } from './family-photos';
import { CARD_THEME } from './recipe-card';
import type { FamilyPhotoEntry } from './schema';

const gap = (recipeId: string, freeHIn: number, widthIn = 4.8): RecipeGap => ({ recipeId, title: recipeId.toUpperCase(), freeHIn, widthIn });
const photo = (id: string, w: number, h: number, extra: Partial<FamilyPhotoEntry> = {}): FamilyPhotoEntry => ({ id, width: w, height: h, ...extra });

describe('fitPhotoInGap', () => {
  it('rejects gaps too small for a printable photo', () => {
    expect(fitPhotoInGap(1.5, gap('a', 1.2))).toBeNull();
  });
  it('limits size to the gap and to the page width', () => {
    const f = fitPhotoInGap(3, gap('a', 6, 4.8))!;
    expect(f.wIn).toBeLessThanOrEqual(4.8);
    expect(f.hIn).toBeCloseTo(f.wIn / 3, 5);
  });
});

describe('planFamilyPhotos', () => {
  it('only uses gaps with room and reports the rest as unplaced', () => {
    const out = planFamilyPhotos([photo('p1', 1600, 1200), photo('p2', 1600, 1200), photo('p3', 1600, 1200)], [gap('a', 3), gap('b', 0.4), gap('c', 2.5)]);
    const placed = out.filter((p) => p.placement?.type === 'recipe').map((p) => p.placement!.recipeId).sort();
    expect(placed).toEqual(['a', 'c']);
    const left = out.find((p) => p.placement?.type === 'unplaced')!;
    expect(left.placement!.reason).toMatch(/room/);
  });

  it('never puts two photos on one recipe', () => {
    const out = planFamilyPhotos([photo('p1', 4, 3), photo('p2', 4, 3)], [gap('a', 6)]);
    expect(out.filter((p) => p.placement?.recipeId === 'a')).toHaveLength(1);
  });

  it('prefers landscape photos for short wide gaps', () => {
    const out = planFamilyPhotos([photo('tall', 900, 1600), photo('wide', 1600, 900)], [gap('short', 2.3)]);
    expect(out.find((p) => p.id === 'wide')!.placement).toEqual({ type: 'recipe', recipeId: 'short' });
  });

  it('honors pins and explains a pin that cannot fit', () => {
    const out = planFamilyPhotos(
      [photo('p1', 4, 3, { pinnedRecipeId: 'b' }), photo('p2', 4, 3, { pinnedRecipeId: 'tiny' })],
      [gap('a', 4), gap('b', 4), gap('tiny', 0.5)],
    );
    expect(out[0].placement).toEqual({ type: 'recipe', recipeId: 'b' });
    expect(out[1].placement).toMatchObject({ type: 'unplaced', reason: 'Not enough room under "TINY"' });
  });

  it('keeps already-placed photos where they are on a re-run', () => {
    const gaps = [gap('a', 3), gap('b', 3), gap('c', 3)];
    const first = planFamilyPhotos([photo('p1', 4, 3), photo('p2', 4, 3)], gaps);
    const again = planFamilyPhotos([...first, photo('p3', 4, 3)], gaps);
    expect(again[0].placement).toEqual(first[0].placement);
    expect(again[1].placement).toEqual(first[1].placement);
    expect(again[2].placement?.type).toBe('recipe');
  });

  it('moves a placed photo off a recipe that lost its room', () => {
    const out = planFamilyPhotos([photo('p1', 4, 3, { placement: { type: 'recipe', recipeId: 'a' } })], [gap('a', 0.3), gap('b', 3)]);
    expect(out[0].placement).toEqual({ type: 'recipe', recipeId: 'b' });
  });

  it('leaves album photos in the album', () => {
    const out = planFamilyPhotos([photo('p1', 4, 3, { placement: { type: 'album' } })], [gap('a', 4)]);
    expect(out[0].placement).toEqual({ type: 'album' });
  });

  it('spreads a few photos across many gaps instead of bunching them up front', () => {
    const gaps = Array.from({ length: 10 }, (_, i) => gap(`r${i}`, 3));
    const out = planFamilyPhotos([photo('p1', 4, 3), photo('p2', 4, 3)], gaps);
    const ids = out.map((p) => p.placement!.recipeId);
    expect(ids).not.toContain('r0');
    expect(new Set(ids).size).toBe(2);
  });
});

describe('buildAlbumPageHtml', () => {
  it('keeps the grid layout inside a valid style attribute', () => {
    const html = buildAlbumPageHtml(
      [1, 2, 3, 4].map(() => ({ src: 'data:image/jpeg;base64,AA', aspect: 1.5 })),
      CARD_THEME,
      { widthIn: 6.25, heightIn: 9.25, padTopIn: 0.6, padBottomIn: 0.6, padLeftIn: 0.8, padRightIn: 0.6, pageNumber: 40 },
    );
    const styles = html.match(/style="[^"]*"/g) || [];
    expect(styles.some((s) => s.includes("grid-template-areas:'a b' 'c d'") && s.includes('grid-template-rows:1fr 1fr'))).toBe(true);
    expect(html.match(/<img /g)).toHaveLength(4);
  });
});
