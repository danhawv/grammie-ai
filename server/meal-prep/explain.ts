// The plan's "why" in 2-4 friendly sentences. Code works out every number
// (days on target, fit score, dish count) and the model only puts them into
// words. Its answer is checked: any number not in the input, a health or
// allergen claim, or a rambling answer means we use the plain version.

import type { PrepPlan, PrepSetup } from "@shared/meal-prep/contract";

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
}

export function explainInput(setup: PrepSetup, plan: PrepPlan, titles: Record<string, string>): ExplainInput {
  const dishes = Array.from(new Set(plan.batches.map(b => titles[b.recipeId] ?? "a dish")));
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
  };
}

export function buildExplainPrompt(input: ExplainInput): string {
  return `Write 2 to 4 short, warm sentences telling a family why this week's meal-prep plan looks the way it does. Plain everyday words, no lists, no headings, no emoji.

Rules:
- Talk to the family as "you" (they are reading it); call people by the names given.
- Use only the facts and numbers given below. Do not add, round, estimate or calculate any other number.
- If something couldn't be met (see "relaxed"), say so gently and plainly.
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
  if (cleaned.length < 20 || cleaned.length > 700) return null;
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
  if (sentences.length < 1 || sentences.length > 5) return null;
  if (CLAIMS.test(cleaned)) return null;
  const allowed = allowedNumbers(input);
  if (numbersIn(cleaned).some(n => !allowed.has(n))) return null;
  return cleaned;
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
  if (input.relaxed.length > 0) parts.push(`Not everything fit, so we loosened: ${listWords(input.relaxed.slice(0, 3))}.`);
  return parts.join(" ");
}
