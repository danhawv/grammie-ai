// Builds server/meal-prep/food/data/ingredients.json from catalog-spec.ts and
// the USDA extract (see usda-extract.ts). Prints every chosen USDA food so a
// wrong pick is easy to spot; fails on duplicate aliases.
//   npx tsx scripts/meal-prep/build-catalog.ts <usda-compact.json>
import fs from "fs";
import path from "path";
import { CATALOG_SPEC } from "./catalog-spec";
import type { CatalogIngredient } from "../../server/meal-prep/food/catalog";
import type { PortionKey } from "../../server/meal-prep/food/units";

interface UsdaFood {
  fdcId: number; source: "sr" | "foundation"; description: string;
  kcal: number | null; protein: number | null; carbs: number | null; fat: number | null; fiber: number | null;
  portions: Array<{ amount: number; unit: string; modifier: string; grams: number }>;
}

const [extract] = process.argv.slice(2);
if (!extract) throw new Error("usage: build-catalog.ts <usda-compact.json>");
const foods: UsdaFood[] = JSON.parse(fs.readFileSync(extract, "utf8"));
// SR Legacy first: its household portions are far more complete than Foundation's
const byDesc = new Map<string, UsdaFood>();
for (const f of [...foods].sort((a, b) => (a.source === b.source ? 0 : a.source === "sr" ? 1 : -1))) byDesc.set(f.description.toLowerCase(), f);

function findFood(query: string): UsdaFood | null {
  const exact = byDesc.get(query.toLowerCase());
  if (exact) return exact;
  const words = query.toLowerCase().split(/[\s,]+/).filter(Boolean);
  const hits = foods.filter((f) => words.every((w) => f.description.toLowerCase().includes(w)));
  hits.sort((a, b) => (a.source === b.source ? 0 : a.source === "sr" ? -1 : 1) || a.description.length - b.description.length);
  return hits[0] ?? null;
}

const VOLUME: Record<string, number> = { cup: 1, tbsp: 1 / 16, tablespoon: 1 / 16, tsp: 1 / 48, teaspoon: 1 / 48, "fl oz": 1 / 8 };

/** USDA household portions -> grams per cup and per piece/size/clove... */
function portionsOf(f: UsdaFood): { cup: number | null; portions: Partial<Record<PortionKey, number>> } {
  let cup: number | null = null;
  const portions: Partial<Record<PortionKey, number>> = {};
  const set = (k: PortionKey, g: number) => { if (portions[k] == null) portions[k] = Math.round(g * 10) / 10; };
  for (const p of f.portions) {
    const mod = p.modifier.toLowerCase();
    const unit = (p.unit || mod.split(/[\s,(]/)[0]).toLowerCase();
    const per = p.grams / (p.amount || 1);
    // Volume: unit column (Foundation) or first word of the modifier (SR Legacy)
    const vol = VOLUME[unit] ?? (mod.startsWith("fl oz") ? VOLUME["fl oz"] : undefined);
    if (vol && cup == null && !/pureed|mashed|sifted|unsifted|melted|whipped|packed/.test(mod)) { cup = per / vol; continue; }
    if (vol) continue;
    if (/^(small|medium|large|extra large|jumbo)\b/.test(mod) && !/slice|spear|stalk|leaf|wedge|floweret|floret/.test(mod)) {
      const size = mod.startsWith("small") ? "small" : mod.startsWith("medium") ? "medium" : "large";
      set(size, per);
      continue;
    }
    if (/^cloves?\b/.test(mod)) set("clove", per);
    else if (/^slices?\b/.test(mod) && !/thin|thick/.test(mod)) set("slice", per);
    else if (/^slice/.test(mod)) set("slice", per);
    else if (/^stick/.test(mod)) set("stick", per);
    else if (/^(stalk|rib|spear)/.test(mod)) set("stalk", per);
    else if (/^head/.test(mod)) set("head", per);
    else if (/^(sprig)/.test(mod)) set("sprig", per);
    else if (/^(leaf|leaves)/.test(mod)) set("leaf", per);
    else if (/^(fillet|filet)/.test(mod)) set("fillet", per);
    else if (/yield|juice of/.test(mod) && /(lemon|lime|orange)/.test(mod)) set("juice", per);
    else if (/^(fruit|whole|each|item|egg|breast|thigh|wing|drumstick|pepper|onion|potato|tomato|carrot|avocado|banana|apple|nlea serving|bulb|ear|tortilla|pita|bagel|muffin|roll|bun|link|patty|sausage|piece|strip|cookie|cracker|sheet|shrimp|scallop|olive|date|nut|kernel|serving packet|packet|envelope|cube|tsp|bar)/.test(mod)) set("piece", per);
  }
  // "1 onion" means a medium one
  if (portions.medium != null) portions.piece = portions.medium;
  return { cup: cup ? Math.round(cup * 10) / 10 : null, portions };
}

const seenAlias = new Map<string, string>();
const out: CatalogIngredient[] = [];
const report: string[] = [];
let failed = false;
for (const [id, name, aisle, query, aliasStr, opts = {}] of CATALOG_SPEC) {
  const aliases = aliasStr.split("|").map((a) => a.trim().toLowerCase()).filter(Boolean);
  for (const a of aliases) {
    if (seenAlias.has(a) && seenAlias.get(a) !== id) { console.error(`duplicate alias "${a}": ${seenAlias.get(a)} and ${id}`); failed = true; }
    seenAlias.set(a, id);
  }
  if (out.some((o) => o.id === id)) { console.error(`duplicate id ${id}`); failed = true; }
  let food: UsdaFood | null = null;
  if (query) {
    food = findFood(query);
    if (!food) { console.error(`no USDA food for ${id}: "${query}"`); failed = true; continue; }
  }
  const r1 = (n: number | null | undefined) => Math.round((n ?? 0) * 100) / 100;
  const per100g = opts.m
    ? { kcal: opts.m[0], protein: opts.m[1], carbs: opts.m[2], fat: opts.m[3], fiber: opts.m[4] ?? 0 }
    : { kcal: r1(food!.kcal), protein: r1(food!.protein), carbs: r1(food!.carbs), fat: r1(food!.fat), fiber: r1(food!.fiber) };
  const { cup, portions } = food ? portionsOf(food) : { cup: null, portions: {} };
  if (opts.piece != null) { portions.piece = opts.piece; if (portions.medium == null) portions.medium = opts.piece; }
  Object.assign(portions, opts.por ?? {});
  // "Juice of 1 lemon" arrives as 1 piece of lemon juice
  if (portions.juice != null && portions.piece == null) portions.piece = portions.juice;
  // A fish "fillet" in a recipe is a portion fillet, not USDA's half-side
  if (opts.p === "fish" && portions.piece != null) portions.fillet = portions.piece;
  out.push({
    id, name, aisle,
    fdcId: opts.m ? null : food!.fdcId,
    usdaDescription: opts.m ? null : food!.description,
    source: opts.m ? "label" : food!.source === "sr" ? "usda-sr" : "usda-foundation",
    per100g,
    cup: opts.cup ?? cup,
    portions,
    pack: opts.can ?? null,
    allergens: opts.a ?? [],
    protein: opts.p ?? null,
    cooked: !!opts.cooked,
    aliases,
  });
  report.push(`${id.padEnd(26)} ${opts.m ? "(label data)" : `${food!.fdcId} ${food!.description}`}  kcal ${per100g.kcal} cup ${opts.cup ?? cup ?? "-"} ${JSON.stringify(portions)}`);
}
if (failed) process.exit(1);

// One ingredient per line keeps diffs reviewable
const file = path.resolve(import.meta.dirname, "../../server/meal-prep/food/data/ingredients.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, "[\n" + out.map((o) => "  " + JSON.stringify(o)).join(",\n") + "\n]\n");
console.log(report.join("\n"));
console.log(`\n${out.length} ingredients, ${seenAlias.size} aliases -> ${file}`);
