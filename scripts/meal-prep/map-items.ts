// Builds server/meal-prep/food/data/item-map.json: every distinct ingredient
// name in the recipes -> canonical id, with how it was matched and how sure we
// are. Exact and normalized matches are taken as is; weaker matches and misses
// go to the AI with a shortlist of 10 candidates (answers cached in CACHE, so
// re-runs cost nothing). Reads recipes read-only.
//   GEMINI_API_KEY=... npx tsx scripts/meal-prep/map-items.ts <ai-cache.json> [snapshot.json]
import fs from "fs";
import path from "path";
import { Catalog, type CatalogIngredient, type ItemMapEntry } from "../../server/meal-prep/food/catalog";
import { pickIngredientsWithAI, type PickRequest } from "../../server/meal-prep/food/ai-match";
import ingredients from "../../server/meal-prep/food/data/ingredients.json";
import { loadRecipeRows } from "./load-recipes";

const [cacheFile, snapshot] = process.argv.slice(2);
if (!cacheFile) throw new Error("usage: map-items.ts <ai-cache.json> [snapshot.json]");
if (!process.env.GEMINI_API_KEY && fs.existsSync(".env")) process.loadEnvFile(".env");
const cache: Record<string, string | null> = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};

// The matcher alone, without a previous item map
const catalog = new Catalog(ingredients as CatalogIngredient[], []);
const rows = await loadRecipeRows(snapshot);
const items = new Map<string, { n: number; example: string }>();
for (const r of rows) for (const l of r.normalized_ingredients ?? []) {
  const key = String(l?.item ?? "").toLowerCase().trim();
  if (!key) continue;
  const e = items.get(key) ?? { n: 0, example: l.raw ?? "" };
  e.n++;
  items.set(key, e);
}

const entries: ItemMapEntry[] = [];
const ask: PickRequest[] = [];
const det = new Map<string, ReturnType<Catalog["matcher"]["match"]>>();
for (const [item, { example }] of items) {
  const m = catalog.matcher.match(item);
  det.set(item, m);
  if (m && (m.method === "exact" || m.method === "normalized")) {
    entries.push({ item, id: m.id, confidence: Math.round(m.score * 100) / 100, method: m.method });
    continue;
  }
  const cands = catalog.matcher.candidates(item, 10).map((c) => c.id);
  if (m && !cands.includes(m.id)) cands.unshift(m.id);
  ask.push({ item, example, candidates: cands.slice(0, 10).map((id) => ({ id, name: catalog.byId.get(id)!.name })) });
}

const todo = ask.filter((a) => !(a.item in cache));
console.log(`${items.size} names: ${entries.length} matched directly, ${ask.length} for the AI (${todo.length} not cached)`);
for (let i = 0; i < todo.length; i += 40) {
  const batch = todo.slice(i, i + 40);
  const picks = await pickIngredientsWithAI(batch);
  for (const p of picks) cache[p.item] = p.id;
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
  console.log(`  AI ${Math.min(i + 40, todo.length)}/${todo.length}`);
}

// Hand review of the AI's answers (item -> canonical id, or null for "not food / too vague")
const MANUAL: Record<string, string | null> = {
  "protein of choice": null,
  "meat": null,
  "habanero": "chili-fresh",
  "french onion rings": "onion-powder", // canned fried onions, filed with onion flakes
  "diced tomatoes with green chilies (ro*tel style)": "tomatoes-canned",
  "low carb tortilla": "tortilla-whole-wheat",
  "chex cereal": "granola",
  "tenderloin": "beef-steak", // "12 oz. t'loin" in Mongolian Beef
};

for (const a of ask) {
  if (a.item in MANUAL) {
    const id = MANUAL[a.item];
    entries.push({ item: a.item, id, confidence: id ? 0.9 : 0, method: id ? "manual" : "none" });
    continue;
  }
  const aiId = cache[a.item] ?? null;
  const m = det.get(a.item);
  if (!aiId) entries.push({ item: a.item, id: null, confidence: 0, method: "none" });
  // AI agreeing with the matcher is stronger than either alone
  else entries.push({ item: a.item, id: aiId, confidence: m?.id === aiId ? 0.85 : 0.75, method: "ai" });
}

entries.sort((a, b) => a.item.localeCompare(b.item));
const file = path.resolve(import.meta.dirname, "../../server/meal-prep/food/data/item-map.json");
fs.writeFileSync(file, "[\n" + entries.map((e) => "  " + JSON.stringify(e)).join(",\n") + "\n]\n");
const lines = [...items.values()].reduce((s, e) => s + e.n, 0);
const mapped = entries.filter((e) => e.id).reduce((s, e) => s + items.get(e.item)!.n, 0);
console.log(`${entries.filter((e) => e.id).length}/${entries.length} names mapped; ${mapped}/${lines} lines (${(mapped / lines * 100).toFixed(1)}%) -> ${file}`);
