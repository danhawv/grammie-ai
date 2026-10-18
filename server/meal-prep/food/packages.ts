// Common US grocery package sizes, hand-curated (data/packages.json), so the
// shopping list can say "1 bag (2 lb)" instead of "907 g". Smallest first.
// Prices are left out until we have a real price source.

import { PROTEIN_SHAKES, shakeAdjusterId } from "@shared/meal-prep/shakes";
import packagesSeed from "./data/packages.json";

type Package = { label: string; grams: number; price?: number };
const PACKAGES: Record<string, Array<[string, number]>> = {
  ...(packagesSeed as unknown as Record<string, Array<[string, number]>>),
  // Bottled shakes come singly, in 4-packs and 12-packs
  ...Object.fromEntries(PROTEIN_SHAKES.map((s) => [shakeAdjusterId(s.id), [
    [`1 bottle (${s.flOz} fl oz)`, s.grams], [`4-pack (${s.flOz} fl oz bottles)`, s.grams * 4], [`12-pack (${s.flOz} fl oz bottles)`, s.grams * 12],
  ] as Array<[string, number]>])),
};

export function packagesFor(ids: string[]): Record<string, Package[]> {
  const out: Record<string, Package[]> = {};
  for (const id of ids) {
    out[id] = (PACKAGES[id] ?? []).map(([label, grams]) => ({ label, grams })).sort((a, b) => a.grams - b.grams);
  }
  return out;
}

export function allPackageIds(): string[] {
  return Object.keys(PACKAGES);
}
