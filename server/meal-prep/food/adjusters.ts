// Plain single-ingredient add-ons the planner uses to tune a plate's macros
// ("add 150 g rice", "a spoon of olive oil") without touching the family's
// recipe. Macros come from the catalog's USDA values (cooked forms where the
// food is cooked); shelf life follows FoodKeeper's safe end.

import type { Adjuster, MealSlot, StorageInfo } from "@shared/meal-prep/contract";
import type { Catalog } from "./catalog";

interface AdjusterSpec {
  id: string;
  name: string;
  ingredientId: string;
  stepGrams: number;
  maxGrams: number;
  slots: MealSlot[];
  needsCooking: boolean;
  storage: StorageInfo;
}

const MICROWAVE = "Microwave covered 1–2 minutes until steaming hot (165°F).";
const COLD = "Serve cold. No reheating needed.";

const SPECS: AdjusterSpec[] = [
  { id: "rice-cooked", name: "Cooked white rice", ingredientId: "rice-white-cooked", stepGrams: 25, maxGrams: 250, slots: ["lunch", "dinner"], needsCooking: true,
    storage: { fridgeDays: 4, freezerDays: 180, reheat: "Sprinkle with a little water, cover and microwave 1–2 minutes until steaming hot.", notes: ["Cool and refrigerate within 1 hour of cooking."], reheatsWell: true } },
  { id: "brown-rice-cooked", name: "Cooked brown rice", ingredientId: "rice-brown-cooked", stepGrams: 25, maxGrams: 250, slots: ["lunch", "dinner"], needsCooking: true,
    storage: { fridgeDays: 4, freezerDays: 180, reheat: "Sprinkle with a little water, cover and microwave 1–2 minutes until steaming hot.", notes: ["Cool and refrigerate within 1 hour of cooking."], reheatsWell: true } },
  { id: "quinoa-cooked", name: "Cooked quinoa", ingredientId: "quinoa-cooked", stepGrams: 25, maxGrams: 220, slots: ["lunch", "dinner"], needsCooking: true,
    storage: { fridgeDays: 4, freezerDays: 180, reheat: MICROWAVE, notes: ["Good cold in salads too."], reheatsWell: true } },
  { id: "chicken-breast-cooked", name: "Cooked chicken breast", ingredientId: "chicken-cooked", stepGrams: 25, maxGrams: 200, slots: ["lunch", "dinner"], needsCooking: true,
    storage: { fridgeDays: 4, freezerDays: 60, reheat: MICROWAVE, notes: ["Cook to 165°F inside.", "Slice after cooling so it stays juicy."], reheatsWell: true } },
  { id: "eggs-hard-boiled", name: "Hard-boiled eggs", ingredientId: "egg-hard-boiled", stepGrams: 50, maxGrams: 150, slots: ["breakfast", "lunch", "snack"], needsCooking: true,
    storage: { fridgeDays: 7, freezerDays: null, reheat: COLD, notes: ["Keep in the shell until eating."], reheatsWell: false } },
  { id: "greek-yogurt", name: "Nonfat Greek yogurt", ingredientId: "greek-yogurt-nonfat", stepGrams: 50, maxGrams: 300, slots: ["breakfast", "snack"], needsCooking: false,
    storage: { fridgeDays: 7, freezerDays: null, reheat: COLD, notes: [], reheatsWell: false } },
  { id: "cottage-cheese", name: "Low-fat cottage cheese", ingredientId: "cottage-cheese-lowfat", stepGrams: 50, maxGrams: 250, slots: ["breakfast", "lunch", "snack"], needsCooking: false,
    storage: { fridgeDays: 7, freezerDays: null, reheat: COLD, notes: [], reheatsWell: false } },
  { id: "olive-oil", name: "Olive oil", ingredientId: "olive-oil", stepGrams: 5, maxGrams: 20, slots: ["lunch", "dinner"], needsCooking: false,
    storage: { fridgeDays: 30, freezerDays: null, reheat: "Drizzle on after reheating.", notes: ["Keeps in the pantry."], reheatsWell: true } },
  { id: "avocado", name: "Avocado", ingredientId: "avocado", stepGrams: 25, maxGrams: 100, slots: ["breakfast", "lunch", "dinner"], needsCooking: false,
    storage: { fridgeDays: 3, freezerDays: null, reheat: COLD, notes: ["Cut just before eating so it doesn't brown."], reheatsWell: false } },
  { id: "roasted-veg", name: "Roasted vegetables", ingredientId: "mixed-veg-roasted", stepGrams: 50, maxGrams: 250, slots: ["lunch", "dinner"], needsCooking: true,
    storage: { fridgeDays: 4, freezerDays: 60, reheat: MICROWAVE, notes: [], reheatsWell: true } },
  { id: "broccoli-steamed", name: "Steamed broccoli", ingredientId: "broccoli-steamed", stepGrams: 50, maxGrams: 250, slots: ["lunch", "dinner"], needsCooking: true,
    storage: { fridgeDays: 4, freezerDays: 60, reheat: "Microwave covered 1 minute; don't overcook.", notes: [], reheatsWell: true } },
  { id: "tortilla-whole-wheat", name: "Whole-wheat tortilla", ingredientId: "tortilla-whole-wheat", stepGrams: 45, maxGrams: 90, slots: ["breakfast", "lunch", "dinner"], needsCooking: false,
    storage: { fridgeDays: 7, freezerDays: 180, reheat: "Warm in a dry pan 20 seconds a side.", notes: ["Keep in the bag, not in the meal container."], reheatsWell: true } },
  { id: "potatoes-baked", name: "Baked potatoes", ingredientId: "potato-baked", stepGrams: 50, maxGrams: 300, slots: ["breakfast", "lunch", "dinner"], needsCooking: true,
    storage: { fridgeDays: 4, freezerDays: null, reheat: MICROWAVE, notes: ["Refrigerate within 2 hours; don't keep foil-wrapped at room temperature."], reheatsWell: true } },
  { id: "black-beans", name: "Black beans", ingredientId: "black-beans-cooked", stepGrams: 40, maxGrams: 200, slots: ["lunch", "dinner"], needsCooking: false,
    storage: { fridgeDays: 4, freezerDays: 180, reheat: MICROWAVE, notes: ["Rinse and drain canned beans."], reheatsWell: true } },
  { id: "salad-greens", name: "Salad greens", ingredientId: "salad-greens", stepGrams: 30, maxGrams: 120, slots: ["lunch", "dinner"], needsCooking: false,
    storage: { fridgeDays: 3, freezerDays: null, reheat: COLD, notes: ["Keep dry and separate; dress just before eating."], reheatsWell: false } },
];

export function buildAdjusters(catalog: Catalog): Adjuster[] {
  return SPECS.map((s) => {
    const ing = catalog.byId.get(s.ingredientId);
    if (!ing) throw new Error(`Adjuster ${s.id}: no catalog ingredient ${s.ingredientId}`);
    const p = ing.per100g;
    return {
      id: s.id,
      name: s.name,
      ingredient: catalog.ref(ing.id),
      perGram: { kcal: p.kcal / 100, protein: p.protein / 100, carbs: p.carbs / 100, fat: p.fat / 100, fiber: (p.fiber ?? 0) / 100 },
      stepGrams: s.stepGrams,
      maxGrams: s.maxGrams,
      slots: s.slots,
      needsCooking: s.needsCooking,
      storage: s.storage,
    };
  });
}
