// Higher-protein / lighter ingredient swaps for a recipe (RecipeFacts.swaps).
//
// The model only proposes WHAT to swap: which ingredient lines, what to use
// instead and how much of it ("1 cup"), preferring the recipe's own
// suggestions (its variations and tips). It never gives a macro number.
// Code then maps the replacement to the canonical catalog, converts the
// amount to grams, and works out the exact per-serving change from USDA /
// label data; swaps that don't clearly add protein or cut calories are
// dropped. Nothing here changes the recipe itself.

import type { CanonicalIngredientRef, Confidence, IngredientSwap, Macros, MacroKey, RecipeFacts } from "@shared/meal-prep/contract";
import { countedWeight, humanAmount, niceNumber } from "@shared/meal-prep/amounts";
import type { Catalog, CatalogIngredient } from "./catalog";
import { parseUnit, toGrams } from "./units";

/** What the model proposes for one swap (no macro numbers) */
export interface SwapProposal {
  source: "recipe_suggestion" | "standard";
  changes: Array<{
    /** index of the ingredient line to replace (RecipeFacts.lines[].index) */
    line: number;
    /** plain ingredient name to use instead ("nonfat Greek yogurt"); may be the same ingredient for "use less" */
    replacement: string;
    /** amount of the replacement for the whole recipe as written ("1 cup", "8 oz", "2 tbsp") */
    amount: string;
  }>;
}

/** The recipe's own ideas the model should prefer (from recipes.variations and tips) */
export interface SwapSuggestion { type: string; title?: string; text: string }

export interface SwapRejection { proposal: SwapProposal; reason: string }

/** Thresholds for calling a swap worth it, per serving */
export const SWAP_RULES = {
  /** protein up at least this many grams -> "protein" */
  minProteinGain: 3,
  /** calories down at least this many -> "lighter" */
  minKcalDrop: 30,
  /** a "lighter" swap may lose at most this much protein */
  maxProteinLossWhenLighter: 3,
  /** a "protein"-only swap may add at most this many kcal per gram of protein gained */
  maxKcalPerProteinGram: 8,
  /** the replacement's grams must be within this range of the original line's */
  gramsRatio: [0.5, 1.6] as [number, number],
  /** a swap may add at most this many kcal per serving */
  maxKcalGain: 150,
  /** more protein than this per serving from one swap means the amount is wrong */
  maxProteinGain: 60,
  /** catalog match needed for the replacement */
  minMatch: 0.7,
  maxSwaps: 4,
};

const MACROS: MacroKey[] = ["kcal", "protein", "carbs", "fat"];
const GARNISH = /\bto taste\b|\bgarnish\b|\bfor serving\b|\bas needed\b|\bfor (frying|greasing|dusting)\b|\boptional\b/i;

function macrosOf(ing: CatalogIngredient, grams: number): Macros {
  const f = grams / 100;
  const p = ing.per100g;
  return { kcal: p.kcal * f, protein: p.protein * f, carbs: p.carbs * f, fat: p.fat * f, fiber: (p.fiber ?? 0) * f };
}

const UNICODE: Record<string, number> = { "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875 };

/** "1 1/2 cups" -> { quantity: 1.5, unit: "cups" }; "3" -> { 3, "" }; "a pinch" -> null quantity */
export function parseAmountText(text: string): { quantity: number | null; unit: string } {
  const t = (text ?? "").trim().toLowerCase().replace(/^about\s+|^approx\.?\s+/, "");
  const m = t.match(/^(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d*\s?[½⅓⅔¼¾⅛⅜⅝⅞]|\d+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return { quantity: null, unit: t };
  const q = m[1].replace(/\s+/g, " ").replace(/^(\d+) ([½⅓⅔¼¾⅛⅜⅝⅞])$/, "$1$2");
  let quantity: number;
  const mixed = q.match(/^(\d+) (\d+)\s*\/\s*(\d+)$/);
  const frac = q.match(/^(\d+)\s*\/\s*(\d+)$/);
  const uni = q.match(/^(\d*)([½⅓⅔¼¾⅛⅜⅝⅞])$/);
  if (mixed) quantity = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  else if (frac) quantity = Number(frac[1]) / Number(frac[2]);
  else if (uni) quantity = (uni[1] ? Number(uni[1]) : 0) + UNICODE[uni[2]];
  else quantity = Number(q);
  const rest = m[2].trim();
  // Unit is the first word or two ("fl oz", "heaping tbsp"); the rest is the food name, ignored
  const two = rest.split(/\s+/).slice(0, 2).join(" ");
  const unit = /^(fl\.? oz|fluid ounces?|heaping tbsp|heaped tbsp)/.test(two) ? two.replace("fl. oz", "fl oz") : (rest.split(/\s+/)[0] ?? "").replace(/\.$/, "");
  return { quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null, unit };
}

/** Grams for an amount of a catalog ingredient */
export function amountToGrams(text: string, ing: CatalogIngredient, catalog: Catalog): { grams: number | null; confidence: Confidence; byVolume: boolean } {
  const { quantity, unit } = parseAmountText(text);
  if (quantity == null) return { grams: null, confidence: "low", byVolume: false };
  const parsed = parseUnit(unit, text, quantity);
  const r = toGrams(quantity, parsed, catalog.gramFacts(ing));
  return { grams: r.grams, confidence: r.confidence, byVolume: parsed.unit.kind === "volume" && !parsed.statedGrams };
}

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const upperFirst = (s: string) => s[0].toUpperCase() + s.slice(1);
const round1 = (n: number) => Math.round(n * 10) / 10;

function roundDelta(m: Macros): Macros {
  return { kcal: Math.round(m.kcal), protein: round1(m.protein), carbs: round1(m.carbs), fat: round1(m.fat), fiber: round1(m.fiber ?? 0) };
}

/** Spoons and cups from the ingredient's own density (so 245 g of Greek yogurt reads "1 cup") */
function volumeDisplay(grams: number, gramsPerCup: number): string {
  const cups = grams / gramsPerCup;
  const tbsp = cups * 16;
  if (tbsp < 0.9) return `${niceNumber(Math.max(0.125, Math.round(tbsp * 3 * 4) / 4))} tsp`;
  if (tbsp < 3.5) return `${niceNumber(Math.round(tbsp * 2) / 2)} tbsp`;
  const c = Math.round(cups * 4) / 4;
  return `${niceNumber(c)} ${c > 1 ? "cups" : "cup"}`;
}

/**
 * "1 cup nonfat Greek yogurt", "3 eggs", "1 lb (454 g) lean ground beef".
 * gramsPerCup: say it by volume with this density (when the amount was given
 * by volume); otherwise shared/meal-prep/amounts.ts humanAmount decides.
 */
export function swapDisplay(grams: number, ref: CanonicalIngredientRef, gramsPerCup?: number | null): string {
  if (gramsPerCup && !countedWeight(ref)) return `${volumeDisplay(grams, gramsPerCup)} ${lowerFirst(ref.name)}`;
  // Egg whites and yolks are counted by the egg they come from, not as whole eggs
  const part = ref.id === "egg-white" ? { g: 33, word: "egg white" } : ref.id === "egg-yolk" ? { g: 17, word: "egg yolk" } : null;
  if (part) { const n = Math.max(1, Math.round(grams / part.g)); return `${n} ${part.word}${n > 1 ? "s" : ""}`; }
  const amount = humanAmount(grams, ref);
  if (countedWeight(ref)) return amount; // the count already names it ("3 eggs", "2 cloves garlic")
  return `${amount} ${lowerFirst(ref.name)}`;
}

/** Goal for a per-serving change, or null when it isn't worth calling a swap */
export function classifySwap(delta: Macros, rules = SWAP_RULES): IngredientSwap["goal"] | null {
  const protein = delta.protein >= rules.minProteinGain;
  const lighter = delta.kcal <= -rules.minKcalDrop;
  if (delta.kcal > rules.maxKcalGain || delta.protein > rules.maxProteinGain) return null;
  if (protein && lighter) return "both";
  if (lighter) return delta.protein < -rules.maxProteinLossWhenLighter ? null : "lighter";
  if (protein) return delta.kcal > delta.protein * rules.maxKcalPerProteinGram ? null : "protein";
  return null;
}

function sameCut(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a) || (/ground/.test(a) && /ground/.test(b));
}

const CONF_RANK: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };
const minConf = (...c: Confidence[]): Confidence => c.reduce((a, b) => (CONF_RANK[b] < CONF_RANK[a] ? b : a), "high");

/**
 * Turns the model's proposals into swaps with exact per-serving changes.
 * Pure: needs only the recipe's facts and the catalog.
 */
export function buildSwaps(facts: RecipeFacts, proposals: SwapProposal[], catalog: Catalog, rules = SWAP_RULES): { swaps: IngredientSwap[]; rejected: SwapRejection[] } {
  const swaps: Array<IngredientSwap & { score: number }> = [];
  const rejected: SwapRejection[] = [];
  const lines = new Map(facts.lines.map((l) => [l.index, l]));
  const servings = facts.servings > 0 ? facts.servings : 1;

  for (const proposal of splitByIdea(proposals, facts, catalog)) {
    const reject = (reason: string) => rejected.push({ proposal, reason });
    if (!proposal?.changes?.length) { reject("no changes"); continue; }
    const changes: IngredientSwap["changes"] = [];
    const total: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
    const conf: Confidence[] = [];
    const fromIds = new Set<string>();
    let failed: string | null = null;
    for (const c of proposal.changes) {
      const line = lines.get(c.line);
      if (!line) { failed = `no line ${c.line}`; break; }
      if (changes.some((x) => x.lineIndex === c.line)) { failed = `line ${c.line} twice`; break; }
      if (line.optional || line.grams == null || !line.ingredient || GARNISH.test(line.raw)) { failed = `line ${c.line} is garnish, optional or unmeasured`; break; }
      if (line.confidence === "low") { failed = `line ${c.line} amount uncertain`; break; }
      const from = catalog.byId.get(line.ingredient.id);
      if (!from) { failed = `line ${c.line} not in catalog`; break; }
      const direct = catalog.byId.get(c.replacement);
      const hit = direct ? { ingredient: direct, confidence: 1 } : catalog.resolve(c.replacement ?? "");
      if (!hit || hit.confidence < rules.minMatch) { failed = `can't place "${c.replacement}"`; break; }
      const to = hit.ingredient;
      const amt = amountToGrams(c.amount, to, catalog);
      if (amt.grams == null || amt.grams <= 0) { failed = `can't read amount "${c.amount}"`; break; }
      // A standard swap keeps the cut: ground beef -> lean ground beef or ground turkey, not stew beef -> ground beef
      if (proposal.source === "standard" && from.protein && to.protein && from.id !== to.id && !sameCut(from.id, to.id)) { failed = `"${c.replacement}" isn't the same cut as line ${c.line}`; break; }
      const ratio = amt.grams / line.grams;
      if (to.id === from.id) {
        // "Use less": only a real reduction counts
        if (ratio >= 0.9 || ratio < 0.2) { failed = `"${c.amount}" isn't a sensible reduction`; break; }
      } else if (ratio < rules.gramsRatio[0] || ratio > rules.gramsRatio[1]) { failed = `"${c.amount}" is far from the original amount`; break; }
      const before = macrosOf(from, line.grams);
      const after = macrosOf(to, amt.grams);
      for (const k of MACROS) total[k] += after[k] - before[k];
      total.fiber = (total.fiber ?? 0) + (after.fiber ?? 0) - (before.fiber ?? 0);
      const grams = round1(amt.grams);
      const ref = catalog.ref(to.id);
      changes.push({ lineIndex: c.line, from: line.raw, to: ref, toGrams: grams, toDisplay: swapDisplay(grams, ref, amt.byVolume ? to.cup : null) });
      fromIds.add(from.id);
      conf.push(hit.confidence >= 0.9 ? "high" : "medium", amt.confidence, line.confidence);
    }
    if (failed) { reject(failed); continue; }

    const delta = roundDelta({ kcal: total.kcal / servings, protein: total.protein / servings, carbs: total.carbs / servings, fat: total.fat / servings, fiber: (total.fiber ?? 0) / servings });
    const goal = classifySwap(delta, rules);
    if (!goal) { reject(`not worth it (${delta.protein >= 0 ? "+" : ""}${delta.protein} g protein, ${delta.kcal >= 0 ? "+" : ""}${delta.kcal} kcal per serving)`); continue; }

    const fromNames = Array.from(fromIds).map((id) => lowerFirst(catalog.byId.get(id)!.name));
    const toNames = Array.from(new Set(changes.map((c) => c.to.id))).map((id) => catalog.byId.get(id)!.name);
    const reduction = changes.every((c) => fromIds.has(c.to.id)) && fromIds.size === new Set(changes.map((c) => c.to.id)).size;
    const title = reduction ? `Less ${fromNames.join(" and ")}` : `${upperFirst(lowerFirst(toNames.join(" and ")))} instead of ${fromNames.join(" and ")}`;
    const baseId = reduction ? `less-${Array.from(fromIds).join("+")}` : `${Array.from(fromIds).join("+")}->${Array.from(new Set(changes.map((c) => c.to.id))).join("+")}`;
    let id = baseId;
    for (let n = 2; swaps.some((s) => s.id === id); n++) id = `${baseId}-${n}`;
    swaps.push({
      id, goal, title, changes, perServingDelta: delta, confidence: minConf(...conf),
      source: proposal.source === "recipe_suggestion" ? "recipe_suggestion" : "standard",
      score: Math.max(0, delta.protein) * 10 - delta.kcal,
    });
  }

  // Best first; no two swaps may change the same line
  swaps.sort((a, b) => b.score - a.score);
  const used = new Set<number>();
  const out: IngredientSwap[] = [];
  for (const { score: _score, ...s } of swaps) {
    if (out.length >= rules.maxSwaps) { rejected.push({ proposal: { source: s.source, changes: [] }, reason: `over ${rules.maxSwaps} swaps: ${s.title}` }); continue; }
    if (s.changes.some((c) => used.has(c.lineIndex))) { rejected.push({ proposal: { source: s.source, changes: [] }, reason: `overlaps a better swap: ${s.title}` }); continue; }
    s.changes.forEach((c) => used.add(c.lineIndex));
    out.push(s);
  }
  return { swaps: out, rejected };
}

/**
 * One idea per swap: a proposal that changes several different ingredients
 * ("lean beef, less oil and yogurt for the sauce") becomes one swap per
 * ingredient pair, so each can be used and called out on its own. Several
 * lines of the same ingredient stay together.
 */
function splitByIdea(proposals: SwapProposal[], facts: RecipeFacts, catalog: Catalog): SwapProposal[] {
  const out: SwapProposal[] = [];
  for (const p of proposals) {
    const groups = new Map<string, SwapProposal>();
    (p?.changes ?? []).forEach((c, i) => {
      const from = facts.lines.find((l) => l.index === c.line)?.ingredient?.id;
      const to = catalog.byId.get(c.replacement)?.id ?? catalog.resolve(c.replacement ?? "")?.ingredient.id;
      const key = from && to ? `${from}->${to}` : `#${i}`;
      const g = groups.get(key) ?? { source: p.source, changes: [] };
      g.changes.push(c);
      groups.set(key, g);
    });
    if (!groups.size) out.push(p);
    out.push(...Array.from(groups.values()));
  }
  return out;
}

// ---------- The model call ----------

/** Suggestions from a recipe row's variations and tips that are about swapping ingredients */
export function suggestionsFrom(variations: unknown, tips: unknown): SwapSuggestion[] {
  const out: SwapSuggestion[] = [];
  if (Array.isArray(variations)) {
    for (const v of variations as any[]) {
      if (!v || typeof v.description !== "string") continue;
      const type = String(v.type ?? "").toLowerCase();
      if (type === "flavor" && !/instead|swap|replace|substitut|lighter|greek yogurt|lean/i.test(v.description)) continue;
      out.push({ type, title: typeof v.title === "string" ? v.title : undefined, text: v.description });
    }
  }
  if (Array.isArray(tips)) {
    for (const t of tips as any[]) {
      if (t && typeof t.text === "string" && /instead|swap|replace|substitut|lighter|greek yogurt|lean|low-fat|reduced[- ]fat/i.test(t.text)) out.push({ type: `tip:${t.type ?? ""}`, text: t.text });
    }
  }
  return out.slice(0, 12);
}

export const SWAPS_PROMPT = `You suggest ingredient swaps that make a home recipe higher in protein and/or lower in calories while keeping it the same dish.

Rules:
- At most 4 swaps. Fewer is fine; return {"swaps":[]} if nothing sensible fits (e.g. the recipe is already lean, or a swap would ruin it).
- Prefer the recipe's own suggestions (listed under "Suggestions") when one is a higher-protein or lighter idea; mark those source "recipe_suggestion". Otherwise use well-known swaps and mark them "standard":
  sour cream -> nonfat Greek yogurt; mayonnaise -> nonfat Greek yogurt or light mayonnaise; cream cheese -> light cream cheese;
  ground beef -> 93% lean ground beef or lean ground turkey (only for ground meat; keep other cuts as they are); regular pasta -> protein pasta or chickpea pasta;
  heavy cream -> half the amount, or evaporated skim milk / low-fat milk where it's only for creaminess; whole milk -> skim milk;
  cheddar -> reduced-fat cheddar, or less cheese; mozzarella -> part-skim mozzarella; oil or butter -> use less (often half);
  sugar -> zero-calorie sweetener (only in baking or sauces where sugar is for sweetness, not structure or caramelizing);
  some whole eggs -> egg whites (2 whites per egg; only in scrambles, batters and baking, never where the yolk matters: custards, emulsions, egg-lemon sauces).
- One idea per swap. A swap lists several lines only when the same ingredient appears on several lines.
- Each swap changes existing ingredient lines, by line number. A swap may keep the ingredient and use a smaller amount ("use less").
- Give the replacement as a plain grocery name (no brands) and its amount for the WHOLE recipe as written, as one number and a unit ("1 cup", "8 oz", "2 tbsp", "3 large"). Use the same amount as the original line (same weight or volume) unless the swap is to use less.
- Don't swap the dish's main protein for a different one (chicken for veal, shrimp for chicken) unless the recipe's own suggestions say to.
- Never change garnishes, "to taste" lines, spices, or optional lines. Never add new ingredients that replace nothing.
- Do NOT give calories, protein or any nutrition numbers.
Return JSON: {"swaps":[{"source":"recipe_suggestion"|"standard","changes":[{"line":<line number>,"replacement":"<ingredient>","amount":"<amount with unit>"}]}]}`;

export interface SwapPromptRecipe {
  title: string;
  servings: number;
  lines: Array<{ index: number; raw: string }>;
  suggestions: SwapSuggestion[];
}

export function swapPromptInput(facts: RecipeFacts, suggestions: SwapSuggestion[]): SwapPromptRecipe {
  return {
    title: facts.title,
    servings: facts.servings,
    lines: facts.lines.filter((l) => !l.optional).map((l) => ({ index: l.index, raw: l.raw })),
    suggestions,
  };
}

export function swapPromptText(r: SwapPromptRecipe): string {
  const lines = r.lines.map((l) => `${l.index}. ${l.raw}`).join("\n");
  const sugg = r.suggestions.length ? r.suggestions.map((s) => `- [${s.type}] ${s.title ? `${s.title}: ` : ""}${s.text}`).join("\n") : "(none)";
  return `Recipe: ${r.title} (serves ${r.servings})\nIngredients:\n${lines}\nSuggestions:\n${sugg}\nAnswer:`;
}

/** Keeps only well-formed proposals from a model answer */
export function readProposals(raw: any): SwapProposal[] {
  const list = Array.isArray(raw?.swaps) ? raw.swaps : [];
  const out: SwapProposal[] = [];
  for (const s of list.slice(0, 6)) {
    const changes = (Array.isArray(s?.changes) ? s.changes : [])
      .filter((c: any) => Number.isInteger(c?.line) && typeof c?.replacement === "string" && c.replacement.trim() && typeof c?.amount === "string")
      .map((c: any) => ({ line: c.line, replacement: c.replacement.trim().slice(0, 80), amount: c.amount.trim().slice(0, 40) }));
    if (changes.length) out.push({ source: s?.source === "recipe_suggestion" ? "recipe_suggestion" : "standard", changes });
  }
  return out;
}
