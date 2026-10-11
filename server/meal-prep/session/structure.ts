import type { TaskKind } from "@shared/meal-prep/contract";
import { extractIngredientName, isOptionalLine, normalizeIngredient } from "@shared/pantry-match";
import type { Heat, NormalizedStep, RecipeSource, RecipeTask, TaskIngredient } from "./types";

// Step structuring, the code half: checking the model's task breakdown
// against the recipe (validateSteps), a no-AI fallback built from the
// normalized steps (heuristicSteps), and scaling task times for bigger or
// smaller batches (scaleTask). The model can be wrong about any number, so
// every one is clamped, defaulted or reconciled with the recipe here.

const RECIPE_KINDS: TaskKind[] = ["prep", "cook", "simmer", "bake", "rest", "chill", "marinate", "assemble"];

/** Kinds where the food mostly sits on its own */
const PASSIVE_KINDS = new Set<TaskKind>(["simmer", "bake", "rest", "chill", "marinate"]);

/** How long a task's result can wait, by kind, when the model doesn't say */
const DEFAULT_HOLD: Record<string, number> = {
  prep: 240, cook: 15, simmer: 30, bake: 15, rest: 20, chill: 600, marinate: 720, assemble: 30,
};

/** Minutes, by kind, when neither the model nor the recipe gives a time */
const DEFAULT_MINUTES: Record<string, number> = {
  prep: 4, cook: 8, simmer: 20, bake: 30, rest: 10, chill: 60, marinate: 30, assemble: 3,
};

const KIND_SYNONYMS: Array<[RegExp, TaskKind]> = [
  [/^(roast|broil|bake|oven)/, "bake"],
  [/^(boil|simmer|stew|braise|slow)/, "simmer"],
  [/^(saut|sear|brown|fry|cook|heat|melt|toast|stir)/, "cook"],
  [/^(marinat)/, "marinate"],
  [/^(chill|refrig|freez)/, "chill"],
  [/^(rest|stand|wait|cool)/, "rest"],
  [/^(prep|chop|dice|cut|slice|mince|wash|peel|grate)/, "prep"],
  [/^(assembl|mix|combine|blend|puree|layer|toss|whisk|stir)/, "assemble"],
];

function toKind(value: unknown): TaskKind | "preheat" | "serve" | null {
  const v = String(value ?? "").toLowerCase().trim();
  if ((RECIPE_KINDS as string[]).includes(v)) return v as TaskKind;
  if (/^preheat/.test(v)) return "preheat";
  if (/^serv|^garnish/.test(v)) return "serve";
  for (const [re, kind] of KIND_SYNONYMS) if (re.test(v)) return kind;
  return null;
}

const KNIFE_FORMS: Array<[RegExp, string]> = [
  [/\b(minced|finely chopped|very finely)\b/, "minced"],
  [/\b(diced|cubed|cubes|dice)\b/, "diced"],
  [/\b(chopped|chop)\b/, "chopped"],
  [/\b(sliced|slice|slivered|julienned)\b/, "sliced"],
  [/\b(grated|shredded|grate)\b/, "grated"],
  [/\b(juiced|juice of)\b/, "juiced"],
  [/\b(zested|zest)\b/, "zested"],
  [/\b(crushed|smashed)\b/, "crushed"],
  [/\b(halved|quartered)\b/, "halved"],
];

/** "finely chopped" -> "minced", "cubed" -> "diced": one name per cut, so prep merges across recipes */
export function normalizePrepForm(prep: string | null | undefined): string | null {
  const p = String(prep ?? "").toLowerCase();
  if (!p.trim()) return null;
  for (const [re, form] of KNIFE_FORMS) if (re.test(p)) return form;
  return null;
}

const cToF = (c: number) => Math.round((c * 9) / 5 + 32);

/** A normalized step's temperature in °F, or null */
export function stepTempF(step: NormalizedStep): number | null {
  const t = step.temperature;
  const v = Number(t?.value);
  if (!t || !Number.isFinite(v) || v <= 0) {
    const m = step.text?.match(/(\d{3})\s*°?\s*(F|C)\b/i);
    if (!m) return null;
    return m[2].toUpperCase() === "C" ? cToF(Number(m[1])) : Number(m[1]);
  }
  return t.scale === "C" ? cToF(v) : v;
}

function stepMinutes(step: NormalizedStep | undefined): number | null {
  if (!step) return null;
  const t = Number(step.timeMinutes);
  if (Number.isFinite(t) && t > 0) return t;
  const max = Number(step.timeRange?.max);
  return Number.isFinite(max) && max > 0 ? max : null;
}

const clampMin = (v: unknown, max = 24 * 60) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(max, Math.round(n * 2) / 2);
};

const roundTo5 = (n: number) => Math.round(n / 5) * 5;

const VESSELS: Array<[RegExp, string]> = [
  [/dutch oven/, "dutch oven"],
  [/stock ?pot|soup pot|large pot|big pot|^pot$/, "large pot"],
  [/sauce ?pan|small pot|medium pot/, "saucepan"],
  [/sheet pan|baking sheet|baking tray|roasting tray|cookie sheet|sheet tray|tray/, "sheet pan"],
  [/baking dish|baking pan|casserole|9 ?x ?13|roasting pan|loaf pan|cake pan|pie (dish|plate)/, "baking dish"],
  [/skillet|frying pan|fry pan|saute pan|wok|griddle|\bpan\b/, "skillet"],
  [/bowl/, "mixing bowl"],
  [/blender/, "blender"],
  [/food processor|processor/, "food processor"],
  [/slow cooker|crock ?pot/, "slow cooker"],
  [/instant pot|pressure cooker/, "instant pot"],
];

/** "large soup pot" -> "large pot", so the scheduler counts pots and pans by kind */
export function normalizeVessel(v: unknown): string | null {
  const s = String(v ?? "").toLowerCase().trim();
  if (!s) return null;
  for (const [re, kind] of VESSELS) if (re.test(s)) return kind;
  return s;
}

/** "1 lb chix breast - cooked in cubes" -> "chix breast", for task text */
export function plainName(raw: string): string {
  return (extractIngredientName(raw) || raw)
    .toLowerCase()
    .replace(/^(t|tb|tbs|tbsp|tsp|c|cups?|lbs?|oz|g)\.?\s+/, "")
    .split(/\s+-\s+|,|\(/)[0]
    .replace(/\b(finely|thinly|roughly|freshly|chopped|diced|minced|sliced|grated|shredded|juiced|cubed|cooked|peeled)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Blender or food processor" -> "blender" */
export function normalizeAppliance(v: unknown): string | null {
  const s = String(v ?? "").toLowerCase().trim();
  if (!s) return null;
  if (/blender/.test(s)) return "blender";
  if (/processor/.test(s)) return "food processor";
  if (/rice cooker/.test(s)) return "rice cooker";
  if (/slow cooker|crock/.test(s)) return "slow cooker";
  if (/instant pot|pressure/.test(s)) return "instant pot";
  if (/air fryer/.test(s)) return "air fryer";
  return s;
}

/** Lowercased name words for an ingredient line, used to find it in task text */
function lineWords(raw: string): string[] {
  return normalizeIngredient(extractIngredientName(raw) || raw)
    .split(" ")
    .filter((w) => w.length > 2);
}

/** Orders tasks so dependencies come first; drops edges that would make a loop */
function orderTasks(tasks: RecipeTask[], fixes: string[]): RecipeTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const position = new Map(tasks.map((t, i) => [t.id, i]));
  for (const t of tasks) {
    t.dependsOn = Array.from(new Set(t.dependsOn)).filter((d) => {
      if (d === t.id || !byId.has(d)) {
        fixes.push(`${t.id}: dropped unknown dependency ${d}`);
        return false;
      }
      return true;
    });
  }
  for (;;) {
    const out: RecipeTask[] = [];
    const done = new Set<string>();
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const t of tasks) {
        if (!done.has(t.id) && t.dependsOn.every((d) => done.has(d))) {
          out.push(t);
          done.add(t.id);
          progressed = true;
        }
      }
    }
    if (out.length === tasks.length) return out;
    // A loop: break it at edges that point to a later task in the model's order
    for (const t of tasks) {
      if (done.has(t.id)) continue;
      const before = t.dependsOn.length;
      t.dependsOn = t.dependsOn.filter((d) => position.get(d)! < position.get(t.id)!);
      if (t.dependsOn.length < before) fixes.push(`${t.id}: broke a dependency loop`);
    }
  }
}

/** Fills in missing ingredient lines: each non-optional line must be used by some task */
function attachUnusedLines(recipe: RecipeSource, tasks: RecipeTask[], atServing: string[], fixes: string[]) {
  const used = new Set(tasks.flatMap((t) => t.ingredients.map((i) => i.index)));
  const servingText = atServing.join(" ").toLowerCase();
  recipe.ingredients.forEach((raw, index) => {
    if (used.has(index) || isOptionalLine(raw)) return;
    const words = lineWords(raw);
    if (words.length && words.every((w) => servingText.includes(w))) return; // a garnish
    if (servingText.includes(`ingredient ${index}`)) return;
    const mentions = (t: RecipeTask) => words.some((w) => t.text.toLowerCase().includes(w));
    const target =
      tasks.find((t) => t.kind !== "prep" && mentions(t)) ??
      tasks.find(mentions) ??
      tasks.find((t) => t.kind === "assemble" || t.kind === "cook" || t.kind === "simmer") ??
      tasks[0];
    if (!target) return;
    target.ingredients.push({ index, fraction: 1, prep: null });
    fixes.push(`line ${index} ("${raw}") was unused; added to ${target.id}`);
  });
}

/** Moves time between hands-on and waiting so each kind looks like itself */
function sensibleSplit(t: RecipeTask, fixes: string[]) {
  if (PASSIVE_KINDS.has(t.kind)) {
    const maxActive = t.kind === "marinate" || t.kind === "simmer" ? 5 : t.kind === "bake" ? 4 : 2;
    if (t.activeMin > maxActive && t.passiveMin < t.activeMin) {
      fixes.push(`${t.id}: ${t.kind} was ${t.activeMin} min hands-on; moved most to waiting`);
      t.passiveMin += t.activeMin - maxActive;
      t.activeMin = maxActive;
    }
    if (t.activeMin === 0 && t.kind !== "rest" && t.kind !== "chill") t.activeMin = 1;
  } else if (t.kind === "prep" || t.kind === "assemble") {
    // Cutting and mixing don't wait; soaking and thawing do
    if (t.passiveMin > 0 && !/\b(soak|stand|thaw|rise|sit)\b/i.test(t.text)) {
      t.activeMin += t.passiveMin;
      t.passiveMin = 0;
    }
    if (t.activeMin === 0) t.activeMin = t.kind === "prep" ? 2 : 1;
  } else if (t.kind === "cook" && t.activeMin === 0) {
    t.activeMin = Math.min(5, t.passiveMin || 5);
    t.passiveMin = Math.max(0, t.passiveMin - t.activeMin);
  }
  if (t.activeMin + t.passiveMin === 0) {
    const m = DEFAULT_MINUTES[t.kind] ?? 5;
    if (PASSIVE_KINDS.has(t.kind)) { t.activeMin = 2; t.passiveMin = m; } else t.activeMin = m;
    fixes.push(`${t.id}: no time given; used ${m} min`);
  }
}

/** Pulls task times back toward the recipe's own step times when they're far off */
function reconcileWithSteps(recipe: RecipeSource, tasks: RecipeTask[], fixes: string[]) {
  const steps = recipe.normalizedInstructions ?? [];
  const stepByNumber = new Map(steps.map((s, i) => [s.stepNumber ?? i + 1, s]));
  for (const [n, step] of Array.from(stepByNumber)) {
    const minutes = stepMinutes(step);
    if (!minutes) continue;
    // Cutting tasks pulled out of a step don't count toward its stated time
    const own = tasks.filter((t) => t.fromSteps.includes(n) && t.kind !== "prep" && t.fromSteps.length === 1);
    if (!own.length) continue;
    const total = own.reduce((s, t) => s + t.activeMin + t.passiveMin, 0);
    if (total <= minutes * 2.5 + 5 && total >= minutes * 0.4 - 2) continue;
    const factor = minutes / Math.max(total, 1);
    for (const t of own) {
      if (t.passiveMin > 0) t.passiveMin = Math.max(1, Math.round(t.passiveMin * factor));
      else t.activeMin = Math.max(1, Math.round(t.activeMin * factor));
    }
    fixes.push(`step ${n}: tasks took ${total} min against the recipe's ${minutes}; rescaled`);
  }
}

/** Oven temperatures the recipe mentions, by step number */
function recipeOvenTemps(recipe: RecipeSource): Map<number, number> {
  const temps = new Map<number, number>();
  (recipe.normalizedInstructions ?? []).forEach((s, i) => {
    const f = stepTempF(s);
    if (f && f >= 200 && /oven|bake|roast|broil|preheat/i.test(`${s.text} ${s.stepType ?? ""}`)) temps.set(s.stepNumber ?? i + 1, f);
  });
  if (!temps.size) {
    recipe.instructions.forEach((text, i) => {
      const m = text.match(/(\d{3})\s*°?\s*(F|C)?\b/);
      if (m && /oven|bake|roast/i.test(text)) temps.set(i + 1, m[2]?.toUpperCase() === "C" ? cToF(+m[1]) : +m[1]);
    });
  }
  return temps;
}

function ovenTemp(t: RecipeTask, given: unknown, temps: Map<number, number>, fixes: string[]): number {
  let f = Number(given);
  const fromStep = t.fromSteps.map((n) => temps.get(n)).find((v) => v);
  const any = Array.from(temps.values())[0];
  if (!Number.isFinite(f) || f <= 0) {
    f = fromStep ?? any ?? 350;
    fixes.push(`${t.id}: oven temperature missing; used ${f}°F`);
  } else if (f < 150 || (fromStep && Math.abs(cToF(f) - fromStep) < 3 && Math.abs(f - fromStep) > 20)) {
    // The model passed Celsius through
    fixes.push(`${t.id}: ${f}° read as Celsius`);
    f = cToF(f);
  }
  return Math.min(550, Math.max(150, roundTo5(f)));
}

/**
 * Checks and corrects the model's breakdown. Never throws on a bad field;
 * returns null only when there's nothing usable, so the caller falls back
 * to heuristicSteps.
 */
export function validateSteps(
  raw: any,
  recipe: RecipeSource,
): { tasks: RecipeTask[]; atServing: string[]; fixes: string[] } | null {
  const fixes: string[] = [];
  const list: any[] = Array.isArray(raw?.tasks) ? raw.tasks : [];
  const atServing: string[] = Array.isArray(raw?.atServing) ? raw.atServing.filter((s: unknown) => typeof s === "string") : [];
  const temps = recipeOvenTemps(recipe);
  const seen = new Set<string>();
  const tasks: RecipeTask[] = [];
  const renamed = new Map<string, string>();
  const preheatIds = new Map<string, number | null>();

  list.forEach((r, i) => {
    if (!r || typeof r !== "object") return;
    let id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : `t${i + 1}`;
    if (seen.has(id)) { const fresh = `t${i + 1}_${seen.size}`; renamed.set(id, fresh); id = fresh; }
    seen.add(id);
    const text = String(r.text ?? "").trim();
    const kind = toKind(r.kind);
    if (kind === "preheat") { preheatIds.set(id, Number(r.tempF) || null); fixes.push(`${id}: preheat task removed (scheduler adds preheating)`); return; }
    if (kind === "serve") { if (text) atServing.push(text); fixes.push(`${id}: serving step moved to atServing`); return; }
    if (!text) return;
    const ingredients: TaskIngredient[] = (Array.isArray(r.ingredients) ? r.ingredients : [])
      .filter((g: any) => Number.isInteger(g?.index) && g.index >= 0 && g.index < recipe.ingredients.length)
      .map((g: any) => {
        const fraction = Number(g.fraction);
        return {
          index: g.index,
          fraction: Number.isFinite(fraction) && fraction > 0 ? Math.min(1, fraction) : 1,
          prep: typeof g.prep === "string" && g.prep.trim() ? g.prep.trim().toLowerCase() : null,
        };
      });
    let heat: Heat = ["none", "oven", "burner", "appliance"].includes(r.heat) ? r.heat : "none";
    let finalKind: TaskKind = kind ?? (heat === "oven" ? "bake" : heat === "burner" ? "cook" : "assemble");
    if (finalKind === "bake" && heat !== "oven") { heat = "oven"; fixes.push(`${id}: bake task put in the oven`); }
    if (heat === "oven" && !["bake", "rest"].includes(finalKind)) finalKind = "bake";
    if ((finalKind === "simmer" || finalKind === "cook") && heat === "none") heat = "burner";
    const appliance = normalizeAppliance(r.appliance);
    if (heat === "appliance" && !appliance) heat = finalKind === "simmer" || finalKind === "cook" ? "burner" : "none";
    const task: RecipeTask = {
      id,
      text,
      kind: finalKind,
      activeMin: clampMin(r.activeMin, 180),
      passiveMin: clampMin(r.passiveMin),
      heat,
      tempF: null,
      appliance: heat === "appliance" || /blender|processor/.test(appliance ?? "") ? appliance : null,
      vessel: normalizeVessel(r.vessel),
      dependsOn: (Array.isArray(r.dependsOn) ? r.dependsOn : []).map((d: unknown) => String(d)),
      holdMin: Number.isFinite(Number(r.holdMin)) && Number(r.holdMin) >= 0 ? Math.min(24 * 60, Math.round(Number(r.holdMin))) : DEFAULT_HOLD[finalKind] ?? 30,
      doneCue: typeof r.doneCue === "string" && r.doneCue.trim() ? r.doneCue.trim() : null,
      ingredients,
      fromSteps: (Array.isArray(r.fromSteps) ? r.fromSteps : []).map(Number).filter(Number.isInteger),
    };
    if (heat === "oven") task.tempF = ovenTemp(task, r.tempF, temps, fixes);
    tasks.push(task);
  });
  if (!tasks.length) return null;

  // Dependencies on removed preheat tasks just go away; renamed ids follow
  for (const t of tasks) {
    t.dependsOn = t.dependsOn.filter((d) => !preheatIds.has(d)).map((d) => renamed.get(d) ?? d);
  }
  for (const t of tasks) sensibleSplit(t, fixes);
  reconcileWithSteps(recipe, tasks, fixes);
  attachUnusedLines(recipe, tasks, atServing, fixes);
  addMissingCuts(recipe, tasks, fixes);
  return { tasks: orderTasks(tasks, fixes), atServing, fixes };
}

/**
 * A task that adds "4 spring onions, cut" needs someone to cut them first.
 * When no cutting task covers a cut ingredient, add one (so it shows in the
 * prep list and can merge with the same cut in other recipes).
 */
function addMissingCuts(recipe: RecipeSource, tasks: RecipeTask[], fixes: string[]) {
  const cut = new Set(tasks.filter((t) => t.kind === "prep").flatMap((t) => t.ingredients.map((g) => g.index)));
  const added = new Map<number, RecipeTask>();
  for (const t of tasks.slice()) {
    if (t.kind === "prep") continue;
    for (const g of t.ingredients) {
      const raw = recipe.ingredients[g.index] ?? "";
      const form = normalizePrepForm(g.prep) ?? normalizePrepForm(raw);
      if (!form || cut.has(g.index)) continue;
      // Cheese usually comes grated; canned and jarred things come cut
      if (form === "grated" && /cheese|parm/i.test(raw)) continue;
      if (/\b(can|canned|jar|jarred|frozen)\b/i.test(raw)) continue;
      let c = added.get(g.index);
      if (!c) {
        c = blankTask(`cut${g.index}`, `${capitalize(verbFor(form))} the ${plainName(raw)}`, "prep", {
          activeMin: form === "juiced" || form === "zested" ? 2 : 3,
          ingredients: [{ index: g.index, fraction: g.fraction, prep: form }],
          fromSteps: t.fromSteps,
        });
        added.set(g.index, c);
        tasks.push(c);
        fixes.push(`added a task to ${verbFor(form)} line ${g.index} ("${raw}")`);
      }
      if (!t.dependsOn.includes(c.id)) t.dependsOn.push(c.id);
    }
  }
}

// ---------- No-AI fallback ----------

function guessKind(step: NormalizedStep): TaskKind | "preheat" | "serve" {
  const fromType = toKind(step.stepType);
  const text = step.text.toLowerCase();
  if (/^\s*(step \d+:\s*)?preheat/.test(text)) return "preheat";
  if (fromType === "preheat" || fromType === "serve") return fromType;
  if (/\b(bake|roast|broil)\b|in the oven/.test(text)) return "bake";
  if (/\bmarinat/.test(text)) return "marinate";
  if (/\b(refrigerate|chill)\b/.test(text)) return "chill";
  if (/\bsimmer|\bboil\b|cook,? covered|slow cooker/.test(text)) return "simmer";
  if (/\b(let (it )?(rest|stand|cool))\b/.test(text)) return "rest";
  if (/\b(saut|brown|sear|fry|melt|heat (the )?(oil|butter|pan|skillet))/.test(text)) return "cook";
  if (fromType && fromType !== "prep") return fromType;
  if (/\b(dice|chop|mince|slice|peel|grate|cut|wash)\b/.test(text)) return "prep";
  return fromType ?? "assemble";
}

/** Tasks from the normalized steps without AI: one per step, in order, plus a cutting task per cut ingredient */
export function heuristicSteps(recipe: RecipeSource): { tasks: RecipeTask[]; atServing: string[]; fixes: string[] } {
  const steps: NormalizedStep[] = recipe.normalizedInstructions?.length
    ? recipe.normalizedInstructions
    : recipe.instructions.map((text, i) => ({ stepNumber: i + 1, text }));
  const temps = recipeOvenTemps(recipe);
  const tasks: RecipeTask[] = [];
  const atServing: string[] = [];
  const cutTaskForLine = new Map<number, string>();
  const words = recipe.ingredients.map(lineWords);

  recipe.ingredients.forEach((raw, index) => {
    const form = normalizePrepForm(raw);
    if (!form || form === "juiced" || isOptionalLine(raw)) return;
    const name = plainName(raw);
    const id = `c${index}`;
    cutTaskForLine.set(index, id);
    tasks.push(blankTask(id, `${capitalize(verbFor(form))} the ${name.toLowerCase()}`, "prep", {
      activeMin: 3, ingredients: [{ index, fraction: 1, prep: form }],
    }));
  });

  let previous: string | null = null;
  steps.forEach((step, i) => {
    const n = step.stepNumber ?? i + 1;
    const kind = guessKind(step);
    const text = step.text.replace(/^\s*step \d+:\s*/i, "").trim();
    if (kind === "preheat") return;
    if (kind === "serve") { atServing.push(text); return; }
    const minutes = stepMinutes(step) ?? DEFAULT_MINUTES[kind];
    const passive = PASSIVE_KINDS.has(kind);
    const lower = text.toLowerCase();
    const named = new Set((step.ingredients ?? []).map((s) => s.toLowerCase()));
    const lines = recipe.ingredients
      .map((_, index) => index)
      .filter((index) => words[index].length && words[index].some((w) => lower.includes(w) || Array.from(named).some((s) => s.includes(w))));
    const appliance = lower.match(/\b(blender|food processor|slow cooker|instant pot|rice cooker)\b/)?.[1] ?? null;
    const heat: Heat = kind === "bake" ? "oven" : appliance && !/blender|processor/.test(appliance) ? "appliance" : kind === "cook" || kind === "simmer" ? "burner" : "none";
    const id = `s${n}`;
    const task = blankTask(id, text, kind, {
      activeMin: passive ? Math.min(3, minutes) : minutes,
      passiveMin: passive ? Math.max(0, minutes - Math.min(3, minutes)) : 0,
      heat,
      tempF: heat === "oven" ? temps.get(n) ?? Array.from(temps.values())[0] ?? 350 : null,
      appliance,
      doneCue: step.donenessCue ?? null,
      fromSteps: [n],
      ingredients: lines.map((index) => ({ index, fraction: 1, prep: normalizePrepForm(recipe.ingredients[index]) })),
    });
    task.dependsOn = [
      ...(previous ? [previous] : []),
      ...lines.map((l) => cutTaskForLine.get(l)).filter((c): c is string => !!c),
    ];
    if (kind === "prep" && lines.length && lines.every((l) => cutTaskForLine.has(l))) {
      // The step is just the cutting we already split out
      task.activeMin = 1;
    }
    tasks.push(task);
    previous = id;
  });
  const fixes = ["built without AI from the recipe's steps"];
  attachUnusedLines(recipe, tasks, atServing, fixes);
  for (const t of tasks) sensibleSplit(t, fixes);
  return { tasks: orderTasks(tasks, fixes), atServing, fixes };
}

function blankTask(id: string, text: string, kind: TaskKind, extra: Partial<RecipeTask>): RecipeTask {
  return {
    id, text, kind, activeMin: 0, passiveMin: 0, heat: "none", tempF: null, appliance: null, vessel: null,
    dependsOn: [], holdMin: DEFAULT_HOLD[kind] ?? 30, doneCue: null, ingredients: [], fromSteps: [], ...extra,
  };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "diced" -> "dice", for task text */
export function verbFor(form: string): string {
  const verbs: Record<string, string> = {
    minced: "mince", diced: "dice", chopped: "chop", sliced: "slice", grated: "grate",
    juiced: "juice", zested: "zest", crushed: "crush", halved: "halve",
  };
  return verbs[form] ?? "prepare";
}

// ---------- Scaling ----------

/**
 * Task times for a batch `scale` times the recipe. Hands-on work grows
 * slower than the amount (chopping 2 onions isn't twice as long as 1 once
 * the board is out), and waiting barely grows: a pot of chili simmers an
 * hour whatever its size; a fuller oven or pot takes a little longer.
 */
export function scaleTask(task: Pick<RecipeTask, "kind" | "activeMin" | "passiveMin">, scale: number): { activeMin: number; passiveMin: number } {
  const s = Math.max(0.25, scale);
  const pow = (e: number) => Math.pow(s, e);
  const grow = (k: number) => (s >= 1 ? 1 + k * (s - 1) : 1 - k * 0.5 * (1 - s));
  const e: Record<string, [number, number]> = {
    // [hands-on exponent, waiting growth per extra batch]
    prep: [0.85, 0], assemble: [0.6, 0], cook: [0.7, 0.4], simmer: [0.3, 0.1], bake: [0.5, 0.15],
    rest: [0.3, 0], chill: [0.3, 0.1], marinate: [0.5, 0],
  };
  const [activeExp, passiveGrow] = e[task.kind] ?? [0.7, 0];
  return {
    activeMin: task.activeMin * pow(activeExp),
    passiveMin: task.passiveMin * grow(passiveGrow),
  };
}
