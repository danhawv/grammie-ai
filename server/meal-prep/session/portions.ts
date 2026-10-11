import type {
  Adjuster, Confidence, ContainerLabel, Macros, Plate, PrepPlan, PrepSetup, RecipeFacts, ScheduledTask,
} from "@shared/meal-prep/contract";
import { niceNumber } from "@shared/meal-prep/amounts";
import { packSeparately, plainAdjusterName, shortNote, type SessionGraph } from "./merge";
import type { RecipeSteps } from "./types";

// Containers and labels, plus the lists around the session: equipment, the
// day-before checklist and food safety notes. Labels say "may contain" for
// allergens (from ingredients), never "free of".

const CONF_ORDER: Confidence[] = ["low", "medium", "high"];

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.floor(days));
  return d.toISOString().slice(0, 10);
};

/** Allergens of plain add-ons, by name */
const ADJUSTER_ALLERGENS: Array<[RegExp, string]> = [
  [/yogurt|milk|cheese|cottage|whey/i, "Dairy"],
  [/\begg/i, "Eggs"],
  [/bread|pasta|tortilla|wheat|couscous/i, "Gluten"],
  [/peanut/i, "Peanuts"],
  [/almond|walnut|pecan|cashew/i, "Tree Nuts"],
  [/tofu|edamame|soy/i, "Soy"],
  [/salmon|tuna|cod|fish/i, "Fish"],
  [/shrimp|prawn|crab/i, "Shellfish"],
];

function adjusterAllergens(a: Adjuster): string[] {
  return ADJUSTER_ALLERGENS.filter(([re]) => re.test(`${a.name} ${a.ingredient.name}`)).map(([, x]) => x);
}

const roundMacros = (m: Macros): Macros => ({
  kcal: Math.round(m.kcal), protein: Math.round(m.protein), carbs: Math.round(m.carbs), fat: Math.round(m.fat),
  ...(m.fiber != null ? { fiber: Math.round(m.fiber) } : {}),
});

const adjusterLabel = (a: Adjuster | undefined, fallback: string) => plainAdjusterName(a?.name ?? fallback);

export function plateKey(p: Pick<Plate, "personId" | "day" | "slot">): string {
  return `${p.personId}:${p.day}:${p.slot}`;
}

export function buildLabels(setup: PrepSetup, plan: PrepPlan, facts: RecipeFacts[], adjusters: Adjuster[]): ContainerLabel[] {
  const factsById = new Map(facts.map((f) => [f.recipeId, f]));
  const adjById = new Map(adjusters.map((a) => [a.id, a]));
  const people = new Map(setup.people.map((p) => [p.id, p.name]));
  const madeOn = setup.session.date.slice(0, 10);
  const labels: ContainerLabel[] = [];
  for (const plate of plan.plates) {
    if (plate.storage === "fresh") continue;
    const storage = plate.storage;
    const names: string[] = [];
    const portion: string[] = [];
    const reheat = new Set<string>();
    const notes = new Set<string>();
    const allergens = new Set<string>();
    let confidence: Confidence = "high";
    let eatBy = plate.eatBy.slice(0, 10);
    for (const item of plate.items) {
      if (item.kind === "recipe") {
        const f = factsById.get(item.refId);
        const name = f?.title ?? "Dish";
        names.push(name);
        portion.push(item.grams != null
          ? `${Math.round(item.grams / 5) * 5} g ${name}`
          : `${fmtServings(item.amount)} ${name}`);
        if (f) {
          if (f.storage.reheat) reheat.add(f.storage.reheat);
          for (const n of f.storage.notes) if (packSeparately(n)) notes.add(shortNote(n));
          for (const a of f.allergens) allergens.add(a);
          if (CONF_ORDER.indexOf(f.confidence) < CONF_ORDER.indexOf(confidence)) confidence = f.confidence;
          // Never later than the dish keeps
          const days = storage === "freezer" ? f.storage.freezerDays ?? f.storage.fridgeDays : f.storage.fridgeDays;
          const limit = addDays(madeOn, days);
          if (limit < eatBy) eatBy = limit;
        } else confidence = "low";
      } else {
        const a = adjById.get(item.refId);
        const name = adjusterLabel(a, item.refId);
        names.push(name);
        portion.push(`${Math.round((item.grams ?? item.amount) / 5) * 5} g ${name}`);
        if (a) {
          for (const x of adjusterAllergens(a)) allergens.add(x);
          for (const n of a.storage.notes) if (packSeparately(n)) notes.add(shortNote(n));
          const days = storage === "freezer" ? a.storage.freezerDays ?? a.storage.fridgeDays : a.storage.fridgeDays;
          const limit = addDays(madeOn, days);
          if (limit < eatBy) eatBy = limit;
        }
      }
    }
    const reheatText = Array.from(reheat).join(" ") || "Reheat until steaming hot all the way through.";
    labels.push({
      plateKey: plateKey(plate),
      title: names.join(" + "),
      person: people.get(plate.personId) ?? "",
      madeOn,
      eatBy,
      storage,
      macros: roundMacros(plate.macros),
      confidence,
      reheat: storage === "freezer" ? `Thaw overnight in the fridge. ${reheatText}` : reheatText,
      allergens: Array.from(allergens).sort(),
      portion: [portion.join(" + "), ...Array.from(notes).map((n) => n.charAt(0).toLowerCase() + n.slice(1))].join("; "),
    });
  }
  return labels.sort((a, b) => a.eatBy.localeCompare(b.eatBy) || a.person.localeCompare(b.person));
}

function fmtServings(n: number): string {
  return `${niceNumber(n)} ${n > 0 && n <= 1 ? "serving" : "servings"}`;
}

export function containerSizes(grams: number[]): Record<string, number> {
  const sizes: Record<string, number> = {};
  for (const g of grams) {
    const size = g <= 0 ? "medium (3-cup)" : g <= 400 ? "small (2-cup)" : g <= 650 ? "medium (3-cup)" : "large (4-cup)";
    sizes[size] = (sizes[size] ?? 0) + 1;
  }
  return sizes;
}

/** "baking dish" -> "baking dishes" */
const pluralKind = (k: string) => (/(sh|ch|s|x)$/.test(k) ? `${k}es` : `${k}s`);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function equipmentList(setup: PrepSetup, graph: SessionGraph, tasks: ScheduledTask[], containers: number): string[] {
  const list: string[] = [];
  const cooks = Math.max(1, setup.session.cooks);
  list.push(`${plural(cooks, "cutting board")} and ${cooks > 1 ? "sharp knives" : "a sharp knife"}`);
  // Pots and pans: as many of a kind as are in use at the same time
  const chains = new Map<string, { kind: string; start: number; end: number }>();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const g of graph.tasks) {
    if (!g.vessel) continue;
    const t = byId.get(g.id);
    if (!t) continue;
    const c = chains.get(g.vessel.key) ?? { kind: g.vessel.kind, start: t.start, end: t.end };
    c.start = Math.min(c.start, t.start);
    c.end = Math.max(c.end, t.end);
    chains.set(g.vessel.key, c);
  }
  const kinds = new Map<string, number>();
  for (const kind of Array.from(new Set(Array.from(chains.values()).map((c) => c.kind)))) {
    const spans = Array.from(chains.values()).filter((c) => c.kind === kind);
    let peak = 0;
    for (const s of spans) peak = Math.max(peak, spans.filter((o) => o.start < s.end && o.end > s.start && o.start <= s.start).length);
    kinds.set(kind, Math.max(1, peak));
  }
  for (const [kind, n] of Array.from(kinds.entries()).sort()) list.push(n > 1 ? `${n} ${pluralKind(kind)}` : `${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind}`);
  const temps = Array.from(new Set(tasks.filter((t) => t.kind === "preheat").map((t) => t.resources[0]?.tempF).filter(Boolean)));
  if (temps.length) list.push(`Oven (${temps.map((t) => `${t}°F`).join(", then ")})`);
  const apps = new Set(tasks.flatMap((t) => t.resources.filter((r) => r.kind === "appliance").map((r) => r.name!)));
  for (const a of Array.from(apps)) if (!kinds.has(a)) list.push(a.charAt(0).toUpperCase() + a.slice(1));
  if (tasks.some((t) => /°F/.test(t.doneCue ?? ""))) list.push("Instant-read thermometer");
  list.push(`${plural(containers, "container")} with lids`);
  list.push("Labels or masking tape and a marker");
  return list;
}

export function beforeSessionList(
  setup: PrepSetup, plan: PrepPlan, facts: RecipeFacts[], steps: RecipeSteps[], graph: SessionGraph, sizes: Record<string, number>,
): string[] {
  const containers = graph.containers;
  const out: string[] = [];
  const sizeText = Object.entries(sizes).map(([s, n]) => `${n} ${s}`).join(", ");
  const have = setup.kitchen.containers;
  out.push(`Get ${plural(containers, "container")} with lids ready${sizeText ? ` (${sizeText})` : ""}${have != null && have < containers ? `. You have ${have}, so you'll need ${containers - have} more` : ""}.`);
  const meats = new Set<string>();
  const factsById = new Map(facts.map((f) => [f.recipeId, f]));
  for (const b of plan.batches) {
    const f = factsById.get(b.recipeId);
    for (const l of f?.lines ?? []) if (l.ingredient?.aisle === "Meat & Seafood") meats.add(l.ingredient.name.toLowerCase());
  }
  if (meats.size) out.push(`If the ${Array.from(meats).join(", ")} ${meats.size > 1 ? "are" : "is"} frozen, move ${meats.size > 1 ? "them" : "it"} to the fridge 1 to 2 days before to thaw.`);
  for (const s of steps) {
    const long = s.tasks.find((t) => t.kind === "marinate" && t.passiveMin >= 120);
    const f = factsById.get(s.recipeId);
    if (long && f) out.push(`Optional: marinate the ${f.title} the night before. It saves about ${Math.round(long.passiveMin / 60)} hours of waiting.`);
  }
  out.push("Check the pantry items on the shopping list, then shop.");
  const fridge = graph.fridgeCount;
  const freezer = graph.freezerCount;
  out.push(`Clear fridge space for ${plural(fridge, "container")}${freezer ? ` and freezer space for ${freezer}` : ""}.`);
  out.push("Start with an empty sink and dishwasher.");
  if (setup.session.helper) out.push("Share the cook packet with your helper and go over the plan together.");
  return out;
}

export function safetyNotes(setup: PrepSetup, plan: PrepPlan, facts: RecipeFacts[], labels: ContainerLabel[], graph: SessionGraph): string[] {
  const out: string[] = [
    "Portion hot food into shallow containers (2 inches deep or less), let the steam out, and get everything into the fridge within 2 hours of cooking.",
    "Keep the fridge at 40°F or below and the freezer at 0°F.",
  ];
  const factsById = new Map(facts.map((f) => [f.recipeId, f]));
  const used = plan.batches.map((b) => factsById.get(b.recipeId)).filter((f): f is RecipeFacts => !!f);
  const proteins = new Set(used.map((f) => (f.mainProtein ?? "").toLowerCase()));
  const lines = used.flatMap((f) => f.lines.map((l) => `${l.ingredient?.name ?? ""} ${l.raw}`.toLowerCase()));
  if (proteins.has("chicken") || proteins.has("turkey") || lines.some((l) => /chicken|turkey/.test(l)) || graph.components.some((c) => /chicken/.test(c.def.key))) {
    out.push("Cook chicken and turkey to 165°F in the thickest part.");
  }
  if (lines.some((l) => /ground (beef|pork|lamb)|lean beef/.test(l))) out.push("Cook ground beef and pork to 160°F.");
  if (used.some((f) => f.lines.some((l) => l.ingredient?.aisle === "Meat & Seafood"))) {
    out.push("Cut vegetables before raw meat, or use a separate board, and wash hands after handling raw meat.");
  }
  for (const n of graph.notes) if (!/at mealtime/.test(n) && !out.includes(n)) out.push(n);
  out.push("Reheat until steaming hot (165°F) all the way through.");
  // Allergens: "may contain", from ingredients; flag any clash with someone's allergies
  for (const f of used) {
    if (f.allergens.length) out.push(`${f.title} may contain: ${f.allergens.join(", ").toLowerCase()} (from its ingredients).`);
  }
  for (const person of setup.people) {
    if (!person.allergies.length) continue;
    const mine = labels.filter((l) => l.person === person.name);
    const hits = new Set<string>();
    for (const l of mine) for (const a of l.allergens) {
      if (person.allergies.some((x) => a.toLowerCase().includes(x.toLowerCase()) || x.toLowerCase().includes(a.toLowerCase()))) hits.add(`${l.title} (${a.toLowerCase()})`);
    }
    if (hits.size) out.push(`Check before serving ${person.name}: ${Array.from(hits).join(", ")} may contain something on their allergy list.`);
  }
  return out;
}
