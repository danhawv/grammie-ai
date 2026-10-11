import type {
  CookBatch,
  ContainerLabel,
  DayFit,
  Macros,
  MealSlot,
  Plate,
  PlateItem,
  PrepPlan,
  PrepSession,
  PrepSetup,
  ScheduledTask,
  ShoppingList,
} from "@shared/meal-prep/contract";
import type { Confidence, StorageInfo } from "@shared/meal-prep/contract";
import type { CookView, PrepPlanSummary, PrepPlanView, PrepProfile, SwapOptionView, TaskProgress } from "@shared/meal-prep/api";
import { MealPrepApiError } from "./meal-prep-api";
import { addDays, describePlate, eatingDate, macroBar, MACRO_ORDER, prepShare } from "./meal-prep-format";

interface FixtureRecipe {
  id: string;
  title: string;
  imageUrl: string | null;
  why?: string;
  perServing: Macros;
  confidence: Confidence;
  allergens: string[];
  activeMinutes?: number;
  storage: StorageInfo;
}

// A realistic week of meal prep for building and testing the screens without
// the server: two people (one with targets, one "normal portions"), four
// family recipes, rice and yogurt as plate adjusters, a merged cooking
// timeline and container labels. Used by the unit tests and, in development,
// by fixture mode (see meal-prep-api.ts).

const SESSION_DATE = "2026-10-18";

export const FIXTURE_RECIPES: FixtureRecipe[] = [
  {
    id: "r-chili", title: "Mom's Turkey Chili", imageUrl: null,
    why: "A family favorite that freezes well and packs a lot of protein.",
    perServing: { kcal: 410, protein: 34, carbs: 32, fat: 14, fiber: 9 }, confidence: "high",
    allergens: [], activeMinutes: 25,
    storage: { fridgeDays: 4, freezerDays: 90, reheat: "Microwave 2–3 min, stir halfway", notes: [], reheatsWell: true },
  },
  {
    id: "r-chicken", title: "Sheet-Pan Lemon Chicken", imageUrl: null,
    why: "Lean and hands-off: it roasts while the chili simmers.",
    perServing: { kcal: 360, protein: 42, carbs: 8, fat: 17 }, confidence: "high",
    allergens: [], activeMinutes: 15,
    storage: { fridgeDays: 4, freezerDays: 60, reheat: "Microwave 90 sec, covered", notes: ["Squeeze fresh lemon after reheating"], reheatsWell: true },
  },
  {
    id: "r-oats", title: "Grammie's Baked Oatmeal", imageUrl: null,
    why: "You asked for easy breakfasts; this one bakes alongside the chicken.",
    perServing: { kcal: 320, protein: 11, carbs: 48, fat: 9 }, confidence: "medium",
    allergens: ["milk", "eggs", "tree nuts"], activeMinutes: 10,
    storage: { fridgeDays: 5, freezerDays: 60, reheat: "Microwave 45 sec, or eat cold", notes: [], reheatsWell: true },
  },
  {
    id: "r-beef", title: "Beef & Broccoli", imageUrl: null,
    why: "Adds variety mid-week; its numbers are a rough estimate for now.",
    perServing: { kcal: 430, protein: 36, carbs: 18, fat: 22 }, confidence: "low",
    allergens: ["soy", "wheat"], activeMinutes: 20,
    storage: { fridgeDays: 3, freezerDays: null, reheat: "Microwave 2 min; add a splash of water", notes: ["Keep sauce separate"], reheatsWell: true },
  },
];

const SWAP_RECIPES: FixtureRecipe[] = [
  {
    id: "r-tacos", title: "Pork Carnitas Bowls", imageUrl: null, why: "Similar protein, a Mexican twist.",
    perServing: { kcal: 450, protein: 35, carbs: 20, fat: 25 }, confidence: "medium", allergens: [],
    storage: { fridgeDays: 4, freezerDays: 90, reheat: "Microwave 2 min", notes: [], reheatsWell: true },
  },
  {
    id: "r-lentil", title: "Aunt Rose's Lentil Soup", imageUrl: null, why: "Meat-free and very freezer friendly.",
    perServing: { kcal: 310, protein: 18, carbs: 45, fat: 6 }, confidence: "high", allergens: [],
    storage: { fridgeDays: 5, freezerDays: 120, reheat: "Stovetop or microwave 3 min", notes: [], reheatsWell: true },
  },
];

const ADJ: Record<string, { name: string; perGram: Macros }> = {
  "rice-cooked": { name: "rice", perGram: { kcal: 1.3, protein: 0.027, carbs: 0.28, fat: 0.003 } },
  "greek-yogurt": { name: "Greek yogurt", perGram: { kcal: 0.59, protein: 0.1, carbs: 0.036, fat: 0.004 } },
};

const SERVINGS: Record<string, number> = { "r-chili": 8, "r-chicken": 6, "r-oats": 8, "r-beef": 4, "r-tacos": 6, "r-lentil": 8 };
const ALL_RECIPES = [...FIXTURE_RECIPES, ...SWAP_RECIPES];

export const FIXTURE_SETUP: PrepSetup = {
  people: [
    { id: "p-dan", name: "Dan", targets: { kcal: 2450, protein: 180, tolerance: { kcal: 0.05 } }, slots: ["breakfast", "lunch", "dinner"], allergies: [], dislikes: ["mushrooms"] },
    { id: "p-jean", name: "Jean", targets: null, slots: ["lunch", "dinner"], allergies: ["peanuts"], dislikes: [] },
  ],
  days: 5,
  kitchen: { ovens: 1, ovenRacks: 2, burners: 4, appliances: [{ kind: "rice cooker", count: 1 }], containers: 24, freezerSpace: "some" },
  session: { date: SESSION_DATE, maxMinutes: 240, cooks: 1, helper: true, skill: "home" },
  maxDishes: 4,
  wishes: "Easy breakfasts, nothing too spicy",
};

function scaleMacros(m: Macros, k: number): Macros {
  return { kcal: m.kcal * k, protein: m.protein * k, carbs: m.carbs * k, fat: m.fat * k };
}
function sumMacros(list: Macros[]): Macros {
  return list.reduce((a, m) => ({ kcal: a.kcal + m.kcal, protein: a.protein + m.protein, carbs: a.carbs + m.carbs, fat: a.fat + m.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
}

function recipeItem(id: string, servings: number): PlateItem {
  const r = ALL_RECIPES.find((x) => x.id === id)!;
  return { kind: "recipe", refId: id, amount: servings, grams: Math.round(servings * 340), macros: scaleMacros(r.perServing, servings) };
}
function adjusterItem(id: string, grams: number): PlateItem {
  return { kind: "adjuster", refId: id, amount: grams, grams, macros: scaleMacros(ADJ[id].perGram, grams) };
}

/** Which dish each person eats, by slot and day */
const MENU: Record<string, Partial<Record<MealSlot, (day: number) => PlateItem[]>>> = {
  "p-dan": {
    breakfast: () => [recipeItem("r-oats", 1.25), adjusterItem("greek-yogurt", 200)],
    lunch: (d) => (d % 2 === 0 ? [recipeItem("r-chili", 1.5), adjusterItem("rice-cooked", 150)] : [recipeItem("r-beef", 1.5), adjusterItem("rice-cooked", 150)]),
    dinner: (d) => (d === 4 ? [recipeItem("r-chili", 1.25), adjusterItem("rice-cooked", 100)] : [recipeItem("r-chicken", 1.75), adjusterItem("rice-cooked", 200)]),
  },
  "p-jean": {
    lunch: (d) => (d % 2 === 0 ? [recipeItem("r-chicken", 1)] : [recipeItem("r-chili", 1)]),
    dinner: (d) => (d < 2 ? [recipeItem("r-beef", 1), adjusterItem("rice-cooked", 100)] : [recipeItem("r-chili", 1), adjusterItem("rice-cooked", 100)]),
  },
};

function buildPlan(setup: PrepSetup, replace: Record<string, string> = {}): PrepPlan {
  const plates: Plate[] = [];
  for (const person of setup.people) {
    const menu = MENU[person.id] ?? MENU["p-jean"];
    for (let day = 0; day < setup.days; day++) {
      for (const slot of person.slots) {
        const make = menu[slot] ?? menu.lunch!;
        const items = make(day).map((i) => (i.kind === "recipe" && replace[i.refId] ? recipeItem(replace[i.refId], i.amount) : i));
        const eat = eatingDate(setup, day);
        const recipe = ALL_RECIPES.find((r) => items.some((i) => i.refId === r.id));
        // Fridge for the first three days, then the freezer if the dish freezes
        const freezer = day >= 3 && recipe?.storage?.freezerDays != null;
        plates.push({
          personId: person.id, day, slot, items, macros: sumMacros(items.map((i) => i.macros)),
          storage: freezer ? "freezer" : "fridge",
          eatBy: freezer ? addDays(eat, 1) : eat,
        });
      }
    }
  }
  const fit: DayFit[] = [];
  for (const person of setup.people) {
    for (let day = 0; day < setup.days; day++) {
      const macros = sumMacros(plates.filter((p) => p.personId === person.id && p.day === day).map((p) => p.macros));
      // Targets are whole-day; the fit compares against the prepped meals' share
      const share = prepShare(person.slots);
      const t = person.targets;
      const target = t ? { ...t, kcal: t.kcal * share, protein: t.protein * share, carbs: t.carbs && t.carbs * share, fat: t.fat && t.fat * share } : null;
      const status = Object.fromEntries(
        MACRO_ORDER.map((k) => {
          const bar = target ? macroBar(k, macros[k], target) : null;
          return [k, !bar ? "n/a" : bar.tone === "good" ? "ok" : bar.actual < bar.target ? "low" : "high"];
        }),
      ) as DayFit["status"];
      fit.push({ personId: person.id, day, macros, target, status });
    }
  }
  const servingsBy: Record<string, number> = {};
  const adjusterCooking: Record<string, number> = {};
  for (const p of plates) for (const i of p.items) {
    if (i.kind === "recipe") servingsBy[i.refId] = (servingsBy[i.refId] ?? 0) + i.amount;
    else if (i.refId === "rice-cooked") adjusterCooking[i.refId] = (adjusterCooking[i.refId] ?? 0) + i.amount;
  }
  const batches: CookBatch[] = Object.entries(servingsBy).map(([recipeId, need]) => {
    const scale = Math.ceil((need / (SERVINGS[recipeId] ?? 4)) * 2) / 2;
    return { recipeId, scale, servingsMade: scale * (SERVINGS[recipeId] ?? 4) };
  });
  const scored = fit.filter((f) => f.target);
  const ok = scored.filter((f) => Object.values(f.status).every((s) => s === "ok" || s === "n/a")).length;
  return {
    batches, adjusterCooking, plates, fit,
    fitScore: scored.length ? Math.round((ok / scored.length) * 100) : 100,
    notes: ["Chili covers 9 meals and freezes well", "Rice tops up Dan's calories without changing any recipe"],
    relaxed: [],
    solverMs: 84,
  };
}

const T = (t: Omit<ScheduledTask, "resources" | "holdMin" | "dependsOn"> & Partial<Pick<ScheduledTask, "resources" | "holdMin" | "dependsOn">>): ScheduledTask => ({
  resources: [{ kind: "cook", qty: 1 }], holdMin: 15, dependsOn: [], ...t,
});

const TASKS: ScheduledTask[] = [
  T({ id: "t1", recipeIds: ["r-chicken", "r-oats"], text: "Heat the oven to 400°F", kind: "preheat", activeMin: 1, passiveMin: 12, lane: "oven", start: 0, end: 13, cook: 1, resources: [{ kind: "oven", qty: 1, tempF: 400 }], doneCue: "The oven light clicks off" }),
  T({ id: "t2", recipeIds: ["r-chili", "r-beef"], text: "Dice 3 onions (2 for Chili, 1 for Beef & Broccoli)", kind: "prep", activeMin: 8, passiveMin: 0, lane: "prep", start: 0, end: 8, cook: 1, resources: [{ kind: "cook", qty: 1 }, { kind: "board", qty: 1 }] }),
  T({ id: "t3", recipeIds: ["r-chili", "r-chicken"], text: "Mince 8 cloves garlic (5 for Chili, 3 for Chicken)", kind: "prep", activeMin: 5, passiveMin: 0, lane: "prep", start: 8, end: 13, cook: 1 }),
  T({ id: "t4", recipeIds: ["r-oats"], text: "Mix the baked oatmeal and pour into a 9×13 pan", kind: "assemble", activeMin: 8, passiveMin: 0, lane: "prep", start: 13, end: 21, cook: 1 }),
  T({ id: "t5", recipeIds: ["r-oats"], text: "Bake the oatmeal on the top rack", kind: "bake", activeMin: 1, passiveMin: 35, lane: "oven", start: 21, end: 57, cook: 1, dependsOn: ["t1", "t4"], resources: [{ kind: "oven", qty: 1, tempF: 400 }], doneCue: "Set in the middle and golden at the edges", timerSec: 35 * 60 }),
  T({ id: "t6", recipeIds: ["r-chili"], text: "Brown 3 lb ground turkey with the onions in the big pot", kind: "cook", activeMin: 12, passiveMin: 0, lane: "stove", start: 22, end: 34, cook: 1, dependsOn: ["t2", "t3"], resources: [{ kind: "burner", qty: 1 }], doneCue: "No pink left" }),
  T({ id: "t7", recipeIds: ["r-chili"], text: "Add beans, tomatoes and spices; simmer the chili", kind: "simmer", activeMin: 3, passiveMin: 45, lane: "stove", start: 34, end: 82, cook: 1, dependsOn: ["t6"], resources: [{ kind: "burner", qty: 1 }], doneCue: "Thick enough to coat a spoon", timerSec: 45 * 60 }),
  T({ id: "t8", recipeIds: ["rice-cooked"], text: "Rinse 4 cups rice and start the rice cooker", kind: "cook", activeMin: 4, passiveMin: 40, lane: "other", start: 36, end: 80, cook: 1, resources: [{ kind: "appliance", name: "rice cooker", qty: 1 }] }),
  T({ id: "t9", recipeIds: ["r-chicken"], text: "Toss chicken thighs with lemon, oil and garlic on 2 sheet pans", kind: "prep", activeMin: 10, passiveMin: 0, lane: "prep", start: 40, end: 50, cook: 1, dependsOn: ["t3"] }),
  T({ id: "t10", recipeIds: ["r-chicken"], text: "Roast the chicken on the bottom rack", kind: "bake", activeMin: 1, passiveMin: 30, lane: "oven", start: 57, end: 88, cook: 1, dependsOn: ["t5", "t9"], resources: [{ kind: "oven", qty: 1, tempF: 400 }], doneCue: "Chicken reaches 165°F in the thickest piece", timerSec: 30 * 60 }),
  T({ id: "t11", recipeIds: ["r-beef"], text: "Slice the flank steak thin and cut the broccoli", kind: "prep", activeMin: 12, passiveMin: 0, lane: "prep", start: 58, end: 70, cook: 1 }),
  T({ id: "t12", recipeIds: ["r-beef"], text: "Stir-fry the beef, then the broccoli; add the sauce", kind: "cook", activeMin: 15, passiveMin: 0, lane: "stove", start: 82, end: 97, cook: 1, dependsOn: ["t11"], resources: [{ kind: "burner", qty: 1 }], doneCue: "Broccoli bright green and just tender" }),
  T({ id: "t13", recipeIds: [], text: "Wash the cutting boards and the prep bowls", kind: "clean", activeMin: 8, passiveMin: 0, lane: "clean", start: 70, end: 78, cook: 1 }),
  T({ id: "t14", recipeIds: ["r-chili", "r-chicken", "r-beef", "r-oats"], text: "Spread food in shallow pans to cool for 20 minutes", kind: "cool", activeMin: 3, passiveMin: 20, lane: "other", start: 97, end: 120, cook: 1, dependsOn: ["t7", "t10", "t12"], timerSec: 20 * 60 }),
  T({ id: "t15", recipeIds: ["r-chili", "r-chicken", "r-beef", "r-oats"], text: "Portion into containers and stick on the labels", kind: "portion", activeMin: 25, passiveMin: 0, lane: "prep", start: 120, end: 145, cook: 1, dependsOn: ["t14"] }),
  T({ id: "t16", recipeIds: [], text: "Wash the pots and wipe down the counters", kind: "clean", activeMin: 15, passiveMin: 0, lane: "clean", start: 145, end: 160, cook: 1 }),
];

function buildSession(setup: PrepSetup, plan: PrepPlan): PrepSession {
  const names = { recipeTitle: (id: string) => ALL_RECIPES.find((r) => r.id === id)?.title ?? "A dish", adjusterNames: { "rice-cooked": "rice", "greek-yogurt": "Greek yogurt" } };
  const person = (id: string) => setup.people.find((p) => p.id === id)?.name ?? "";
  const labels: ContainerLabel[] = plan.plates.filter((p) => p.storage !== "fresh").map((p) => {
    const dishes = p.items.filter((i) => i.kind === "recipe").map((i) => ALL_RECIPES.find((r) => r.id === i.refId)!);
    return {
      plateKey: `${p.personId}:${p.day}:${p.slot}`,
      title: describePlate({ items: p.items }, names).replace(/^[\d¼½¾]+ servings? /, ""),
      person: person(p.personId),
      madeOn: setup.session.date,
      eatBy: p.eatBy,
      storage: p.storage as "fridge" | "freezer",
      macros: p.macros,
      confidence: dishes.some((d) => d.confidence === "low") ? "low" : "high",
      reheat: dishes[0]?.storage?.reheat ?? "Microwave 2 min",
      allergens: Array.from(new Set(dishes.flatMap((d) => d.allergens ?? []))),
      portion: p.items.map((i) => `${i.grams ?? Math.round(i.amount)} g ${i.kind === "recipe" ? names.recipeTitle(i.refId).replace(/^.*'s /, "") : names.adjusterNames[i.refId as "rice-cooked"] ?? i.refId}`).join(" + "),
    };
  });
  return {
    tasks: TASKS,
    totalMinutes: 160,
    handsOnMinutes: 111,
    misePlace: [
      { text: "Dice 3 onions", recipeIds: ["r-chili", "r-beef"] },
      { text: "Mince 8 cloves garlic", recipeIds: ["r-chili", "r-chicken"] },
      { text: "Zest and juice 3 lemons", recipeIds: ["r-chicken"] },
      { text: "Measure the chili spices into one small bowl", recipeIds: ["r-chili"] },
      { text: "Open and drain 3 cans of beans", recipeIds: ["r-chili"] },
      { text: "Cut 2 heads of broccoli into florets", recipeIds: ["r-beef"] },
    ],
    equipment: ["Large pot (8 qt)", "2 sheet pans", "9×13 baking dish", "Large skillet or wok", "Rice cooker", "Instant-read thermometer"],
    beforeSession: [
      "Move the ground turkey and chicken from the freezer to the fridge on Friday night",
      "Run the dishwasher so the pots and pans are free",
      "Count your containers: you'll need 25 (5 go in the freezer)",
      "Check the pantry list below",
    ],
    labels,
    containers: { count: labels.length, bySize: { "3-cup": labels.length - 5, "2-cup": 5 } },
    safety: [
      "Cool food in shallow pans and get it in the fridge within 2 hours",
      "Chicken is done at 165°F in the thickest part",
      "Baked oatmeal contains milk, eggs and walnuts — keep Jean's peanut allergy in mind when swapping nuts",
    ],
    warnings: [],
  };
}

const SHOPPING: ShoppingList = {
  byAisle: [
    { aisle: "Produce", items: [
      { ingredient: { id: "onion-yellow", name: "Yellow onions", aisle: "Produce" }, neededGrams: 450, display: "3 medium", buy: "1 bag (3 lb)", have: false, forRecipes: ["Mom's Turkey Chili", "Beef & Broccoli"], substitutes: ["white onion"] },
      { ingredient: { id: "garlic", name: "Garlic", aisle: "Produce" }, neededGrams: 40, display: "8 cloves", buy: "1 head", have: false, forRecipes: ["Mom's Turkey Chili", "Sheet-Pan Lemon Chicken"], substitutes: [] },
      { ingredient: { id: "lemon", name: "Lemons", aisle: "Produce" }, neededGrams: null, display: "3", buy: null, have: false, forRecipes: ["Sheet-Pan Lemon Chicken"], substitutes: ["bottled lemon juice"] },
      { ingredient: { id: "broccoli", name: "Broccoli", aisle: "Produce" }, neededGrams: 700, display: "2 heads", buy: null, have: false, forRecipes: ["Beef & Broccoli"], substitutes: ["green beans"] },
    ] },
    { aisle: "Meat & Seafood", items: [
      { ingredient: { id: "turkey-ground", name: "Ground turkey", aisle: "Meat & Seafood" }, neededGrams: 1360, display: "3 lb", buy: "3 packs (1 lb)", have: false, forRecipes: ["Mom's Turkey Chili"], substitutes: ["ground beef", "ground chicken"] },
      { ingredient: { id: "chicken-thigh", name: "Boneless chicken thighs", aisle: "Meat & Seafood" }, neededGrams: 1800, display: "4 lb", buy: "2 family packs (2 lb)", have: false, forRecipes: ["Sheet-Pan Lemon Chicken"], substitutes: ["chicken breast"] },
      { ingredient: { id: "flank-steak", name: "Flank steak", aisle: "Meat & Seafood" }, neededGrams: 900, display: "2 lb", buy: null, have: false, forRecipes: ["Beef & Broccoli"], substitutes: ["sirloin"] },
    ] },
    { aisle: "Dairy & Eggs", items: [
      { ingredient: { id: "greek-yogurt", name: "Plain Greek yogurt", aisle: "Dairy & Eggs" }, neededGrams: 1000, display: "4 cups", buy: "1 tub (32 oz)", have: false, forRecipes: ["Breakfast top-up"], substitutes: [] },
      { ingredient: { id: "milk", name: "Milk", aisle: "Dairy & Eggs" }, neededGrams: 480, display: "2 cups", buy: null, have: true, forRecipes: ["Grammie's Baked Oatmeal"], substitutes: ["oat milk"] },
      { ingredient: { id: "egg", name: "Eggs", aisle: "Dairy & Eggs" }, neededGrams: 100, display: "2", buy: null, have: true, forRecipes: ["Grammie's Baked Oatmeal"], substitutes: [] },
    ] },
    { aisle: "Canned & Jarred", items: [
      { ingredient: { id: "kidney-beans-canned", name: "Kidney beans", aisle: "Canned & Jarred" }, neededGrams: null, display: "3 cans (15 oz)", buy: null, have: false, forRecipes: ["Mom's Turkey Chili"], substitutes: ["black beans"] },
      { ingredient: { id: "tomatoes-crushed", name: "Crushed tomatoes", aisle: "Canned & Jarred" }, neededGrams: null, display: "2 cans (28 oz)", buy: null, have: false, forRecipes: ["Mom's Turkey Chili"], substitutes: [] },
    ] },
    { aisle: "Pasta, Rice & Grains", items: [
      { ingredient: { id: "rice-white", name: "Long-grain white rice", aisle: "Pasta, Rice & Grains" }, neededGrams: 800, display: "4 cups dry", buy: "1 bag (2 lb)", have: false, forRecipes: ["Rice for plates"], substitutes: ["brown rice (cooks 20 min longer)"] },
      { ingredient: { id: "oats-rolled", name: "Rolled oats", aisle: "Pasta, Rice & Grains" }, neededGrams: 320, display: "4 cups", buy: null, have: false, forRecipes: ["Grammie's Baked Oatmeal"], substitutes: [] },
    ] },
    { aisle: "Oils, Vinegars & Condiments", items: [
      { ingredient: { id: "soy-sauce", name: "Soy sauce", aisle: "Oils, Vinegars & Condiments" }, neededGrams: 60, display: "¼ cup", buy: null, have: true, forRecipes: ["Beef & Broccoli"], substitutes: ["tamari (gluten-free)"] },
    ] },
  ],
  pantryCheck: ["Chili powder and cumin (3 tbsp total)", "Olive oil (½ cup)", "Brown sugar (½ cup)", "Cornstarch (2 tbsp)", "Salt and pepper"],
  estimatedCost: 86,
};

const EXPLANATION =
  "Grammie picked four of your recipes that share onions and garlic, so there's less chopping. Dan's plates get a little extra rice and Greek yogurt to reach his goals — the recipes stay exactly as written. Everything after Wednesday goes in the freezer so it stays fresh.";

function buildView(setup: PrepSetup, replace: Record<string, string> = {}, status: PrepPlanView["status"] = "draft"): PrepPlanView {
  const plan = buildPlan(setup, replace);
  return {
    id: "fixture-plan",
    status,
    buildStatus: "ready",
    buildError: null,
    setup,
    plan,
    shopping: SHOPPING,
    session: buildSession(setup, plan),
    explanation: EXPLANATION,
    explanationByAI: true,
    wishes: setup.wishes
      ? { wishes: setup.wishes, recipeBonus: { "r-oats": 0.3 }, excludedRecipeIds: [], more: ["r-oats"], less: [], source: "ai" }
      : null,
    recipeTitles: Object.fromEntries(ALL_RECIPES.map((r) => [r.id, r.title])),
    progress: {},
    substitutions: [],
    unseenSubstitutions: 0,
    sessionDate: setup.session.date,
    calendarMealPlanId: null,
    groceryListId: null,
    createdAt: "2026-10-11T15:00:00Z",
    updatedAt: "2026-10-11T15:00:00Z",
    approvedAt: status === "approved" ? "2026-10-11T15:05:00Z" : null,
  };
}

export const FIXTURE_VIEW: PrepPlanView = buildView(FIXTURE_SETUP);
export const FIXTURE_LABELS = FIXTURE_VIEW.session!.labels;

// ---------- Fixture mode: an in-memory API ----------

interface FixtureState {
  profile: PrepProfile;
  replace: Record<string, string>;
  status: PrepPlanView["status"] | null;
  /** when the current build "finishes" (ms epoch) */
  readyAt: number;
  setup: PrepSetup;
  progress: Record<string, TaskProgress>;
  subs: PrepPlanView["substitutions"];
}

const STATE_KEY = "grammie-meal-prep-fixture-state";

function load(): FixtureState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* fresh state */ }
  return { profile: { defaults: {}, walkthroughDone: false, updatedAt: null }, replace: {}, status: null, readyAt: 0, setup: FIXTURE_SETUP, progress: {}, subs: [] };
}
function save(s: FixtureState) {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Keep the fixture menu's people so plates line up; take the rest of the setup as sent */
function mergeSetup(sent: Partial<PrepSetup>, current: PrepSetup): PrepSetup {
  return { ...current, ...sent, people: FIXTURE_SETUP.people, days: Math.min(sent.days ?? current.days, 7) };
}

const COOK_RECIPES = (view: PrepPlanView): CookView["recipes"] =>
  view.plan!.batches.map((b) => ({
    id: b.recipeId,
    title: view.recipeTitles[b.recipeId],
    servings: SERVINGS[b.recipeId] ?? 4,
    scale: b.scale,
    ingredients: ["2 lb main protein", "1 onion, diced", "2 cloves garlic, minced", "1 tsp salt"],
    instructions: ["Prepare the ingredients.", "Cook as the family recipe says.", "Cool before packing."],
  }));

export async function fixtureCall<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const s = load();
  await wait(300);
  const view = (): PrepPlanView => {
    const v = buildView(s.setup, s.replace, s.status ?? "draft");
    const building = Date.now() < s.readyAt;
    return {
      ...v,
      buildStatus: building ? "building" : "ready",
      ...(building ? { plan: null, shopping: null, session: null } : {}),
      progress: s.progress,
      substitutions: s.subs,
      unseenSubstitutions: s.subs.filter((x) => !x.seenAt).length,
    };
  };
  const ok = <R,>(data: R, status = 200) => { save(s); return { status, data: data as unknown as T }; };
  const startBuild = (status: number) => {
    s.readyAt = Date.now() + 3000;
    return ok({ id: "fixture-plan", buildStatus: "building", poll: "/api/meal-prep/plans/fixture-plan" }, status === 201 ? 202 : 202);
  };

  if (method === "GET" && path === "/profile") return ok(s.profile);
  if (method === "PUT" && path === "/profile") {
    const b = body as { defaults: PrepProfile["defaults"]; walkthroughDone: boolean };
    s.profile = { defaults: b.defaults, walkthroughDone: b.walkthroughDone, updatedAt: new Date().toISOString() };
    return ok(s.profile);
  }
  if (method === "GET" && path === "/plans") {
    const v = view();
    const list: PrepPlanSummary[] = s.status
      ? [{ id: v.id, status: v.status, buildStatus: v.buildStatus, sessionDate: v.sessionDate, days: s.setup.days, people: s.setup.people.length, dishes: (v.plan?.batches ?? []).map((b) => v.recipeTitles[b.recipeId]), fitScore: v.plan?.fitScore ?? null, unseenSubstitutions: v.unseenSubstitutions, createdAt: v.createdAt }]
      : [];
    return ok(list);
  }
  if (method === "POST" && path === "/plans") {
    s.setup = mergeSetup(body as PrepSetup, FIXTURE_SETUP);
    s.status = "draft"; s.replace = {}; s.progress = {}; s.subs = [];
    return startBuild(201);
  }
  const m = path.match(/^\/plans\/[^/]+(\/[a-z-]+(?:\/seen)?)?$/);
  if (m) {
    const action = m[1] ?? "";
    if (!s.status) throw new MealPrepApiError(404, "We couldn't find that plan.");
    if (method === "GET" && !action) return ok(view());
    if (method === "PATCH") {
      const b = body as { status?: PrepPlanView["status"]; setup?: Partial<PrepSetup>; pin?: string[]; unpin?: string[]; exclude?: string[]; unexclude?: string[]; clearWishes?: boolean };
      if (b.status) { s.status = b.status; return ok(view()); }
      const next = mergeSetup(b.setup ?? {}, s.setup);
      next.pinnedRecipeIds = Array.from(new Set([...(next.pinnedRecipeIds ?? []), ...(b.pin ?? [])])).filter((x) => !(b.unpin ?? []).includes(x));
      next.excludedRecipeIds = Array.from(new Set([...(next.excludedRecipeIds ?? []), ...(b.exclude ?? [])])).filter((x) => !(b.unexclude ?? []).includes(x));
      if (b.clearWishes) next.wishes = "";
      s.setup = next;
      return startBuild(200);
    }
    if (action === "/swap") {
      const { recipeId } = body as { recipeId: string };
      const current = view().plan!.fitScore;
      const options: SwapOptionView[] = SWAP_RECIPES.map((r) => {
        const p = buildPlan(s.setup, { ...s.replace, [recipeId]: r.id });
        return { recipeId: r.id, title: r.title, fitScore: p.fitScore, fitScoreChange: p.fitScore - current - (r.id === "r-lentil" ? 15 : 0), notes: [r.why ?? ""] };
      });
      s.replace = { ...s.replace, __for: recipeId };
      return ok({ forRecipeId: recipeId, options });
    }
    if (action === "/choose-swap") {
      const { recipeId } = body as { recipeId: string };
      const out = s.replace.__for;
      const { __for, ...rest } = s.replace;
      s.replace = { ...rest, [out]: recipeId };
      return ok(view());
    }
    if (action === "/approve") { s.status = "approved"; return ok(view()); }
    if (action === "/share") {
      return ok({ id: "share-1", role: "cook", label: null, expiresAt: "2026-10-21T00:00:00Z", revokedAt: null, createdAt: new Date().toISOString(), active: true, token: "demo-token", path: "/prep/cook/demo-token" }, 201);
    }
    if (action === "/progress") {
      const { taskId, done } = body as { taskId: string; done: boolean };
      if (done) s.progress = { ...s.progress, [taskId]: { doneAt: new Date().toISOString(), by: "owner" } };
      else { const { [taskId]: _gone, ...restP } = s.progress; s.progress = restP; }
      return ok(view());
    }
    if (action === "/substitutions/seen") { s.subs = s.subs.map((x) => ({ ...x, seenAt: x.seenAt ?? new Date().toISOString() })); return ok(view()); }
    if (action === "/checkins") return method === "GET" ? ok([]) : ok({ id: "c1", ...(body as object), note: null, updatedAt: new Date().toISOString() }, 201);
    if (action === "/instacart") throw new MealPrepApiError(501, "Ordering through Instacart isn't set up yet. You can still shop from the list here.", "instacart_not_configured");
  }
  const c = path.match(/^\/cook\/([^/]+)(\/[a-z]+)?$/);
  if (c) {
    if (c[1] !== "demo-token") throw new MealPrepApiError(404, "This cook link doesn't work. Ask the family for a new one.");
    const v = view();
    const cookView = (): CookView => ({
      planId: v.id, sessionDate: v.sessionDate, days: s.setup.days, session: v.session, shopping: v.shopping,
      recipes: COOK_RECIPES(v), householdAllergies: ["peanuts"], progress: s.progress,
      substitutions: s.subs.map(({ id, ingredient, replacement, at, note }) => ({ id, ingredient, replacement, at, note })),
      expiresAt: "2026-10-21T00:00:00Z",
    });
    if (c[2] === "/progress") {
      const { taskId, done } = body as { taskId: string; done: boolean };
      if (done) s.progress = { ...s.progress, [taskId]: { doneAt: new Date().toISOString(), by: "cook" } };
      else { const { [taskId]: _gone, ...restP } = s.progress; s.progress = restP; }
      return ok({ progress: s.progress });
    }
    if (c[2] === "/substitution") {
      const { ingredient, replacement } = body as { ingredient: string; replacement: string };
      const sub = { id: `s${s.subs.length + 1}`, ingredient, replacement, by: "cook" as const, at: new Date().toISOString(), recipeIds: [], labelKeys: [], nutritionUpdated: false, note: `Used ${replacement} instead of ${ingredient}.`, seenAt: null };
      s.subs = [...s.subs, sub];
      return ok({ substitution: { id: sub.id, ingredient, replacement, at: sub.at, note: sub.note }, view: cookView() }, 201);
    }
    return ok(cookView());
  }
  throw new MealPrepApiError(404, `No fixture for ${method} ${path}`);
}
