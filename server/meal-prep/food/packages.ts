// Common US grocery package sizes, hand-curated (data/packages.json), so the
// shopping list can say "1 bag (2 lb)" instead of "907 g". Smallest first.
// Prices are left out until we have a real price source.

import packagesSeed from "./data/packages.json";

type Package = { label: string; grams: number; price?: number };
const PACKAGES = packagesSeed as unknown as Record<string, Array<[string, number]>>;

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
