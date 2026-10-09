import { apiRequest } from "@/lib/queryClient";
import type { FamilyPhotoEntry, PrintLayoutData } from "@shared/schema";

// Places family photos for the book as it's set up right now (size and
// template included, even before they're saved). Used by "Place photos" and
// automatically when the size or template changes, since that changes how
// much room each page has.

export interface BookSpecs {
  templateStyle: string;
  customTemplateId?: number | null;
  trimSize?: string;
  bindingType?: string;
}

export async function placePhotos(cookbookId: number, layoutData: PrintLayoutData, photos: FamilyPhotoEntry[], specs: BookSpecs) {
  const res = await apiRequest("POST", `/api/cookbooks/${cookbookId}/photos/place`, {
    layoutData: { ...layoutData, familyPhotos: photos },
    ...specs,
  });
  return res.json() as Promise<{ familyPhotos: FamilyPhotoEntry[]; placed: number; unplaced: number }>;
}

/**
 * Re-places every photo the person didn't place by hand (the dedication
 * photo and hand-picked album photos stay), for a new size or template.
 * Whatever no longer fits goes to the album, so no photo is dropped.
 */
export async function replacePhotosForBook(cookbookId: number, layoutData: PrintLayoutData, specs: BookSpecs) {
  const photos = (layoutData.familyPhotos ?? []).map((p) =>
    p.placement?.type === "dedication" || p.placement?.byUser ? p : { ...p, placement: undefined },
  );
  const r = await placePhotos(cookbookId, layoutData, photos, specs);
  const familyPhotos = r.familyPhotos.map((p) => (p.placement?.type === "unplaced" ? { ...p, placement: { type: "album" as const } } : p));
  const count = (t: string) => familyPhotos.filter((p) => p.placement?.type === t).length;
  return { familyPhotos, besideRecipes: count("recipe"), onSectionPages: count("section"), inAlbum: count("album") };
}
