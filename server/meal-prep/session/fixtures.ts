import type { Adjuster, PrepPlan, PrepSetup, RecipeFacts, Macros, Plate } from "@shared/meal-prep/contract";
import type { RecipeSource } from "./types";

// Small made-up recipes, facts and a plan for the session builder's tests
// (and for the API and screens to try the session part without a database).
// AI_ANSWERS are shaped like the model's replies, including a few of its
// usual mistakes, so validation has something to fix.

const m = (kcal: number, protein: number, carbs: number, fat: number): Macros => ({ kcal, protein, carbs, fat });

export const SOURCES: RecipeSource[] = [
  {
    id: "chili", title: "Grandma's Chili", servings: 6, updatedAt: "2026-10-01T00:00:00.000Z",
    ingredients: ["1 lb ground beef", "1 onion, diced", "2 cloves garlic, minced", "1 can kidney beans", "1 can diced tomatoes", "1 tbsp chili powder", "2 cups cooked rice", "shredded cheese for garnish"],
    instructions: ["Brown the beef with the onion and garlic.", "Add beans, tomatoes and chili powder; simmer 45 minutes.", "Serve over rice with cheese."],
    normalizedInstructions: [
      { stepNumber: 1, text: "Brown the beef with the onion and garlic.", timeMinutes: 10, stepType: "cook" },
      { stepNumber: 2, text: "Add beans, tomatoes and chili powder; simmer 45 minutes.", timeMinutes: 45, stepType: "cook" },
      { stepNumber: 3, text: "Serve over rice with cheese.", stepType: "serve" },
    ],
    prepTimeMinutes: 10, cookTimeMinutes: 55, totalTimeMinutes: 65,
  },
  {
    id: "soup", title: "Vegetable Soup", servings: 4, updatedAt: "2026-10-02T00:00:00.000Z",
    ingredients: ["2 onions, diced", "3 carrots, sliced", "4 cups chicken broth", "1 tbsp olive oil", "salt and pepper to taste"],
    instructions: ["Saute the onions and carrots in oil 8 minutes.", "Add the broth and simmer 25 minutes. Season."],
    normalizedInstructions: [
      { stepNumber: 1, text: "Saute the onions and carrots in oil 8 minutes.", timeMinutes: 8, stepType: "cook" },
      { stepNumber: 2, text: "Add the broth and simmer 25 minutes. Season.", timeMinutes: 25, stepType: "cook" },
    ],
    prepTimeMinutes: 10, cookTimeMinutes: 33, totalTimeMinutes: 43,
  },
  {
    id: "thighs", title: "Roast Chicken Thighs", servings: 4, updatedAt: "2026-10-03T00:00:00.000Z",
    ingredients: ["2 lb chicken thighs", "1 onion, sliced", "1 tbsp olive oil"],
    instructions: ["Preheat the oven to 220°C.", "Toss everything on a sheet pan and roast 35 minutes."],
    normalizedInstructions: [
      { stepNumber: 1, text: "Preheat the oven to 220°C.", temperature: { value: 220, scale: "C" }, stepType: "preheat" },
      { stepNumber: 2, text: "Toss everything on a sheet pan and roast 35 minutes.", timeMinutes: 35, temperature: { value: 220, scale: "C" }, stepType: "cook" },
    ],
    prepTimeMinutes: 10, cookTimeMinutes: 35, totalTimeMinutes: 45,
  },
  {
    id: "tuna", title: "Tuna Noodle Casserole", servings: 6, updatedAt: "2026-10-04T00:00:00.000Z",
    ingredients: ["12 oz egg noodles", "2 cans tuna", "1 can cream of mushroom soup", "1 cup frozen peas", "1 cup shredded cheddar"],
    instructions: ["Boil the noodles 8 minutes and drain.", "Mix everything in a baking dish.", "Bake at 375°F for 30 minutes."],
    normalizedInstructions: [
      { stepNumber: 1, text: "Boil the noodles 8 minutes and drain.", timeMinutes: 8, stepType: "cook" },
      { stepNumber: 2, text: "Mix everything in a baking dish.", timeMinutes: 5, stepType: "assemble" },
      { stepNumber: 3, text: "Bake at 375°F for 30 minutes.", timeMinutes: 30, temperature: { value: 375, scale: "F" }, stepType: "cook" },
    ],
    prepTimeMinutes: 10, cookTimeMinutes: 40, totalTimeMinutes: 50,
  },
];

const task = (o: Record<string, unknown>) => ({
  activeMin: 0, passiveMin: 0, heat: "none", tempF: null, appliance: null, vessel: null, dependsOn: [], holdMin: 30,
  doneCue: null, ingredients: [], fromSteps: [], ...o,
});

/** Model-shaped answers for SOURCES */
export const AI_ANSWERS: Record<string, any> = {
  chili: {
    tasks: [
      task({ id: "t1", text: "Dice the onion", kind: "prep", activeMin: 3, ingredients: [{ index: 1, fraction: 1, prep: "diced" }], fromSteps: [1] }),
      task({ id: "t2", text: "Mince the garlic", kind: "prep", activeMin: 2, ingredients: [{ index: 2, fraction: 1, prep: "minced" }], fromSteps: [1] }),
      task({ id: "t3", text: "Brown the beef with the onion and garlic", kind: "cook", activeMin: 10, heat: "burner", vessel: "Large soup pot", dependsOn: ["t1", "t2"], ingredients: [{ index: 0, fraction: 1, prep: null }, { index: 1, fraction: 1, prep: "diced" }, { index: 2, fraction: 1, prep: "minced" }], fromSteps: [1], doneCue: "No pink left" }),
      // Mistake: a long simmer marked as all hands-on, and the beans/tomatoes forgotten
      task({ id: "t4", text: "Add the beans, tomatoes and chili powder and simmer, covered", kind: "simmer", activeMin: 45, heat: "burner", vessel: "large pot", dependsOn: ["t3"], ingredients: [{ index: 5, fraction: 1, prep: null }], fromSteps: [2] }),
    ],
    atServing: ["Serve over the rice with cheese"],
  },
  soup: {
    tasks: [
      task({ id: "t1", text: "Dice the onions", kind: "prep", activeMin: 4, ingredients: [{ index: 0, fraction: 1, prep: "diced" }], fromSteps: [1] }),
      task({ id: "t2", text: "Slice the carrots", kind: "prep", activeMin: 4, ingredients: [{ index: 1, fraction: 1, prep: "sliced" }], fromSteps: [1] }),
      task({ id: "t3", text: "Saute the onions and carrots in the oil", kind: "cook", activeMin: 8, heat: "burner", vessel: "large pot", dependsOn: ["t1", "t2"], ingredients: [{ index: 0, fraction: 1, prep: "diced" }, { index: 1, fraction: 1, prep: "sliced" }, { index: 3, fraction: 1, prep: null }], fromSteps: [1] }),
      task({ id: "t4", text: "Add the broth and simmer", kind: "simmer", activeMin: 2, passiveMin: 25, heat: "burner", vessel: "large pot", dependsOn: ["t3"], ingredients: [{ index: 2, fraction: 1, prep: null }, { index: 4, fraction: 1, prep: null }], fromSteps: [2] }),
    ],
    atServing: [],
  },
  thighs: {
    tasks: [
      // Mistake: a preheat task, and the temperature passed through in Celsius
      task({ id: "t0", text: "Preheat the oven", kind: "preheat", heat: "oven", tempF: 220, passiveMin: 10, fromSteps: [1] }),
      task({ id: "t1", text: "Slice the onion", kind: "prep", activeMin: 3, ingredients: [{ index: 1, fraction: 1, prep: "sliced" }], fromSteps: [2] }),
      task({ id: "t2", text: "Toss the chicken and onion with oil on a sheet pan", kind: "assemble", activeMin: 4, vessel: "baking sheet", dependsOn: ["t1"], ingredients: [{ index: 0, fraction: 1, prep: null }, { index: 1, fraction: 1, prep: "sliced" }, { index: 2, fraction: 1, prep: null }], fromSteps: [2] }),
      task({ id: "t3", text: "Roast the chicken", kind: "bake", activeMin: 1, passiveMin: 35, heat: "oven", tempF: 220, vessel: "sheet pan", dependsOn: ["t0", "t2"], fromSteps: [2], doneCue: "Reaches 175°F" }),
    ],
    atServing: [],
  },
  tuna: {
    tasks: [
      task({ id: "t1", text: "Boil the noodles and drain", kind: "cook", activeMin: 3, passiveMin: 8, heat: "burner", vessel: "large pot", ingredients: [{ index: 0, fraction: 1, prep: null }], fromSteps: [1] }),
      task({ id: "t2", text: "Mix the noodles, tuna, soup, peas and cheese in a baking dish", kind: "assemble", activeMin: 5, vessel: "9x13 baking dish", dependsOn: ["t1"], ingredients: [{ index: 1, fraction: 1, prep: null }, { index: 2, fraction: 1, prep: null }, { index: 3, fraction: 1, prep: null }, { index: 4, fraction: 1, prep: null }], fromSteps: [2] }),
      task({ id: "t3", text: "Bake the casserole", kind: "bake", activeMin: 1, passiveMin: 30, heat: "oven", tempF: 375, vessel: "baking dish", dependsOn: ["t2"], fromSteps: [3], doneCue: "Bubbly" }),
    ],
    atServing: [],
  },
};

const ref = (id: string, name: string, aisle: any) => ({ id, name, aisle });
const line = (index: number, raw: string, ingredient: any, grams: number | null, prep: string | null = null, optional = false) =>
  ({ index, raw, ingredient, grams, prep, optional, confidence: "high" as const });
const storage = (fridgeDays: number, freezerDays: number | null, notes: string[] = []) =>
  ({ fridgeDays, freezerDays, reheat: "Microwave 2-3 min, stir halfway.", notes, reheatsWell: true });
const base = { confidence: "high" as const, nutritionSource: "usda" as const, mealTypes: ["lunch", "dinner"] as any, cuisines: [], activeMinutes: 15, totalMinutes: 60, preference: { rating: 4, favorite: false, recentCount: 0 } };

const ONION = ref("onion-yellow", "Yellow onion", "Produce");
const OIL = ref("olive-oil", "Olive oil", "Oils, Vinegars & Condiments");

export const FACTS: RecipeFacts[] = [
  {
    ...base, recipeId: "chili", title: "Grandma's Chili", servings: 6, perServing: m(420, 30, 35, 16), mainProtein: "beef", allergens: ["Dairy"],
    storage: storage(4, 90), cost: 14,
    lines: [
      line(0, "1 lb ground beef", ref("ground-beef", "Ground beef", "Meat & Seafood"), 454),
      line(1, "1 onion, diced", ONION, 150, "diced"),
      line(2, "2 cloves garlic, minced", ref("garlic", "Garlic", "Produce"), 10, "minced"),
      line(3, "1 can kidney beans", ref("kidney-beans", "Kidney beans", "Canned & Jarred"), 425),
      line(4, "1 can diced tomatoes", ref("diced-tomatoes", "Diced tomatoes", "Canned & Jarred"), 411),
      line(5, "1 tbsp chili powder", ref("chili-powder", "Chili powder", "Spices & Seasonings"), 8),
      line(6, "2 cups cooked rice", ref("rice-white-cooked", "White rice, cooked", "Pasta, Rice & Grains"), 316, "cooked"),
      line(7, "shredded cheese for garnish", ref("cheddar", "Cheddar cheese", "Dairy & Eggs"), null, "shredded", true),
    ],
  },
  {
    ...base, recipeId: "soup", title: "Vegetable Soup", servings: 4, perServing: m(150, 5, 18, 6), mainProtein: null, allergens: [],
    storage: storage(4, 90), cost: 6,
    lines: [
      line(0, "2 onions, diced", ONION, 300, "diced"),
      line(1, "3 carrots, sliced", ref("carrot", "Carrots", "Produce"), 180, "sliced"),
      line(2, "4 cups chicken broth", ref("chicken-broth", "Chicken broth", "Canned & Jarred"), 960),
      line(3, "1 tbsp olive oil", OIL, 14),
      line(4, "salt and pepper to taste", ref("salt", "Salt", "Spices & Seasonings"), null),
    ],
  },
  {
    ...base, recipeId: "thighs", title: "Roast Chicken Thighs", servings: 4, perServing: m(380, 40, 4, 22), mainProtein: "chicken", allergens: [],
    storage: storage(4, 60, ["Keep the pan juices in a separate cup"]), cost: 9,
    lines: [
      line(0, "2 lb chicken thighs", ref("chicken-thigh", "Chicken thighs", "Meat & Seafood"), 907),
      line(1, "1 onion, sliced", ONION, 150, "sliced"),
      line(2, "1 tbsp olive oil", OIL, 14),
    ],
  },
  {
    ...base, recipeId: "tuna", title: "Tuna Noodle Casserole", servings: 6, perServing: m(450, 28, 45, 16), mainProtein: "fish", allergens: ["Fish", "Gluten", "Dairy", "Eggs"],
    storage: storage(3, 60), cost: 11,
    lines: [
      line(0, "12 oz egg noodles", ref("egg-noodles", "Egg noodles", "Pasta, Rice & Grains"), 340),
      line(1, "2 cans tuna", ref("tuna-canned", "Canned tuna", "Canned & Jarred"), 340),
      line(2, "1 can cream of mushroom soup", ref("cream-of-mushroom", "Cream of mushroom soup", "Canned & Jarred"), 298),
      line(3, "1 cup frozen peas", ref("peas-frozen", "Frozen peas", "Frozen"), 145),
      line(4, "1 cup shredded cheddar", ref("cheddar", "Cheddar cheese", "Dairy & Eggs"), 113, "shredded"),
    ],
  },
];

export const ADJUSTERS: Adjuster[] = [
  {
    id: "rice-cooked", name: "Rice (cooked)", ingredient: ref("rice-white", "White rice", "Pasta, Rice & Grains"),
    perGram: m(1.3, 0.027, 0.28, 0.003), stepGrams: 25, maxGrams: 300, slots: ["lunch", "dinner"], needsCooking: true,
    storage: storage(4, 90),
  },
  {
    id: "greek-yogurt", name: "Greek yogurt", ingredient: ref("greek-yogurt", "Plain Greek yogurt", "Dairy & Eggs"),
    perGram: m(0.97, 0.09, 0.04, 0.05), stepGrams: 50, maxGrams: 250, slots: ["lunch", "snack"], needsCooking: false,
    storage: { ...storage(10, null, ["Keep in a separate cup"]), reheat: "Eat cold." },
  },
];

export const SETUP: PrepSetup = {
  people: [
    { id: "pat", name: "Pat", targets: { kcal: 2000, protein: 140 }, slots: ["lunch", "dinner"], allergies: [], dislikes: [] },
    { id: "gran", name: "Gran", targets: null, slots: ["lunch"], allergies: ["fish"], dislikes: [] },
  ],
  days: 3,
  kitchen: { ovens: 1, ovenRacks: 2, burners: 4, appliances: [], containers: 8, freezerSpace: "some" },
  session: { date: "2026-10-18", maxMinutes: 240, cooks: 1, helper: false, skill: "home" },
};

const plate = (personId: string, day: number, slot: Plate["slot"], items: Array<[Plate["items"][number]["kind"], string, number, number | null]>, storageKind: Plate["storage"] = "fridge"): Plate => ({
  personId, day, slot, storage: storageKind, eatBy: `2026-10-${String(19 + day).padStart(2, "0")}`,
  items: items.map(([kind, refId, amount, grams]) => ({ kind, refId, amount, grams, macros: m(300, 20, 30, 10) })),
  macros: m(600, 40, 60, 20),
});

export const PLAN: PrepPlan = {
  batches: [
    { recipeId: "chili", scale: 1.5, servingsMade: 9 },
    { recipeId: "soup", scale: 1, servingsMade: 4 },
    { recipeId: "thighs", scale: 1, servingsMade: 4 },
    { recipeId: "tuna", scale: 1, servingsMade: 6 },
  ],
  adjusterCooking: { "rice-cooked": 600 },
  plates: [
    plate("pat", 0, "lunch", [["recipe", "chili", 1.5, 450], ["adjuster", "rice-cooked", 150, 150]]),
    plate("pat", 1, "lunch", [["recipe", "chili", 1.5, 450], ["adjuster", "rice-cooked", 150, 150]]),
    plate("pat", 2, "lunch", [["recipe", "tuna", 1.5, null]], "freezer"),
    plate("pat", 0, "dinner", [["recipe", "thighs", 1.5, 300], ["adjuster", "rice-cooked", 150, 150]]),
    plate("pat", 1, "dinner", [["recipe", "thighs", 1.5, 300], ["adjuster", "rice-cooked", 150, 150]]),
    plate("pat", 2, "dinner", [["recipe", "soup", 1, 400], ["adjuster", "greek-yogurt", 150, 150]]),
    plate("gran", 0, "lunch", [["recipe", "soup", 1, 400]]),
    plate("gran", 1, "lunch", [["recipe", "tuna", 1, null]]),
    plate("gran", 2, "lunch", [["recipe", "chili", 1, 300]], "fresh"),
  ],
  fit: [], fitScore: 90, notes: [], relaxed: [], solverMs: 5,
};
