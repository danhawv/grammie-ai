// Tries the ingredient-swap pipeline on real recipes without writing
// anything: reads recipes (READ ONLY transaction), asks Gemini for swap
// proposals, works out the swaps in memory and prints title / change / delta.
//   npx tsx scripts/meal-prep/swaps-readonly.ts [--n 15] [--out proposals.json] [--ids a,b,c]
//   ... --from proposals.json   re-check saved proposals in code, no AI calls
// Proposals can be fed to make-fixtures.ts (--swaps proposals.json).
import fs from "fs";
import type { RecipeFacts } from "../../shared/meal-prep/contract";
import { seedCatalog } from "../../server/meal-prep/food/catalog";
import { computeRecipeFacts } from "../../server/meal-prep/food/facts";
import { recipeInputFromRow } from "../../server/meal-prep/food/index";
import { buildSwaps, suggestionsFrom, swapPromptInput, type SwapProposal } from "../../server/meal-prep/food/swaps";
import { proposeSwapsWithGemini } from "../../server/meal-prep/food/swaps-ai";
import { loadRecipeRows } from "./load-recipes";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
if (!process.env.GEMINI_API_KEY && fs.existsSync(".env")) process.loadEnvFile(".env");
const n = Number(arg("n") ?? 15);
const catalog = seedCatalog();
const rows = (await loadRecipeRows()).filter((r) => r.normalized_ingredients?.length);
const saved: Record<string, SwapProposal[]> | null = arg("from") ? JSON.parse(fs.readFileSync(arg("from")!, "utf8")) : null;
const ids = arg("ids")?.split(",") ?? (saved ? Object.keys(saved) : undefined);

// A spread: recipes with a swappable ingredient (dairy, beef, pasta, oil, sugar), mains and desserts
const SWAPPABLE = /sour cream|cream cheese|mayonnaise|mayo|ground beef|heavy cream|cheddar|pasta|spaghetti|penne|macaroni|olive oil|butter|sugar|mozzarella/i;
const all = rows.map((r) => ({ r, f: computeRecipeFacts(recipeInputFromRow(r), catalog) }));
let picked = ids ? all.filter((x) => ids.includes(x.r.id))
  : all.filter((x) => x.f.confidence !== "low" && x.f.lines.some((l) => SWAPPABLE.test(l.raw)) && (x.f.mealTypes.includes("dinner") || x.f.mealTypes.includes("dessert") || x.f.mealTypes.includes("breakfast")))
    .sort((a, b) => a.r.id.localeCompare(b.r.id));
if (!ids) {
  // every k-th for a deterministic spread, plus a couple of desserts
  const desserts = picked.filter((x) => x.f.mealTypes.includes("dessert")).slice(0, 3);
  const mains = picked.filter((x) => !x.f.mealTypes.includes("dessert"));
  const step = Math.max(1, Math.floor(mains.length / (n - desserts.length)));
  picked = [...mains.filter((_, i) => i % step === 0).slice(0, n - desserts.length), ...desserts];
}

const out: Record<string, SwapProposal[]> = {};
let cost = 0, inTok = 0, outTok = 0, calls = 0, totalSwaps = 0;
const pad = (s: string, w: number) => (s.length > w ? s.slice(0, w - 1) + "…" : s.padEnd(w));
console.log(`${pad("Recipe", 34)} ${pad("Swap", 52)} ${pad("Change", 60)} Delta/serving`);
await Promise.all(picked.map(async (x, i) => {
  await new Promise((r) => setTimeout(r, (i % 4) * 300));
  const f: RecipeFacts = x.f;
  const ans = saved ? { proposals: saved[f.recipeId] ?? [], costMicros: 0, tokens: { input: 0, output: 0 } }
    : await proposeSwapsWithGemini(swapPromptInput(f, suggestionsFrom(x.r.variations, x.r.tips)));
  calls++; cost += ans.costMicros; inTok += ans.tokens.input; outTok += ans.tokens.output;
  out[f.recipeId] = ans.proposals;
  const { swaps, rejected } = buildSwaps(f, ans.proposals, catalog);
  totalSwaps += swaps.length;
  const lines: string[] = [];
  if (!swaps.length) lines.push(`${pad(f.title, 34)} ${pad("(none)", 52)}`);
  for (const s of swaps) {
    const d = s.perServingDelta;
    const ch = s.changes.map((c) => `${c.from} -> ${c.toDisplay}`).join("; ");
    lines.push(`${pad(f.title, 34)} ${pad(`${s.title} [${s.goal}, ${s.source === "recipe_suggestion" ? "recipe" : "std"}, ${s.confidence}]`, 52)} ${pad(ch, 60)} ${d.protein >= 0 ? "+" : ""}${d.protein} g protein, ${d.kcal >= 0 ? "+" : ""}${d.kcal} kcal`);
  }
  for (const r of rejected) lines.push(`${pad("", 34)} ${pad("  dropped:", 52)} ${r.reason}${r.proposal.changes[0] ? ` (${r.proposal.changes.map((c) => `#${c.line} -> ${c.amount} ${c.replacement}`).join("; ")})` : ""}`);
  console.log(lines.join("\n"));
}));
console.log(`\n${calls} recipes, ${totalSwaps} swaps kept, ${inTok} input + ${outTok} output tokens, $${(cost / 1e6).toFixed(4)} (≈ $${(cost / 1e6 / calls).toFixed(5)} per recipe)`);
if (arg("out")) fs.writeFileSync(arg("out")!, JSON.stringify(out, null, 1));
