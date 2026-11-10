import type { Recipe } from "@shared/schema";

// Which pictures the recipe page shows and in what order. The handwritten
// card (recipe.handwrittenImage) is kept in dishImages as a non-AI entry, but
// the page wants it second: the dish photo first, then the card, then any
// other photos. This is display order only; the stored order is untouched.

export interface HeroImage {
  id: string;
  url: string;
  thumbnailUrl?: string;
  isAiGenerated: boolean;
  /** The original handwritten card */
  isCard: boolean;
}

type ImageFields = Pick<Recipe, "dishImages" | "handwrittenImage">;

/** The dishImages entry that is the card: the same picture, or the first non-AI entry (where uploads put it) */
export function findCardImage(recipe: ImageFields): NonNullable<Recipe["dishImages"]>[number] | null {
  if (!recipe.handwrittenImage) return null;
  const list = [...(recipe.dishImages ?? [])].sort((a, b) => a.order - b.order);
  return list.find((img) => !img.isAiGenerated && img.url === recipe.handwrittenImage) ?? list.find((img) => !img.isAiGenerated) ?? null;
}

/**
 * The images for the hero carousel and the full-screen viewer, dish photo
 * first and the card second. `fallbackImage` is the single dish photo for
 * recipes saved before dishImages existed.
 */
export function heroImages(recipe: ImageFields, fallbackImage: string | null): HeroImage[] {
  const sorted = [...(recipe.dishImages ?? [])].sort((a, b) => a.order - b.order);
  const cardEntry = findCardImage(recipe);
  const card: HeroImage | null = recipe.handwrittenImage
    ? cardEntry
      ? { id: cardEntry.id, url: cardEntry.url, thumbnailUrl: cardEntry.thumbnailUrl, isAiGenerated: false, isCard: true }
      : { id: "handwritten", url: recipe.handwrittenImage, isAiGenerated: false, isCard: true }
    : null;

  const photos: HeroImage[] = sorted
    .filter((img) => img.id !== cardEntry?.id)
    .map((img) => ({ id: img.id, url: img.url, thumbnailUrl: img.thumbnailUrl, isAiGenerated: img.isAiGenerated, isCard: false }));
  if (photos.length === 0 && fallbackImage && fallbackImage !== card?.url) {
    photos.push({ id: "legacy", url: fallbackImage, isAiGenerated: true, isCard: false });
  }

  if (!card) return photos;
  if (photos.length === 0) return [card];
  return [photos[0], card, ...photos.slice(1)];
}
