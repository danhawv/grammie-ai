// How well food data covers the real recipes: share of ingredient lines
// matched to a canonical ingredient and converted to grams, recipes by
// confidence and source, and USDA-computed vs stored AI macros. Read-only.
//   npx tsx scripts/meal-prep/report-coverage.ts [snapshot.json] [--worst]
import { seedCatalog } from "../../server/meal-prep/food/catalog";
import { computeRecipeFacts } from "../../server/meal-prep/food/facts";
import { recipeInputFromRow } from "../../server/meal-prep/food/index";
import { loadRecipeRows } from "./load-recipes";

const args = process.argv.slice(2);
const rows = await loadRecipeRows(args.find((a) => !a.startsWith("--")));
const catalog = seedCatalog();
const facts = rows.map((r) => computeRecipeFacts(recipeInputFromRow(r), catalog));
const pct = (n: number, d: number) => `${(100 * n / Math.max(d, 1)).toFixed(1)}%`;

let lines = 0, mapped = 0, grams = 0, toTaste = 0;
const lineConf: Record<string, number> = { high: 0, medium: 0, low: 0 };
for (const f of facts) for (const l of f.lines) {
  lines++;
  if (l.ingredient) mapped++;
  if (l.ingredient && l.grams != null) grams++;
  if (l.ingredient && l.grams == null && /to taste|as needed|garnish|for serving/i.test(l.raw)) toTaste++;
  lineConf[l.confidence]++;
}
const by = (k: (f: typeof facts[number]) => string) => facts.reduce((m, f) => (m[k(f)] = (m[k(f)] ?? 0) + 1, m), {} as Record<string, number>);
console.log(`Recipes: ${facts.length}   Ingredient lines: ${lines}`);
console.log(`Lines matched to a canonical ingredient: ${mapped} (${pct(mapped, lines)})`);
console.log(`Lines matched AND converted to grams:   ${grams} (${pct(grams, lines)}); "to taste"/garnish lines without an amount: ${toTaste}`);
console.log(`Line confidence: ${Object.entries(lineConf).map(([k, v]) => `${k} ${pct(v, lines)}`).join(", ")}`);
console.log(`Recipe confidence: ${Object.entries(by((f) => f.confidence)).map(([k, v]) => `${k} ${v} (${pct(v, facts.length)})`).join(", ")}`);
console.log(`Nutrition source: ${Object.entries(by((f) => f.nutritionSource)).map(([k, v]) => `${k} ${v} (${pct(v, facts.length)})`).join(", ")}`);
const computed = facts.filter((f) => f.nutritionSource !== "ai_estimate" && f.nutritionCheck?.aiPerServing);
const dis = computed.filter((f) => f.nutritionCheck!.disagreesWithAi);
console.log(`Computed recipes where USDA and AI kcal differ >25%: ${dis.length} of ${computed.length} (${pct(dis.length, computed.length)})`);

const fmt = (m: any) => `${String(m.kcal).padStart(4)} kcal ${String(m.protein).padStart(5)}P ${String(m.carbs).padStart(5)}C ${String(m.fat).padStart(5)}F`;
const sample = args.includes("--worst")
  ? [...dis].sort((a, b) => Math.abs(b.perServing.kcal / b.nutritionCheck!.aiPerServing!.kcal - 1) - Math.abs(a.perServing.kcal / a.nutritionCheck!.aiPerServing!.kcal - 1)).slice(0, 25)
  : computed.filter((_, i) => i % Math.floor(computed.length / 10) === 0).slice(0, 10);
console.log(`\n${args.includes("--worst") ? "Largest disagreements" : "Examples"} (per serving): USDA-computed vs stored AI`);
for (const f of sample) {
  console.log(`${f.title.slice(0, 44).padEnd(44)} x${String(f.servings).padEnd(3)} ${f.confidence.padEnd(6)} USDA ${fmt(f.perServing)} | AI ${fmt(f.nutritionCheck!.aiPerServing)}${f.nutritionCheck!.disagreesWithAi ? "  *" : ""}`);
}
