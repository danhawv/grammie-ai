// The plan's "why" in 2-4 friendly sentences. Code works out every number
// (days on target, fit score, dish count) and the model only puts them into
// words. Its answer is checked: any number not in the input, a health or
// allergen claim, or a rambling answer means we use the plain version.

import type { Adjuster, PrepPlan, PrepSetup } from "@shared/meal-prep/contract";
import { adjusterDisplay, bottles, enrichSwaps, productName } from "@shared/meal-prep/callouts";

export interface ExplainInput {
  days: number;
  peopleCount: number;
  dishCount: number;
  dishes: string[];
  /** 0-100 */
  fitScore: number;
  people: Array<{ name: string; hasTargets: boolean; daysOnTarget: number; days: number }>;
  /** plain facts from the planner */
  notes: string[];
  /** limits the planner had to loosen */
  relaxed: string[];
  /** recipe swaps used: each must be mentioned (the owner's rule: every swap is called out) */
  swaps?: Array<{ dish: string; swap: string; note: string }>;
  /** plain protein top-ups: "Mom: 3 bottles of Fairlife Core Power" */
  topUps?: string[];
}

/** "Mom: 3 bottles of Fairlife Core Power", "Mom: plain chicken breast at 2 meals" */
export function topUpFacts(setup: PrepSetup, plan: PrepPlan, adjusters: Adjuster[]): string[] {
  const byId = new Map(adjusters.map(a => [a.id, a]));
  const out: string[] = [];
  for (const person of setup.people) {
    const per = new Map<string, { meals: number; bottles: number }>();
    for (const plate of plan.plates) {
      if (plate.personId !== person.id) continue;
      for (const item of plate.items) {
        const a = item.kind === "adjuster" ? byId.get(item.refId) : undefined;
        if (!a?.topUp) continue;
        const agg = per.get(a.id) ?? { meals: 0, bottles: 0 };
        agg.meals += 1;
        if (a.topUp === "shake") agg.bottles += bottles(item.grams ?? item.amount, a.unitGrams);
        per.set(a.id, agg);
      }
    }
    for (const [id, agg] of Array.from(per)) {
      const a = byId.get(id)!;
      out.push(a.topUp === "shake"
        ? `${person.name}: ${agg.bottles} ${agg.bottles === 1 ? "bottle" : "bottles"} of ${productName(adjusterDisplay(a))}`
        : `${person.name}: plain ${a.name.toLowerCase()} at ${agg.meals} ${agg.meals === 1 ? "meal" : "meals"}`);
    }
  }
  return out;
}

export function explainInput(setup: PrepSetup, plan: PrepPlan, titles: Record<string, string>, adjusters: Adjuster[] = []): ExplainInput {
  const dishes = Array.from(new Set(plan.batches.map(b => titles[b.recipeId] ?? "a dish")));
  const swaps = enrichSwaps(plan, []).map(s => ({ dish: titles[s.recipeId] ?? "a dish", swap: s.title, note: s.note }));
  const topUps = topUpFacts(setup, plan, adjusters);
  return {
    days: setup.days,
    peopleCount: setup.people.length,
    dishCount: plan.batches.length,
    dishes,
    fitScore: Math.round(plan.fitScore),
    people: setup.people.map(p => {
      const fits = plan.fit.filter(f => f.personId === p.id);
      const onTarget = fits.filter(f => Object.values(f.status).every(s => s === "ok" || s === "n/a")).length;
      return { name: p.name, hasTargets: !!p.targets, daysOnTarget: onTarget, days: fits.length };
    }),
    notes: plan.notes.slice(0, 12),
    relaxed: plan.relaxed.slice(0, 8),
    ...(swaps.length ? { swaps: swaps.slice(0, 8) } : {}),
    ...(topUps.length ? { topUps: topUps.slice(0, 8) } : {}),
  };
}

export function buildExplainPrompt(input: ExplainInput): string {
  return `Write 2 to 4 short, warm sentences telling a family why this week's meal-prep plan looks the way it does. Plain everyday words, no lists, no headings, no emoji.

Rules:
- Talk to the family as "you" (they are reading it); call people by the names given.
- Use only the facts and numbers given below. Do not add, round, estimate or calculate any other number.
- If something couldn't be met (see "relaxed"), say so gently and plainly.
- If "swaps" are given, name every swap and the dish it's in, and say what it did, using its note (e.g. "Greek yogurt instead of sour cream in the Chili adds protein"). Never hide a swap.
- If "topUps" are given, mention them plainly (e.g. "a protein shake on some days").
- No health, diet or allergy claims or promises.

Facts (JSON): ${JSON.stringify(input)}

Return JSON: {"text": "..."}`;
}

const NUMBER = /\d+(?:[.,]\d+)*/g;

function numbersIn(text: string): string[] {
  return (text.match(NUMBER) ?? []).map(n => n.replace(/,/g, ""));
}

/** Every number the model is allowed to say */
export function allowedNumbers(input: ExplainInput): Set<string> {
  return new Set(numbersIn(JSON.stringify(input)));
}

const CLAIMS = /allergen[- ]?free|allergy[- ]?safe|safe for (?:anyone|everyone|allergies)|guarantee|cure|diagnos|medical/i;

/** The cleaned explanation, or null when it breaks a rule */
export function checkExplanation(text: unknown, input: ExplainInput): string | null {
  if (typeof text !== "string") return null;
  const cleaned = text.replace(/[*_#`]/g, "").replace(/\s+/g, " ").trim();
  if (cleaned.length < 20) return null;
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
  const extra = Math.min(2, input.swaps?.length ?? 0);
  if (sentences.length < 1 || sentences.length > 5 + extra) return null;
  if (cleaned.length > 700 + extra * 150) return null;
  if (CLAIMS.test(cleaned)) return null;
  // Every swap must be called out: its ingredient words have to appear
  for (const s of input.swaps ?? []) if (!mentionsSwap(cleaned, s.swap)) return null;
  const allowed = allowedNumbers(input);
  if (numbersIn(cleaned).some(n => !allowed.has(n))) return null;
  return cleaned;
}

/** "Greek yogurt instead of sour cream": both sides must be named ("yogurt" and "sour cream") */
function mentionsSwap(text: string, title: string): boolean {
  const lower = text.toLowerCase();
  const [to, from] = title.toLowerCase().split(/\s+instead of\s+/);
  const key = (part: string | undefined) => (part ?? "").split(/\s+/).filter(w => w.length > 3 && !/^(nonfat|low|fat|lean|plain|light|reduced|extra)$/.test(w));
  const words = [...key(to).slice(-1), ...key(from).slice(-1)];
  return words.length === 0 || words.every(w => lower.includes(w.replace(/s$/, "")));
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The no-AI version, built from the same facts */
export function plainExplanation(input: ExplainInput): string {
  const parts: string[] = [];
  const dishes = input.dishes.slice(0, 5);
  parts.push(`This plan covers ${input.days} ${input.days === 1 ? "day" : "days"} with ${input.dishCount} ${input.dishCount === 1 ? "dish" : "dishes"}${dishes.length ? `: ${listWords(dishes)}` : ""}.`);
  const withTargets = input.people.filter(p => p.hasTargets && p.days > 0);
  if (withTargets.length > 0) {
    parts.push(withTargets.map(p => `${p.name} is on target ${p.daysOnTarget} of ${p.days} days`).join("; ") + ".");
  }
  for (const note of input.notes.slice(0, 1)) parts.push(note.endsWith(".") ? note : `${note}.`);
  const swaps = input.swaps ?? [];
  if (swaps.length > 0) parts.push(`We made ${swaps.length === 1 ? "one swap" : `${swaps.length} swaps`}: ${swaps.map(s => `in ${s.dish}, ${trimEnd(s.note)}`).join("; ")}.`);
  if (input.topUps?.length) parts.push(`Added for protein: ${input.topUps.join("; ")}.`);
  if (input.relaxed.length > 0) parts.push(`Not everything fit, so we loosened: ${listWords(input.relaxed.slice(0, 3))}.`);
  return parts.join(" ");
}

const trimEnd = (s: string) => s.replace(/[.\s]+$/, "");
