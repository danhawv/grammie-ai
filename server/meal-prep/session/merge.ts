import type {
  Adjuster, CookBatch, IngredientLine, MealSlot, Plate, PrepPlan, PrepSetup, PrepTask, RecipeFacts, TaskKind,
} from "@shared/meal-prep/contract";
import { humanAmount, countedWeight, niceNumber } from "@shared/meal-prep/amounts";
import { componentFor, isCookedLine, rawGrams, type ComponentDef } from "./components";
import { normalizePrepForm, scaleTask, verbFor } from "./structure";
import type { RecipeSteps, RecipeTask } from "./types";

// Builds the session's task graph from each batch's structured steps:
//  - scales and pads task times (batch size, cook's skill)
//  - merges the same cut of the same ingredient across recipes into one task
//    ("Dice 3 onions: 1 for Chili, 2 for Soup")
//  - cooks shared components once (rice for two recipes and the plates)
//  - lines oven tasks up by temperature (roasts may move ±25°F; bakes don't)
//  - adds portioning, cooling, fridge and wash-up at the end
// The scheduler (schedule.ts) then places it in time.

export interface GraphTask extends PrepTask {
  /** tasks with the same key use the same pot or pan, one after another */
  vessel: { key: string; kind: string } | null;
  /** roasting may share an oven within ±25°F; baking needs its exact temperature */
  ovenMode?: "bake" | "roast";
  role?: "cut" | "component" | "portion" | "cool" | "store";
  /** pots this task empties: the finished dish stays in its pot until it's portioned */
  releases?: string[];
  /** for "store" tasks: the cooking tasks whose end starts the 2-hour fridge clock */
  fridgeClockFrom?: string[];
}

export interface BatchInput {
  batch: CookBatch;
  facts: RecipeFacts;
  steps: RecipeSteps;
}

export interface SessionGraph {
  tasks: GraphTask[];
  /** merged cutting and measuring, for the mise en place list */
  mise: Array<{ id: string; text: string; recipeIds: string[] }>;
  components: Array<{ def: ComponentDef; rawGrams: number; taskIds: string[] }>;
  notes: string[];
  containers: number;
  containerGrams: number[];
  /** containers going to the fridge and the freezer (extra servings are frozen) */
  fridgeCount: number;
  freezerCount: number;
}

export const SKILL_PAD: Record<PrepSetup["session"]["skill"], number> = { beginner: 0.3, home: 0.1, pro: 0 };

const FLUFF = /^(hearty|easy|quick|simple|best|classic|the|my|homemade|healthy|one[- ]pan|one[- ]pot|sheet[- ]pan|crispy|creamy|juicy|leveled[- ]up)\s+/i;

/**
 * Storage notes that change how a container is packed ("keep the sauce in a
 * separate cup"), not make-ahead advice ("keep the topping separate until
 * just before baking").
 */
export function packSeparately(note: string): boolean {
  return /separate/i.test(note) && !/bak|assembl|in advance|before (cooking|serving the casserole)|until just before/i.test(note);
}

/** A storage note short enough for a label: the first sentence, without the "why" */
export function shortNote(note: string): string {
  return note.split(/(?<=[.!?])\s/)[0].replace(/\s+(to prevent|so that|so the|because)\b.*$/i, "").replace(/[.;\s]+$/, "");
}

/** "Hearty Mexican-Style Beef and Bean Chili" -> "Bean Chili": short enough to start a task line */
export function shortTitle(title: string): string {
  let t = title.replace(/\([^)]*\)/g, "").replace(/\s+(with|w\/)\s+.*$/i, "").replace(/["“”]/g, "").trim();
  for (let i = 0; i < 3; i++) t = t.replace(FLUFF, "");
  if (t.length <= 28) return t;
  const words = t.split(/[\s,]+/).filter((w) => w && !/^(and|&|or|of|the|a)$/i.test(w));
  return words.slice(-2).join(" ");
}

const ceilMin = (n: number) => (n <= 0 ? 0 : Math.max(1, Math.ceil(n - 0.05)));

function resourcesFor(kind: TaskKind, active: number, heat: string, tempF: number | null, appliance: string | null, racks: number, cut: boolean): PrepTask["resources"] {
  const r: PrepTask["resources"] = [];
  if (active > 0) r.push({ kind: "cook", qty: 1 });
  if (cut) r.push({ kind: "board", qty: 1 });
  if (heat === "oven") r.push({ kind: "oven", qty: racks, tempF: tempF ?? 350 });
  if (heat === "burner") r.push({ kind: "burner", qty: 1 });
  if (appliance) r.push({ kind: "appliance", name: appliance, qty: 1 });
  return r;
}

const CUT_TEXT = /\b(dice|chop|mince|slice|cut|grate|peel|julienne|cube|trim|shred)\b/i;

function isRoast(t: { text: string; vessel: string | null }): boolean {
  if (/\broast|broil/i.test(t.text)) return true;
  return t.vessel === "sheet pan" && !/\bbake\b/i.test(t.text);
}

interface LineUse {
  lineIndex: number;
  line: IngredientLine | undefined;
  grams: number | null;
}

function lineUse(facts: RecipeFacts, index: number, fraction: number, scale: number): LineUse {
  const line = facts.lines.find((l) => l.index === index);
  return { lineIndex: index, line, grams: line?.grams != null ? line.grams * fraction * scale : null };
}

/** Plates that need a container: everything kept in the fridge or freezer */
function storedPlates(plan: PrepPlan): Plate[] {
  return plan.plates.filter((p) => p.storage !== "fresh");
}

const SLOT_ORDER: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

export function buildGraph(setup: PrepSetup, plan: PrepPlan, batches: BatchInput[], adjusters: Adjuster[]): SessionGraph {
  const pad = 1 + (SKILL_PAD[setup.session.skill] ?? 0.1);
  const tasks: GraphTask[] = [];
  const notes: string[] = [];
  const short = new Map(batches.map((b) => [b.facts.recipeId, shortTitle(b.facts.title)]));
  const riceCooker = setup.kitchen.appliances.some((a) => /rice cooker/i.test(a.kind) && a.count > 0);
  const padActive = (m: number) => ceilMin(m * pad);

  // ---- 1. Each batch's tasks, scaled and padded ----
  const sinksByRecipe = new Map<string, string[]>();
  const componentUses: Array<{ def: ComponentDef; raw: number; recipeId: string | null; dependents: string[]; label: string }> = [];
  const cutCandidates: Array<{ task: GraphTask; recipeId: string; use: LineUse; form: string; canonical: string }> = [];
  const componentCuts: Array<{ taskId: string; def: ComponentDef; note: string }> = [];
  const componentAtPortion: Array<{ recipeId: string; def: ComponentDef }> = [];

  batches.forEach((b, bi) => {
    const { facts, steps, batch } = b;
    const prefix = `r${bi + 1}`;
    const id = (local: string) => `${prefix}.${local}`;
    const name = short.get(facts.recipeId)!;
    const label = batch.scale !== 1 ? `${name} (×${niceNumber(batch.scale)})` : name;
    const dependedOn = new Set(steps.tasks.flatMap((t) => t.dependsOn));
    const componentLines = new Map<number, ComponentDef>();
    // Lines the recipe's own steps cook ("cook the chicken strips in a skillet") aren't shared components
    const cookedHere = new Set(steps.tasks
      .filter((t) => t.heat !== "none" && ["cook", "simmer", "bake"].includes(t.kind))
      .flatMap((t) => t.ingredients.map((g) => g.index)));
    for (const line of facts.lines) {
      if (cookedHere.has(line.index)) continue;
      if (!isCookedLine(line.raw, line.prep, line.ingredient?.id ?? null)) continue;
      const def = componentFor(`${line.ingredient?.name ?? ""} ${line.raw}`);
      if (def) componentLines.set(line.index, def);
    }
    const componentDependents = new Map<ComponentDef, string[]>();

    for (const t of steps.tasks) {
      const scaled = scaleTask(t, batch.scale);
      const active = padActive(scaled.activeMin);
      const passive = Math.round(scaled.passiveMin);
      const racks = t.heat === "oven" && batch.scale >= 1.75 ? 2 : 1;
      const cutForms = t.ingredients.map((g) => normalizePrepForm(g.prep ?? facts.lines.find((l) => l.index === g.index)?.prep));
      const cut = t.kind === "prep" && (CUT_TEXT.test(t.text) || cutForms.some(Boolean));
      const appliance = t.heat === "appliance" || /blender|processor/.test(t.appliance ?? "") ? t.appliance : null;
      const gt: GraphTask = {
        id: id(t.id),
        recipeIds: [facts.recipeId],
        text: `${label}: ${t.text}`,
        kind: t.kind,
        activeMin: active,
        passiveMin: passive,
        resources: resourcesFor(t.kind, active, t.heat, t.tempF, appliance, racks, cut),
        dependsOn: t.dependsOn.map(id),
        holdMin: t.holdMin,
        ...(t.doneCue ? { doneCue: t.doneCue } : {}),
        vessel: t.vessel ? { key: `${prefix}:${t.vessel}`, kind: t.vessel } : null,
        ...(t.heat === "oven" ? { ovenMode: isRoast(t) ? "roast" as const : "bake" as const } : {}),
      };
      // Cutting an already-cooked component ("dice the cooked chicken") is
      // folded into the component's last step instead
      if (t.kind === "prep" && t.ingredients.length === 1 && componentLines.has(t.ingredients[0].index)) {
        const def = componentLines.get(t.ingredients[0].index)!;
        componentCuts.push({ taskId: gt.id, def, note: `${cutForms[0] ?? "cut"} for ${name}` });
        continue;
      }
      tasks.push(gt);

      // Uses of already-cooked components wait for the shared component
      for (const g of t.ingredients) {
        const def = componentLines.get(g.index);
        if (def) {
          componentDependents.set(def, [...(componentDependents.get(def) ?? []), gt.id]);
        }
      }
      // Single-ingredient cutting tasks are candidates for merging across recipes
      if (t.kind === "prep" && t.dependsOn.length === 0 && t.ingredients.length === 1 && cutForms[0]) {
        const use = lineUse(facts, t.ingredients[0].index, t.ingredients[0].fraction, batch.scale);
        const canonical = use.line?.ingredient?.id;
        if (canonical && !componentLines.has(use.lineIndex)) {
          gt.role = "cut";
          cutCandidates.push({ task: gt, recipeId: facts.recipeId, use, form: cutForms[0]!, canonical });
        }
      }
    }
    // Components this recipe uses, once per line
    for (const [lineIndex, def] of Array.from(componentLines)) {
      const line = facts.lines.find((l) => l.index === lineIndex)!;
      const dependents = componentDependents.get(def) ?? [];
      // A component no task uses ("serve over rice") goes in the containers: portioning waits for it
      if (!dependents.length) componentAtPortion.push({ recipeId: facts.recipeId, def });
      // No amount on the line: assume the component's usual batch
      const raw = line.grams != null ? rawGrams(def, line.grams * batch.scale, def.lineAmountIs) : def.baseRawGrams * batch.scale;
      componentUses.push({ def, raw, recipeId: facts.recipeId, dependents, label: name });
    }
    sinksByRecipe.set(facts.recipeId, steps.tasks.filter((t) => !dependedOn.has(t.id) && t.kind !== "prep").map((t) => id(t.id)));
    if (!sinksByRecipe.get(facts.recipeId)!.length) sinksByRecipe.set(facts.recipeId, steps.tasks.slice(-1).map((t) => id(t.id)));
    for (const s of steps.atServing) notes.push(`${name}, at mealtime: ${s}`);
  });

  // ---- 2. Merge the same cut of the same ingredient ----
  const mise: SessionGraph["mise"] = [];
  const replaced = new Map<string, string>();
  const groups = new Map<string, typeof cutCandidates>();
  for (const c of cutCandidates) {
    const key = `${c.canonical}|${c.form}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  let mergeN = 0;
  for (const group of Array.from(groups.values())) {
    const first = group[0];
    const ing = first.use.line!.ingredient!;
    if (group.length < 2) {
      const amount = first.use.grams != null ? ` (${humanAmount(first.use.grams, ing)})` : "";
      first.task.text = `${first.task.text}${amount}`;
      mise.push({ id: first.task.id, text: first.task.text, recipeIds: [first.recipeId] });
      continue;
    }
    const mergedId = `m${++mergeN}`;
    const byRecipe = new Map<string, number | null>();
    for (const c of group) {
      const prev = byRecipe.get(c.recipeId);
      byRecipe.set(c.recipeId, prev === undefined ? c.use.grams : prev == null || c.use.grams == null ? null : prev + c.use.grams);
    }
    const allKnown = Array.from(byRecipe.values()).every((g) => g != null);
    const rawTotal = allKnown ? Array.from(byRecipe.values()).reduce((s: number, g) => s + (g ?? 0), 0) : null;
    const verb = verbFor(first.form);
    const counted = countedWeight(ing);
    // Counted things: the total is the sum of the rounded parts, so "1½: ½ for A, 1 for B" adds up
    let total = rawTotal;
    if (counted && total != null) {
      total = Array.from(byRecipe.values()).reduce((s: number, g) => s + Math.max(0.5, Math.round((g ?? 0) / counted.grams * 2) / 2), 0) * counted.grams;
    }
    const amountOf = (g: number) => (counted ? humanAmount(g, ing).replace(/^(\S+)\s.*$/, "$1") : humanAmount(g, ing));
    const names = Array.from(byRecipe.keys()).map((r) => short.get(r)!);
    const what = total != null ? `${humanAmount(total, ing)}${counted ? "" : ` ${ing.name.toLowerCase()}`}` : `the ${ing.name.toLowerCase()}`;
    const text = byRecipe.size === 1
      ? `${names[0]}: ${cap(verb)} ${what}`
      : total != null
        ? `${cap(verb)} ${what}: ${Array.from(byRecipe.entries()).map(([r, g]) => `${amountOf(g!)} for ${short.get(r)}`).join(", ")}`
        : `${cap(verb)} ${what} for ${joinAnd(names)}`;
    const actives = group.map((c) => c.task.activeMin);
    const max = Math.max(...actives);
    // One board, one knife session: later portions go faster than the first
    const active = ceilMin(max + 0.7 * (actives.reduce((s, a) => s + a, 0) - max));
    const merged: GraphTask = {
      id: mergedId,
      recipeIds: Array.from(byRecipe.keys()),
      text,
      kind: "prep",
      activeMin: active,
      passiveMin: 0,
      resources: [{ kind: "cook", qty: 1 }, { kind: "board", qty: 1 }],
      dependsOn: [],
      holdMin: Math.min(...group.map((c) => c.task.holdMin)),
      vessel: null,
      role: "cut",
    };
    for (const c of group) replaced.set(c.task.id, mergedId);
    tasks.push(merged);
    mise.push({ id: mergedId, text, recipeIds: merged.recipeIds });
  }
  let graph = tasks.filter((t) => !replaced.has(t.id));
  for (const t of graph) t.dependsOn = Array.from(new Set(t.dependsOn.map((d) => replaced.get(d) ?? d)));

  // ---- 3. Shared components (recipe lines + plate adjusters), cooked once ----
  const adjusterById = new Map(adjusters.map((a) => [a.id, a]));
  const lastComponentTask = new Map<string, string>();
  const replacedCuts = new Map<string, string>();
  for (const [adjId, grams] of Object.entries(plan.adjusterCooking ?? {})) {
    const adj = adjusterById.get(adjId);
    if (!adj || !adj.needsCooking || !(grams > 0)) continue;
    const def = componentFor(`${adj.ingredient.name} ${adj.name}`);
    if (def) {
      // Adjuster grams are cooked weight (what goes on the plate)
      componentUses.push({ def, raw: rawGrams(def, grams, "cooked"), recipeId: null, dependents: [], label: "plates" });
    } else {
      // Something to cook we have no recipe for: one plain task
      const t: GraphTask = {
        id: `a.${adjId}`, recipeIds: [], text: `Cook ${humanAmount(grams, adj.ingredient)} ${adj.name.toLowerCase()} for the plates`,
        kind: "cook", activeMin: padActive(10), passiveMin: 10, resources: [{ kind: "cook", qty: 1 }, { kind: "burner", qty: 1 }],
        dependsOn: [], holdMin: 30, vessel: { key: `a.${adjId}:skillet`, kind: "skillet" }, role: "component",
      };
      graph.push(t);
      lastComponentTask.set(`adj:${adjId}`, t.id);
    }
  }
  const componentGroups = new Map<string, typeof componentUses>();
  for (const u of componentUses) componentGroups.set(u.def.key, [...(componentGroups.get(u.def.key) ?? []), u]);
  const components: SessionGraph["components"] = [];
  for (const [key, uses] of Array.from(componentGroups)) {
    const def = uses[0].def;
    const raw = uses.reduce((s, u) => s + u.raw, 0);
    const scale = raw / def.baseRawGrams;
    const who = joinAnd(Array.from(new Set(uses.map((u) => u.label))));
    const amount = humanAmount(raw, { id: def.key, name: def.name });
    const ids: string[] = [];
    def.steps({ riceCooker }).forEach((s, i) => {
      const scaled = scaleTask(s, scale);
      const active = padActive(scaled.activeMin);
      const tid = `c.${key}.${i + 1}`;
      const text = i === 0 ? `${s.text} (${amount}${def.lineAmountIs === "cooked" ? " uncooked" : ""}, for ${who})` : s.text;
      graph.push({
        id: tid, recipeIds: uses.map((u) => u.recipeId).filter((r): r is string => !!r),
        text: `${cap(def.name)}: ${text}`, kind: s.kind, activeMin: active, passiveMin: Math.round(scaled.passiveMin),
        resources: resourcesFor(s.kind, active, s.heat, s.tempF ?? null, s.appliance ?? null, s.heat === "oven" && scale > 1.6 ? 2 : 1, s.kind === "prep" && CUT_TEXT.test(s.text)),
        dependsOn: ids.length ? [ids[ids.length - 1]] : [], holdMin: s.holdMin,
        ...(s.doneCue ? { doneCue: s.doneCue } : {}),
        vessel: s.vessel ? { key: `c.${key}:${s.vessel}`, kind: s.vessel } : null,
        ...(s.heat === "oven" ? { ovenMode: "roast" as const } : {}),
        role: "component",
      });
      ids.push(tid);
    });
    const last = ids[ids.length - 1];
    lastComponentTask.set(key, last);
    for (const c of componentAtPortion) if (c.def.key === key) sinksByRecipe.get(c.recipeId)?.push(last);
    const cuts = componentCuts.filter((c) => c.def.key === key);
    if (cuts.length) {
      const lastTask = graph.find((g) => g.id === last)!;
      lastTask.text += ` (${joinAnd(cuts.map((c) => c.note))})`;
      for (const c of cuts) replacedCuts.set(c.taskId, last);
    }
    for (const u of uses) for (const d of u.dependents) {
      const t = graph.find((g) => g.id === d);
      if (t && !t.dependsOn.includes(last)) t.dependsOn.push(last);
    }
    components.push({ def, rawGrams: raw, taskIds: ids });
    if (def.safety) notes.push(def.safety);
  }

  for (const t of graph) t.dependsOn = Array.from(new Set(t.dependsOn.map((d) => replacedCuts.get(d) ?? d)));

  // ---- 4. Oven temperatures: roasts join a nearby temperature ----
  groupOvenTemps(graph);

  // ---- 5. Portion, cool, fridge (washing up is fitted in by the scheduler) ----
  const { containers, containerGrams, fridgeCount, freezerCount } = addPortioning(setup, plan, batches, adjusters, graph, sinksByRecipe, lastComponentTask, short, padActive);
  return { tasks: graph, mise, components, notes, containers, containerGrams, fridgeCount, freezerCount };
}

/**
 * Roasts move to a temperature within 25°F that's already in use (a bake's
 * exact temperature first, then other roasts), so one oven can hold them
 * together. Roasting a little cooler takes a little longer.
 */
export function groupOvenTemps(tasks: GraphTask[]) {
  const oven = (t: GraphTask) => t.resources.find((r) => r.kind === "oven");
  const bakes = tasks.filter((t) => oven(t) && t.ovenMode !== "roast");
  const roasts = tasks.filter((t) => oven(t) && t.ovenMode === "roast");
  const anchors = Array.from(new Set(bakes.map((t) => oven(t)!.tempF!)));
  // Most common roast temperatures become anchors first
  const counts = new Map<number, number>();
  for (const t of roasts) counts.set(oven(t)!.tempF!, (counts.get(oven(t)!.tempF!) ?? 0) + 1);
  const byPopularity = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0]).map(([f]) => f);
  for (const f of byPopularity) if (!anchors.some((a) => Math.abs(a - f) <= 25)) anchors.push(f);
  for (const t of roasts) {
    const r = oven(t)!;
    const from = r.tempF!;
    const to = anchors.filter((a) => Math.abs(a - from) <= 25).sort((a, b) => Math.abs(a - from) - Math.abs(b - from) || (bakes.some((x) => oven(x)!.tempF === a) ? -1 : 1))[0];
    if (to == null || to === from) continue;
    r.tempF = to;
    // About 2% longer per 5°F cooler (and shorter when hotter)
    t.passiveMin = Math.max(1, Math.round(t.passiveMin * (1 + 0.004 * (from - to))));
    t.text = `${t.text} (at ${to}°F with the other oven dishes)`;
  }
}

function addPortioning(
  setup: PrepSetup, plan: PrepPlan, batches: BatchInput[], adjusters: Adjuster[], graph: GraphTask[],
  sinksByRecipe: Map<string, string[]>, lastComponentTask: Map<string, string>, short: Map<string, string>,
  padActive: (m: number) => number,
): { containers: number; containerGrams: number[]; fridgeCount: number; freezerCount: number } {
  const adjusterById = new Map(adjusters.map((a) => [a.id, a]));
  const people = new Map(setup.people.map((p) => [p.id, p.name]));
  const plates = storedPlates(plan).sort((a, b) => a.day - b.day || SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  const groups = new Map<string, Plate[]>();
  for (const p of plates) {
    const main = p.items.find((i) => i.kind === "recipe") ?? p.items[0];
    if (!main) continue;
    const key = main.kind === "recipe" ? main.refId : `adj:${main.refId}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const itemName = (kind: string, ref: string) =>
    kind === "recipe" ? short.get(ref) ?? "dish" : plainAdjusterName(adjusterById.get(ref)?.name ?? ref);
  const itemText = (i: Plate["items"][number]) =>
    i.grams != null ? `${Math.round(i.grams / 5) * 5} g ${itemName(i.kind, i.refId)}`
      : i.kind === "recipe" ? `${niceNumber(i.amount)} ${i.amount > 1 ? "servings" : "serving"} ${itemName(i.kind, i.refId)}`
      : `${Math.round(i.amount)} g ${itemName(i.kind, i.refId)}`;

  // Servings made but not on any plate: extra containers to freeze or share
  const plated = new Map<string, number>();
  for (const p of plan.plates) for (const i of p.items) if (i.kind === "recipe") plated.set(i.refId, (plated.get(i.refId) ?? 0) + i.amount);
  const recipeOrder = batches.map((b) => b.facts.recipeId);
  for (const b of batches) if (!groups.has(b.facts.recipeId) && b.batch.servingsMade > 0) groups.set(b.facts.recipeId, []);

  let containers = 0;
  let fridgeCount = 0;
  let freezerCount = 0;
  const containerGrams: number[] = [];
  const keys = Array.from(groups.keys()).sort((a, b) => recipeOrder.indexOf(a) - recipeOrder.indexOf(b));
  for (const key of keys) {
    const group = groups.get(key)!;
    const recipeId = key.startsWith("adj:") ? null : key;
    const batch = recipeId ? batches.find((b) => b.facts.recipeId === recipeId) : undefined;
    const extra = batch ? Math.floor((batch.batch.servingsMade - (plated.get(recipeId!) ?? 0)) + 0.4) : 0;
    const n = group.length + Math.max(0, extra);
    if (!n) continue;
    containers += n;
    for (const p of group) containerGrams.push(p.items.reduce((s, i) => s + (i.grams ?? 0), 0));
    for (let i = 0; i < Math.max(0, extra); i++) containerGrams.push(0);

    // What each container gets, grouped by person when they differ
    const lines = new Map<string, { who: string; count: number }>();
    for (const p of group) {
      const desc = p.items.map(itemText).join(" + ");
      const k = `${p.personId}|${desc}`;
      const prev = lines.get(k);
      lines.set(k, { who: people.get(p.personId) ?? "", count: (prev?.count ?? 0) + 1 });
    }
    const descs = Array.from(lines.entries()).map(([k, v]) => ({ desc: k.split("|")[1], ...v }));
    const sameForAll = new Set(descs.map((d) => d.desc)).size === 1;
    const name = recipeId ? short.get(recipeId)! : itemName("adjuster", key.slice(4));
    let text = !group.length ? `Portion ${name}`
      : sameForAll ? `Fill ${group.length} ${group.length > 1 ? "containers" : "container"}: ${descs[0].desc}${group.length > 1 ? " each" : ""}`
      : `Fill ${group.length} containers: ${descs.map((d) => `${d.who} ×${d.count}: ${d.desc}`).join("; ")}`;
    if (extra > 0) text += `${group.length ? "; then" : ""} ${extra} extra ${extra > 1 ? "servings" : "serving"} of ${name} to freeze or share`;
    const sepNotes = new Set<string>();
    for (const p of group) for (const i of p.items) {
      const notes = i.kind === "recipe" ? batches.find((b) => b.facts.recipeId === i.refId)?.facts.storage.notes : adjusterById.get(i.refId)?.storage.notes;
      for (const note of notes ?? []) if (packSeparately(note)) sepNotes.add(shortNote(note));
    }
    if (sepNotes.size) text += ` (${Array.from(sepNotes).join("; ")})`;

    // Waits for every dish and component that goes in these containers
    const deps = new Set<string>();
    const hotFrom = new Set<string>();
    const releases = new Set<string>();
    const itemsHere = group.flatMap((p) => p.items);
    if (recipeId) itemsHere.push({ kind: "recipe", refId: recipeId, amount: 0, grams: null, macros: { kcal: 0, protein: 0, carbs: 0, fat: 0 } });
    for (const i of itemsHere) {
      if (i.kind === "recipe") {
        for (const s of sinksByRecipe.get(i.refId) ?? []) { deps.add(s); hotFrom.add(s); }
      } else {
        const adj = adjusterById.get(i.refId);
        const comp = adj?.needsCooking ? (componentKey(adj) ?? `adj:${adj.id}`) : null;
        const last = comp ? lastComponentTask.get(comp) : undefined;
        if (last) { deps.add(last); hotFrom.add(last); }
      }
    }
    const tag = recipeId ? recipeId.slice(0, 8) : key.slice(4);
    const hot = Array.from(hotFrom).some((id) => {
      const t = graph.find((g) => g.id === id);
      return t && t.kind !== "chill";
    });
    for (const id of Array.from(deps)) {
      const key = graph.find((g) => g.id === id)?.vessel?.key;
      if (key) releases.add(key);
    }
    const portionId = `p.${tag}`;
    const units = n * Math.max(1, new Set(itemsHere.map((i) => i.refId)).size);
    graph.push({
      id: portionId, recipeIds: recipeId ? [recipeId] : [], text, kind: "portion",
      activeMin: padActive(2 + 0.5 * units), passiveMin: 0, resources: [{ kind: "cook", qty: 1 }],
      dependsOn: Array.from(deps), holdMin: hot ? 30 : 120, vessel: null, role: "portion", releases: Array.from(releases),
    });
    let storeDeps = [portionId];
    if (hot) {
      graph.push({
        id: `k.${tag}`, recipeIds: recipeId ? [recipeId] : [], text: `Let the ${name} containers cool on the counter, lids off`,
        kind: "cool", activeMin: 0, passiveMin: 20, resources: [], dependsOn: [portionId], holdMin: 60, vessel: null,
        role: "cool", doneCue: "Steam has stopped; no more than 2 hours after cooking",
      });
      storeDeps = [`k.${tag}`];
    }
    const freezer = group.filter((p) => p.storage === "freezer").length + Math.max(0, extra);
    const fridge = group.length - group.filter((p) => p.storage === "freezer").length;
    fridgeCount += fridge;
    freezerCount += freezer;
    const where = freezer && fridge ? `${fridge} in the fridge, ${freezer} in the freezer` : freezer ? "into the freezer" : "into the fridge";
    graph.push({
      id: `f.${tag}`, recipeIds: recipeId ? [recipeId] : [], text: `Put lids on the ${name} containers, stick on the labels, and put them ${where}`,
      kind: "portion", activeMin: padActive(1 + 0.3 * n), passiveMin: 0, resources: [{ kind: "cook", qty: 1 }],
      dependsOn: storeDeps, holdMin: 0, vessel: null, role: "store", fridgeClockFrom: Array.from(hotFrom),
    });
  }
  return { containers, containerGrams, fridgeCount, freezerCount };
}

function componentKey(adj: Adjuster): string | null {
  return componentFor(`${adj.ingredient.name} ${adj.name}`)?.key ?? null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Cooked white rice" -> "white rice", "Rice (cooked)" -> "rice": what a label calls an add-on */
export function plainAdjusterName(name: string): string {
  return name.toLowerCase().replace(/\(cooked\)|\bcooked\b/g, "").replace(/\s+/g, " ").replace(/\s+,/g, ",").trim();
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
