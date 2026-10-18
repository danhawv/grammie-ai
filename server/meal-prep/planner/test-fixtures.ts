// Small, realistic RecipeFacts and adjusters for planner tests, until the
// food-data part's fixtures land. Macros are per serving, roughly USDA-based.

import type {
  Adjuster, Aisle, Confidence, IngredientLine, IngredientSwap, MealSlot, PrepPerson, PrepSetup, RecipeFacts, StorageInfo,
} from "@shared/meal-prep/contract";

type L = [id: string, name: string, aisle: Aisle, grams: number];

const ING: Record<string, L> = {
  onion: ["onion-yellow", "yellow onion", "Produce", 150],
  garlic: ["garlic", "garlic", "Produce", 10],
  pepper: ["bell-pepper", "bell pepper", "Produce", 120],
  tomato: ["tomatoes-canned", "canned tomatoes", "Canned & Jarred", 400],
  rice: ["rice-white", "white rice", "Pasta, Rice & Grains", 300],
  beans: ["black-beans", "black beans", "Canned & Jarred", 425],
  broccoli: ["broccoli", "broccoli", "Produce", 300],
  potato: ["potato-yukon", "yukon gold potatoes", "Produce", 600],
  lemon: ["lemon", "lemon", "Produce", 60],
  cilantro: ["cilantro", "cilantro", "Produce", 20],
  cumin: ["cumin", "ground cumin", "Spices & Seasonings", 6],
  oil: ["olive-oil", "olive oil", "Oils, Vinegars & Condiments", 30],
  cheese: ["cheddar", "cheddar cheese", "Dairy & Eggs", 150],
  milk: ["milk", "milk", "Dairy & Eggs", 240],
  yogurt: ["greek-yogurt", "greek yogurt", "Dairy & Eggs", 300],
  egg: ["egg", "eggs", "Dairy & Eggs", 300],
  flour: ["flour-all-purpose", "all-purpose flour", "Baking", 60],
  tortilla: ["tortilla-flour", "flour tortillas", "Bakery", 400],
  pasta: ["pasta-dry", "pasta", "Pasta, Rice & Grains", 450],
  quinoa: ["quinoa", "quinoa", "Pasta, Rice & Grains", 340],
  lentils: ["lentils-dry", "brown lentils", "Pasta, Rice & Grains", 400],
  chickpeas: ["chickpeas", "chickpeas", "Canned & Jarred", 800],
  coconut: ["coconut-milk", "coconut milk", "Canned & Jarred", 400],
  peanutButter: ["peanut-butter", "peanut butter", "Pantry", 120],
  soy: ["soy-sauce", "soy sauce", "Oils, Vinegars & Condiments", 45],
  tofu: ["tofu-firm", "firm tofu", "Produce", 400],
  noodles: ["rice-noodles", "rice noodles", "Pasta, Rice & Grains", 225],
  oats: ["oats-rolled", "rolled oats", "Pasta, Rice & Grains", 320],
  almonds: ["almonds", "sliced almonds", "Snacks", 60],
  pineNuts: ["pine-nuts", "pine nuts", "Snacks", 30],
  basil: ["basil", "fresh basil", "Produce", 40],
  spinach: ["spinach", "baby spinach", "Produce", 150],
  carrot: ["carrot", "carrots", "Produce", 200],
  celery: ["celery", "celery", "Produce", 120],
  zucchini: ["zucchini", "zucchini", "Produce", 400],
  ricotta: ["ricotta", "ricotta cheese", "Dairy & Eggs", 425],
  marinara: ["marinara", "marinara sauce", "Canned & Jarred", 680],
  breadcrumbs: ["breadcrumbs", "breadcrumbs", "Bakery", 60],
  chicken: ["chicken-breast", "chicken breast", "Meat & Seafood", 700],
  thighs: ["chicken-thigh", "chicken thighs", "Meat & Seafood", 900],
  turkey: ["ground-turkey", "ground turkey", "Meat & Seafood", 700],
  beef: ["ground-beef", "ground beef", "Meat & Seafood", 900],
  flank: ["flank-steak", "flank steak", "Meat & Seafood", 600],
  pork: ["pork-shoulder", "pork shoulder", "Meat & Seafood", 1400],
  salmon: ["salmon-fillet", "salmon fillets", "Meat & Seafood", 600],
  shrimp: ["shrimp", "shrimp", "Meat & Seafood", 450],
  granola: ["granola", "granola", "Pantry", 120],
  berries: ["berries-mixed", "mixed berries", "Produce", 300],
  butter: ["butter", "butter", "Dairy & Eggs", 115],
  sugar: ["sugar", "sugar", "Baking", 200],
  cocoa: ["cocoa-powder", "cocoa powder", "Baking", 40],
  apples: ["apple", "apples", "Produce", 900],
};

function lines(keys: string[]): IngredientLine[] {
  return keys.map((k, index) => {
    const [id, name, aisle, grams] = ING[k];
    return { index, raw: `${grams} g ${name}`, ingredient: { id, name, aisle }, grams, prep: null, optional: false, confidence: "high" };
  });
}

function storage(fridgeDays: number, freezerDays: number | null, reheatsWell = true): StorageInfo {
  return { fridgeDays, freezerDays, reheat: "Microwave 2-3 min, stir halfway", notes: [], reheatsWell };
}

interface R {
  id: string;
  title: string;
  servings: number;
  m: [kcal: number, protein: number, carbs: number, fat: number];
  slots: MealSlot[];
  protein: string | null;
  cuisine: string;
  active: number;
  keep: StorageInfo;
  ing: string[];
  allergens?: string[];
  rating?: number;
  favorite?: boolean;
  cost?: number;
  confidence?: RecipeFacts["confidence"];
  swaps?: IngredientSwap[];
}

/** a swap on line `line` of a recipe: delta per serving [kcal, protein, carbs, fat] */
function sw(id: string, title: string, goal: IngredientSwap["goal"], line: number, from: string, to: string, d: [number, number, number, number], confidence: Confidence = "high"): IngredientSwap {
  return {
    id, title, goal, confidence, source: "standard",
    changes: [{ lineIndex: line, from, to: { id: to.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: to.toLowerCase(), aisle: "Other" }, toGrams: 100, toDisplay: `1 cup ${to.toLowerCase()}` }],
    perServingDelta: { kcal: d[0], protein: d[1], carbs: d[2], fat: d[3] },
  };
}

const RECIPES: R[] = [
  { id: "turkey-chili", title: "Turkey Chili", servings: 6, m: [420, 35, 38, 12], slots: ["lunch", "dinner"], protein: "turkey", cuisine: "tex-mex", active: 25, keep: storage(4, 90), ing: ["turkey", "onion", "garlic", "pepper", "tomato", "beans", "cumin", "oil"], rating: 5, favorite: true, cost: 18 },
  { id: "burrito-bowls", title: "Chicken Burrito Bowls", servings: 4, m: [520, 40, 55, 14], slots: ["lunch", "dinner"], protein: "chicken", cuisine: "mexican", active: 30, keep: storage(4, 60), ing: ["chicken", "rice", "beans", "pepper", "onion", "cilantro", "cumin", "oil"], rating: 4, cost: 16,
    swaps: [sw("rice->cauliflower-rice", "Cauliflower rice instead of white rice", "lighter", 1, "300 g white rice", "Cauliflower rice", [-150, -2, -35, 0])] },
  { id: "beef-broccoli", title: "Beef and Broccoli", servings: 4, m: [480, 34, 30, 22], slots: ["dinner"], protein: "beef", cuisine: "chinese", active: 25, keep: storage(4, 60), ing: ["flank", "broccoli", "garlic", "soy", "rice", "oil"], allergens: ["soy", "wheat"], rating: 4, cost: 20 },
  { id: "sheet-pan-chicken", title: "Lemon Chicken and Potatoes", servings: 4, m: [450, 38, 35, 16], slots: ["lunch", "dinner"], protein: "chicken", cuisine: "mediterranean", active: 20, keep: storage(4, null), ing: ["chicken", "potato", "lemon", "garlic", "oil"], rating: 4, cost: 14 },
  { id: "salmon-quinoa", title: "Salmon with Quinoa", servings: 4, m: [510, 36, 32, 24], slots: ["dinner"], protein: "fish", cuisine: "american", active: 20, keep: storage(3, null, false), ing: ["salmon", "quinoa", "lemon", "spinach", "oil"], allergens: ["fish"], rating: 3, cost: 26 },
  { id: "lentil-soup", title: "Lentil Soup", servings: 8, m: [320, 18, 48, 6], slots: ["lunch", "dinner"], protein: "lentils", cuisine: "mediterranean", active: 20, keep: storage(5, 90), ing: ["lentils", "onion", "carrot", "celery", "garlic", "tomato", "cumin", "oil"], rating: 4, cost: 9 },
  { id: "chickpea-curry", title: "Chickpea Curry", servings: 6, m: [410, 15, 55, 14], slots: ["lunch", "dinner"], protein: "chickpeas", cuisine: "indian", active: 25, keep: storage(4, 90), ing: ["chickpeas", "coconut", "onion", "garlic", "tomato", "spinach", "rice"], rating: 4, cost: 11,
    swaps: [sw("coconut->light-coconut", "Light coconut milk instead of coconut milk", "lighter", 1, "400 g coconut milk", "Light coconut milk", [-60, 0, 0, -7], "low")] },
  { id: "peanut-noodles", title: "Peanut Noodles with Tofu", servings: 4, m: [560, 22, 60, 26], slots: ["lunch"], protein: "tofu", cuisine: "thai", active: 20, keep: storage(4, null, false), ing: ["noodles", "tofu", "peanutButter", "soy", "carrot", "garlic"], allergens: ["peanuts", "soy"], rating: 4, cost: 10 },
  { id: "bean-enchiladas", title: "Black Bean Enchiladas", servings: 6, m: [450, 20, 55, 16], slots: ["dinner"], protein: "beans", cuisine: "mexican", active: 35, keep: storage(4, 90), ing: ["beans", "tortilla", "cheese", "onion", "pepper", "cumin", "tomato"], allergens: ["milk", "wheat"], rating: 4, cost: 12 },
  { id: "meatloaf", title: "Grandma's Meatloaf", servings: 8, m: [380, 28, 15, 22], slots: ["dinner"], protein: "beef", cuisine: "american", active: 25, keep: storage(4, 90), ing: ["beef", "onion", "egg", "breadcrumbs", "milk"], allergens: ["egg", "wheat", "milk"], rating: 5, favorite: true, cost: 17,
    swaps: [
      sw("beef->turkey-93", "93% lean ground turkey instead of ground beef", "both", 0, "900 g ground beef", "93% lean ground turkey", [-70, 3, 0, -9]),
      sw("beef->beef-96", "96% lean ground beef instead of regular ground beef", "lighter", 0, "900 g ground beef", "96% lean ground beef", [-50, 2, 0, -6]),
    ] },
  { id: "overnight-oats", title: "Overnight Oats", servings: 4, m: [380, 15, 55, 11], slots: ["breakfast"], protein: null, cuisine: "american", active: 10, keep: storage(4, null, false), ing: ["oats", "milk", "yogurt", "berries", "almonds"], allergens: ["milk", "tree nuts"], rating: 4, cost: 7 },
  { id: "egg-muffins", title: "Egg Muffins", servings: 6, m: [220, 16, 4, 15], slots: ["breakfast"], protein: "eggs", cuisine: "american", active: 20, keep: storage(4, 60), ing: ["egg", "spinach", "pepper", "cheese"], allergens: ["egg", "milk"], rating: 4, cost: 8 },
  { id: "yogurt-parfait", title: "Yogurt Parfait Jars", servings: 4, m: [300, 20, 40, 7], slots: ["breakfast", "snack"], protein: null, cuisine: "american", active: 10, keep: storage(3, null, false), ing: ["yogurt", "granola", "berries"], allergens: ["milk"], rating: 3, cost: 9 },
  { id: "tikka-masala", title: "Chicken Tikka Masala", servings: 6, m: [480, 36, 25, 24], slots: ["dinner"], protein: "chicken", cuisine: "indian", active: 35, keep: storage(4, 90), ing: ["thighs", "yogurt", "tomato", "onion", "garlic", "coconut", "rice"], allergens: ["milk"], rating: 5, cost: 19,
    swaps: [sw("coconut->greek-yogurt", "Nonfat Greek yogurt instead of coconut milk", "both", 5, "400 g coconut milk", "Nonfat Greek yogurt", [-95, 8, 2, -12])] },
  { id: "carnitas", title: "Pork Carnitas", servings: 8, m: [430, 32, 10, 28], slots: ["lunch", "dinner"], protein: "pork", cuisine: "mexican", active: 20, keep: storage(4, 90), ing: ["pork", "onion", "garlic", "cumin", "lemon"], rating: 4, cost: 18 },
  { id: "veggie-lasagna", title: "Vegetable Lasagna", servings: 8, m: [460, 22, 45, 20], slots: ["dinner"], protein: "cheese", cuisine: "italian", active: 45, keep: storage(4, 90), ing: ["pasta", "ricotta", "cheese", "zucchini", "spinach", "marinara", "egg"], allergens: ["milk", "wheat", "egg"], rating: 4, cost: 16,
    swaps: [sw("ricotta->cottage-cheese", "Low-fat cottage cheese instead of ricotta", "both", 1, "425 g ricotta cheese", "Low-fat cottage cheese", [-40, 6, 1, -5])] },
  { id: "turkey-meatballs", title: "Turkey Meatballs in Marinara", servings: 6, m: [400, 32, 20, 20], slots: ["lunch", "dinner"], protein: "turkey", cuisine: "italian", active: 30, keep: storage(4, 90), ing: ["turkey", "egg", "breadcrumbs", "marinara", "garlic", "basil"], allergens: ["egg", "wheat"], rating: 4, cost: 15 },
  { id: "shrimp-fried-rice", title: "Shrimp Fried Rice", servings: 4, m: [450, 26, 55, 12], slots: ["lunch", "dinner"], protein: "shrimp", cuisine: "chinese", active: 25, keep: storage(3, 30), ing: ["shrimp", "rice", "egg", "soy", "carrot", "onion"], allergens: ["shellfish", "soy", "egg"], rating: 3, cost: 17, confidence: "medium" },
  { id: "quinoa-salad", title: "Quinoa Black Bean Salad", servings: 6, m: [380, 14, 55, 12], slots: ["lunch"], protein: "beans", cuisine: "mexican", active: 20, keep: storage(5, null, false), ing: ["quinoa", "beans", "pepper", "cilantro", "lemon", "oil"], rating: 4, cost: 9 },
  { id: "pesto-chicken-pasta", title: "Pesto Chicken Pasta", servings: 4, m: [580, 34, 55, 24], slots: ["lunch", "dinner"], protein: "chicken", cuisine: "italian", active: 20, keep: storage(4, null), ing: ["chicken", "pasta", "basil", "pineNuts", "cheese", "garlic", "oil"], allergens: ["tree nuts", "milk", "wheat"], rating: 4, cost: 15,
    swaps: [sw("pasta->chickpea-pasta", "Chickpea pasta instead of regular pasta", "protein", 1, "450 g pasta", "Chickpea pasta", [-10, 8, -12, 1], "medium")] },
  { id: "aunt-mae-casserole", title: "Aunt Mae's Tuna Casserole", servings: 6, m: [430, 25, 40, 18], slots: ["dinner"], protein: "fish", cuisine: "american", active: 20, keep: storage(3, 60), ing: ["pasta", "cheese", "milk", "onion"], allergens: ["fish", "milk", "wheat"], rating: 3, cost: 11, confidence: "low" },
];

/** Desserts, kept apart so the older scenarios see the same pool as before. */
const DESSERTS: R[] = [
  { id: "yogurt-brownies", title: "Greek Yogurt Brownies", servings: 12, m: [180, 6, 26, 7], slots: ["dessert"], protein: null, cuisine: "american", active: 15, keep: storage(5, 90), ing: ["flour", "cocoa", "sugar", "yogurt", "egg", "butter"], allergens: ["milk", "egg", "wheat"], rating: 5, favorite: true, cost: 8,
    swaps: [sw("butter->applesauce", "Applesauce instead of half the butter", "lighter", 5, "115 g butter", "Unsweetened applesauce", [-40, 0, 3, -5])] },
  { id: "apple-crisp", title: "Apple Crisp", servings: 8, m: [250, 3, 42, 9], slots: ["dessert"], protein: null, cuisine: "american", active: 20, keep: storage(4, 60), ing: ["apples", "oats", "flour", "sugar", "butter"], allergens: ["milk", "wheat"], rating: 4, cost: 7 },
  { id: "protein-pudding", title: "Chocolate Protein Pudding", servings: 4, m: [160, 15, 18, 4], slots: ["dessert"], protein: null, cuisine: "american", active: 10, keep: storage(4, null, false), ing: ["milk", "yogurt", "cocoa", "sugar"], allergens: ["milk"], rating: 3, cost: 6 },
];

function toFacts(r: R): RecipeFacts {
  return {
    recipeId: r.id,
    title: r.title,
    servings: r.servings,
    perServing: { kcal: r.m[0], protein: r.m[1], carbs: r.m[2], fat: r.m[3] },
    confidence: r.confidence ?? "high",
    nutritionSource: r.confidence === "low" ? "ai_estimate" : "usda",
    lines: lines(r.ing),
    mealTypes: r.slots,
    cuisines: [r.cuisine],
    mainProtein: r.protein,
    allergens: r.allergens ?? [],
    activeMinutes: r.active,
    totalMinutes: r.active + 30,
    storage: r.keep,
    preference: { rating: r.rating ?? null, favorite: !!r.favorite, recentCount: 0 },
    cost: r.cost ?? null,
    component: "complete",
    ...(r.swaps ? { swaps: r.swaps } : {}),
  };
}

export function recipeFacts(): RecipeFacts[] {
  return RECIPES.map(toFacts);
}

export function dessertFacts(): RecipeFacts[] {
  return DESSERTS.map(toFacts);
}

function adj(id: string, name: string, aisle: Aisle, per100: [number, number, number, number], step: number, max: number, slots: MealSlot[], needsCooking: boolean, keep: StorageInfo, extra: Partial<Adjuster> = {}): Adjuster {
  return {
    id, name, ingredient: { id, name: name.toLowerCase(), aisle },
    perGram: { kcal: per100[0] / 100, protein: per100[1] / 100, carbs: per100[2] / 100, fat: per100[3] / 100 },
    stepGrams: step, maxGrams: max, slots, needsCooking, storage: keep, ...extra,
  };
}

export function adjusterFacts(): Adjuster[] {
  return [
    adj("rice-cooked", "Plain rice", "Pasta, Rice & Grains", [130, 2.7, 28, 0.3], 50, 250, ["lunch", "dinner"], true, storage(4, 60)),
    adj("chicken-breast-cooked", "Extra chicken breast", "Meat & Seafood", [165, 31, 0, 3.6], 25, 150, ["lunch", "dinner"], true, storage(4, 90), { topUp: "chicken" }),
    adj("greek-yogurt", "Greek yogurt", "Dairy & Eggs", [59, 10, 3.6, 0.4], 50, 250, ["breakfast", "lunch", "snack"], false, storage(14, null, false)),
    adj("tofu-baked", "Baked tofu", "Produce", [144, 17, 3, 8], 50, 200, ["lunch", "dinner"], true, storage(4, 60)),
    adj("olive-oil", "Olive oil drizzle", "Oils, Vinegars & Condiments", [884, 0, 0, 100], 5, 15, ["lunch", "dinner"], false, storage(365, null)),
  ];
}

/** Bottled protein shakes (one 14 fl oz bottle = 414 g): the default brand first. */
export function shakeAdjusters(): Adjuster[] {
  const shake = (id: string, name: string, product: string, perBottle: [number, number, number, number]) =>
    adj(id, name, "Beverages", perBottle.map((x) => (x * 100) / 414) as [number, number, number, number], 414, 414, ["breakfast", "lunch", "snack"], false, storage(30, null, false),
      { topUp: "shake", product, unitGrams: 414 });
  return [
    shake("shake-core-power-26", "Protein shake", "Fairlife Core Power", [170, 26, 8, 4.5]),
    shake("shake-premier", "Protein shake", "Premier Protein", [160, 30, 5, 3]),
  ];
}

export function person(id: string, name: string, over: Partial<PrepPerson> = {}): PrepPerson {
  return { id, name, targets: null, slots: ["lunch", "dinner"], allergies: [], dislikes: [], ...over };
}

export function setupFor(people: PrepPerson[], over: Partial<PrepSetup> = {}): PrepSetup {
  return {
    people,
    days: 5,
    kitchen: { ovens: 1, ovenRacks: 2, burners: 4, appliances: [{ kind: "rice cooker", count: 1 }], freezerSpace: "some" },
    session: { date: "2026-10-11", maxMinutes: 240, cooks: 1, helper: false, skill: "home" },
    ...over,
  };
}

export interface Scenario {
  name: string;
  setup: PrepSetup;
  facts: RecipeFacts[];
  adjusters: Adjuster[];
}

/** The agreed test scenarios. */
export function scenarios(): Scenario[] {
  const facts = recipeFacts();
  const adjusters = adjusterFacts();
  const vegetarianIds = new Set(["lentil-soup", "chickpea-curry", "peanut-noodles", "bean-enchiladas", "veggie-lasagna", "quinoa-salad", "overnight-oats", "egg-muffins", "yogurt-parfait", "pesto-chicken-pasta", "turkey-chili"]);
  return [
    {
      name: "one-lifter",
      setup: setupFor([person("sam", "Sam", { targets: { kcal: 2200, protein: 180 } })]),
      facts, adjusters,
    },
    {
      name: "two-people",
      setup: setupFor([
        person("sam", "Sam", { targets: { kcal: 2600, protein: 170, carbs: 280, fat: 80 } }),
        person("ana", "Ana", { targets: { kcal: 1700, protein: 110 }, allergies: ["shellfish"] }),
      ]),
      facts, adjusters,
    },
    {
      name: "vegetarian-nut-allergy",
      setup: setupFor([person("lee", "Lee", { targets: { kcal: 2000, protein: 110 }, slots: ["breakfast", "lunch", "dinner"], allergies: ["tree nuts", "peanuts"], dislikes: ["vegetarian"] })]),
      // a mixed pool: the meat dishes and the nut dishes must be skipped
      facts: facts.filter((f) => vegetarianIds.has(f.recipeId) || f.mainProtein === "chicken" || f.mainProtein === "beef"),
      adjusters,
    },
    {
      name: "thin-pool",
      setup: setupFor([person("sam", "Sam", { targets: { kcal: 2200, protein: 180 } })], { maxDishes: 2, session: { date: "2026-10-11", maxMinutes: 30, cooks: 1, helper: false, skill: "beginner" } }),
      facts: facts.filter((f) => ["lentil-soup", "quinoa-salad"].includes(f.recipeId)),
      adjusters,
    },
    {
      name: "seven-days-freezer",
      setup: setupFor([
        person("sam", "Sam", { targets: { kcal: 2200, protein: 160 } }),
        person("kid", "Grandpa Joe", { slots: ["dinner"] }),
      ], { days: 7, kitchen: { ovens: 1, ovenRacks: 2, burners: 4, appliances: [], freezerSpace: "plenty" } }),
      facts, adjusters,
    },
  ];
}
