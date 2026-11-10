// "Good for meal prep": does this dish cook once and eat well for days?
// Built on the FoodKeeper storage judgement (storage.ts): a dish is friendly
// when it keeps 3+ days in the fridge and either reheats well or is a meal
// meant to be eaten cold (overnight oats, chicken salad), and it isn't
// something that only works fresh: a drink, a frozen dessert, a dressed green
// salad, a sandwich or burger, or something fried. Sauces, dips and desserts
// aren't meals, so they're left out too. Pure, so it runs in tests, in the
// backfill script and inside updateRecipe without the database.

import { seedCatalog, type Catalog } from "./catalog";
import { mealSlotsFor, storageInputFor, type StorageRecipe } from "./facts";
import { storageFor } from "./storage";

export interface MealPrepFit {
  friendly: boolean;
  /** fridge days (FoodKeeper window, shortened by the recipe's own tip) */
  keepsDays: number;
  freezes: boolean;
  /** one plain line for the recipe page: "keeps 4 days in the fridge · freezes well" */
  note: string;
}

const DRINK = /\b(smoothies?|(protein |milk)shakes?|lattes?|lemonade|mocktails?|margaritas?|sangria|frapp\w*|hot chocolate|iced tea|drinks?|beverages?)\b/i;
const FROZEN = /\b(ice cream|nice cream|sorbet|gelato|popsicles?|ice pops?|frozen yogurt|froyo|granita|frozen|slushie|semifreddo)\b/i;
const SANDWICH = /\b(burgers?|sliders?|sandwich(es)?|smash|paninis?|grilled cheese|toasts?|toasties?|pizzas?|flatbreads?|quesadillas?|wraps?|tacos?|nachos|hot ?dogs?|blt)\b/i;
const FRIED = /\b(fried|deep-fried|crispy|tenders|nuggets|schnitzel|tempura|fritters?|fries|chips|wings|popcorn|katsu|calamari)\b/i;
// Methods that leave a crust that goes soft in the fridge; pan- and stir-frying are just stovetop cooking
const FRY_METHOD = /^(deep[ -]?|air[ -]?)?fr(y|ying|ied)$|air[ -]?fr|deep[ -]?fr|crisp/i;
const WET_METHOD = /simmer|brais|stew|roast|bak|slow|boil|pressure|smok|steam|poach/i;
// Kinds and (for untagged recipes) title words that aren't a meal
const NOT_A_MEAL = /sauce|dip|dressing|condiment|marinade|rub|spread|seasoning|appetizer/;
const SIDE_TITLE = /\b(dips?|gravy|hummus|salsa|guacamole|pesto|sauces?|dressing|vinaigrette|glaze|pur[eé]e|jams?|jelly|relish|chutney|spread|bites|crackers|nuts|pecans|almonds|granola|trail mix|snack mix|party mix|seasoning|marinade|rub|aioli|mayo|pickles?|pickled|breads?|loaf|biscuits|rolls|buns|tortillas|pitas?|naan|bagels?|crust)\b/i;
// Sweet titles are treats unless a savory word says otherwise ("Chili Pie", "Tomato Tart")
const TREAT_TITLE = /\b(cakes?|cheesecakes?|cupcakes?|pies?|tarts?|cookies?|brownies?|blondies?|bars|donuts?|doughnuts?|fudge|mousse|puddings?|cand(y|ies)|truffles?|cobblers?|crumble|macaroons?|shortbread|biscotti)\b/i;
const SAVORY_TITLE = /\b(chili|pot pie|shepherd|cottage pie|chicken|beef|pork|turkey|ham|bacon|sausage|crab|tuna|salmon|shrimp|fish|tomato|quiche|meat|cheese pie|spinach|zucchini|corn|onion|pizza)\b/i;
const RAW_FISH = /\b(tartare|crudo|ceviche|sashimi|poke|carpaccio|oysters? on the half shell)\b/i;
const MEAL_KIND = /breakfast|brunch|lunch|dinner|main|entr|soup|stew|bowl|salad|meal prep/;

let seeded: Catalog | null = null;

/**
 * Judge one recipe. The catalog is only needed to match ingredients (for the
 * main protein and the raw-greens / creamy / egg shares); the seed is used
 * when none is given.
 */
export function mealPrepFit(r: StorageRecipe, catalog: Catalog = (seeded ??= seedCatalog())): MealPrepFit {
  const input = storageInputFor(r, catalog);
  const s = storageFor(input);
  const title = r.title ?? "";
  const kinds = input.kinds.join(" ");
  const slots = mealSlotsFor(r.mealType, title);
  const freezes = s.freezerDays != null;
  const keeps = `keeps ${s.fridgeDays} ${s.fridgeDays === 1 ? "day" : "days"} in the fridge`;
  const friendlyNote = `${keeps} · ${freezes ? "freezes well" : "doesn't freeze"}`;
  const no = (why: string): MealPrepFit => ({ friendly: false, keepsDays: s.fridgeDays, freezes, note: `best eaten fresh · ${why}` });

  if (DRINK.test(title) || /beverage|drink|smoothie/.test(kinds)) return no("drinks are best made fresh");
  if (FROZEN.test(title) || (/dessert/.test(kinds) && input.cookingMethods.some((m) => /freez/i.test(m)))) return no("frozen treats don't keep as a meal");
  if (input.shares.rawGreens > 0.25 && (/salad/.test(kinds) || /\bsalad\b/i.test(title))) return no("dressed greens go limp by the next day");
  if (SANDWICH.test(title)) return no("build it right before eating");
  if (RAW_FISH.test(title)) return no("raw fish is for the day it's made");
  const methods = input.cookingMethods.map((m) => m.trim().toLowerCase());
  const fried = FRIED.test(title) || methods.some((m) => FRY_METHOD.test(m)) && !methods.some((m) => WET_METHOD.test(m));
  if (fried) return no("fried foods lose their crunch");
  // Not a meal: sauces, dips, snacks and desserts, unless it's also tagged as a meal
  const isMeal = MEAL_KIND.test(kinds) || slots.some((x) => x === "breakfast" || x === "lunch" || x === "dinner");
  // A sauce by name and by tag is a sauce, even when it's also tagged dinner
  if (NOT_A_MEAL.test(kinds) && SIDE_TITLE.test(title)) return no("a side, not a meal");
  if (!isMeal) {
    if (slots.includes("dessert") || TREAT_TITLE.test(title) && !SAVORY_TITLE.test(title)) return no("a treat, not a meal");
    if (NOT_A_MEAL.test(kinds) || SIDE_TITLE.test(title)) return no("a side, not a meal");
    if (slots.includes("snack")) return no("a snack, not a meal");
  }
  if (s.fridgeDays < 3) return no(keeps);
  if (/best (served|eaten) (fresh|immediately|right away)/i.test(input.tips.map((t) => t.text).join(" "))) return no("the recipe says so");
  // Reheats well, or a cold meal that keeps (overnight oats, chicken salad, grain bowls)
  const cold = /^serve cold/i.test(s.reheat);
  if (cold && !isMeal) return no("it's served cold and isn't a meal on its own");
  return { friendly: true, keepsDays: s.fridgeDays, freezes, note: friendlyNote };
}

/** The three recipe columns for one judgement */
export function mealPrepColumns(fit: MealPrepFit) {
  return { mealPrepFriendly: fit.friendly, mealPrepKeepsDays: fit.keepsDays, mealPrepNote: fit.note };
}
