// Bottled (ready-to-drink) protein shakes the planner can add as a protein
// top-up, one bottle per plate (PrepSetup.topUps "shake" or "both"). Values
// are per bottle from the US labels (October 2026); the server turns each
// into an Adjuster ("shake-<id>") with perGram = label / bottle grams.
//
// A plan uses one brand at a time: DEFAULT_SHAKE_ID unless the person picks
// another from PROTEIN_SHAKES in the walkthrough. Labels change, so the
// screens show these as "per the label" and the person's own bottle wins.

export interface ProteinShake {
  /** stable id; the adjuster id is `shake-${id}` */
  id: string;
  brand: string;
  /** "Premier Protein 30g", shown on plates, labels and the shopping list */
  product: string;
  /** what the bottle is made from, for allergies and diets */
  base: "milk" | "plant";
  allergens: string[];
  /** per bottle */
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  /** bottle size as labeled */
  flOz: number;
  ml: number;
  /** bottle weight in grams (ml x ~1.04, the density of a milk shake) */
  grams: number;
  /** where the numbers came from */
  sources: string[];
}

const g = (ml: number) => Math.round(ml * 1.04);

export const PROTEIN_SHAKES: ProteinShake[] = [
  {
    id: "premier-protein-30g", brand: "Premier Protein", product: "Premier Protein 30g", base: "milk", allergens: ["dairy"],
    kcal: 160, protein: 30, carbs: 4, fat: 3, fiber: 1, flOz: 11, ml: 325, grams: g(325),
    sources: ["https://www.premierprotein.com/products/chocolate-shake"],
  },
  {
    id: "fairlife-core-power-26g", brand: "Fairlife", product: "Fairlife Core Power 26g", base: "milk", allergens: ["dairy"],
    kcal: 170, protein: 26, carbs: 8, fat: 4.5, fiber: 2, flOz: 14, ml: 414, grams: g(414),
    sources: ["https://stopandshop.com/groceries/product/core-power-chocolate-26g-high-protein-shake-14-oz-btl/193604",
      "https://shoprite.com/product/core-power-protein-chocolate-26g-bottle-14-fl-oz-id-00811620021951"],
  },
  {
    id: "fairlife-core-power-elite-42g", brand: "Fairlife", product: "Fairlife Core Power Elite 42g", base: "milk", allergens: ["dairy"],
    kcal: 230, protein: 42, carbs: 9, fat: 3.5, fiber: 2, flOz: 14, ml: 414, grams: g(414),
    sources: ["https://stopandshop.com/groceries/product/core-power-elite-chocolate-42g-high-protein-shake-14-oz-btl/218191"],
  },
  {
    id: "fairlife-nutrition-plan-30g", brand: "Fairlife", product: "Fairlife Nutrition Plan 30g", base: "milk", allergens: ["dairy"],
    kcal: 150, protein: 30, carbs: 3, fat: 2.5, fiber: 0, flOz: 11.5, ml: 340, grams: g(340),
    sources: ["https://fairlife.com/nutrition-plan/chocolate/", "https://www.coca-cola.com/ca/en/brands/fairlife/products/nutrition-plan"],
  },
  {
    id: "ensure-max-protein-30g", brand: "Ensure", product: "Ensure Max Protein 30g", base: "milk", allergens: ["dairy"],
    kcal: 150, protein: 30, carbs: 6, fat: 1.5, fiber: 2, flOz: 11, ml: 330, grams: g(330),
    sources: ["https://www.shoprite.com/sm/pickup/rsid/3000/product/ensure-max-protein-nutrition-shake-liquid-milk-chocolate-id-00070074677255"],
  },
  {
    id: "muscle-milk-genuine-25g", brand: "Muscle Milk", product: "Muscle Milk Genuine 25g", base: "milk", allergens: ["dairy"],
    kcal: 160, protein: 25, carbs: 9, fat: 4.5, fiber: 5, flOz: 11, ml: 330, grams: g(330),
    sources: ["https://www.vitacost.com/products/muscle-milk-genuine-protein-shake-chocolate-4-cartons-11-fl-oz-330-ml-each-157808"],
  },
  {
    id: "owyn-pro-elite-32g", brand: "OWYN", product: "OWYN Pro Elite 32g (plant-based)", base: "plant", allergens: [],
    kcal: 200, protein: 32, carbs: 3, fat: 7, fiber: 3, flOz: 12, ml: 355, grams: g(355),
    sources: ["https://stopandshop.com/groceries/product/owyn-plant-based-elite-pro-chocolate-32g-non-dairy-protein-drink-12-oz-btl/303060"],
  },
];

/**
 * The shake used unless the person picks one: Premier Protein 30g. It is the
 * most widely stocked (grocery, Walmart, Target, Costco, Amazon top sellers),
 * shelf-stable, and gives 30 g protein for 160 kcal (0.19 g per kcal), close
 * to the leanest options (Ensure Max / Nutrition Plan at 0.20) and ahead of
 * Core Power 26g (0.15).
 */
export const DEFAULT_SHAKE_ID = "premier-protein-30g";

export const shakeAdjusterId = (shakeId: string) => `shake-${shakeId}`;
export const DEFAULT_SHAKE_ADJUSTER_ID = shakeAdjusterId(DEFAULT_SHAKE_ID);
