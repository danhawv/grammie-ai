// Writes shared/meal-prep/fixtures/recipe-facts.json (~25 real recipes'
// facts, a spread of meals, proteins and confidence levels) and
// adjusters.json, so the planner, session and screens can be built and
// tested without the database.
//   npx tsx scripts/meal-prep/make-fixtures.ts [snapshot.json]
import fs from "fs";
import path from "path";
import type { RecipeFacts } from "../../shared/meal-prep/contract";
import { seedCatalog } from "../../server/meal-prep/food/catalog";
import { computeRecipeFacts } from "../../server/meal-prep/food/facts";
import { buildAdjusters } from "../../server/meal-prep/food/adjusters";
import { recipeInputFromRow } from "../../server/meal-prep/food/index";
import { loadRecipeRows } from "./load-recipes";

const rows = await loadRecipeRows(process.argv[2]);
const catalog = seedCatalog();
const all = rows.filter((r) => r.normalized_ingredients?.length).map((r) => computeRecipeFacts(recipeInputFromRow(r), catalog));

// Deterministic pick: by slot and protein, preferring well-matched recipes, plus a few hard cases
const picked = new Map<string, RecipeFacts>();
const take = (pred: (f: RecipeFacts) => boolean, n: number) => {
  const pool = all.filter((f) => !picked.has(f.recipeId) && pred(f))
    .sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
  for (const f of pool.slice(0, n)) picked.set(f.recipeId, f);
};
const rank = (f: RecipeFacts) => ({ high: 0, medium: 1, low: 2 }[f.confidence]) + (f.nutritionCheck?.disagreesWithAi ? 0.5 : 0);
const main = (f: RecipeFacts) => f.mealTypes.includes("dinner") && f.perServing.kcal >= 250 && f.perServing.kcal <= 900 && f.servings >= 2 && f.servings <= 10;
for (const p of ["chicken", "beef", "pork", "fish", "shellfish", "turkey", "beans", "eggs"]) take((f) => main(f) && f.mainProtein === p, p === "chicken" ? 4 : p === "beef" ? 2 : 1);
take((f) => main(f) && f.mainProtein == null, 2);
take((f) => f.mealTypes.includes("breakfast") && f.perServing.kcal >= 150, 3);
take((f) => f.mealTypes.includes("lunch") && !f.mealTypes.includes("dinner"), 2);
take((f) => f.mealTypes.length === 1 && f.mealTypes[0] === "snack" && f.perServing.kcal < 400, 3);
take((f) => f.component === "sauce", 1);
take((f) => f.confidence === "low", 1);
take((f) => main(f) && f.confidence === "medium" && !!f.nutritionCheck?.disagreesWithAi, 1);
take((f) => main(f) && f.storage.freezerDays == null, 1);

const out = [...picked.values()];
const dir = path.resolve(import.meta.dirname, "../../shared/meal-prep/fixtures");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "recipe-facts.json"), JSON.stringify(out, null, 1) + "\n");
fs.writeFileSync(path.join(dir, "adjusters.json"), JSON.stringify(buildAdjusters(catalog), null, 1) + "\n");
console.log(`${out.length} recipe facts, from ${all.length} recipes`);
for (const f of out) console.log(`${f.confidence.padEnd(6)} ${f.nutritionSource.padEnd(11)} ${String(f.perServing.kcal).padStart(4)} kcal ${(f.mainProtein ?? "-").padEnd(9)} ${f.mealTypes.join(",").padEnd(20)} ${f.title}`);
