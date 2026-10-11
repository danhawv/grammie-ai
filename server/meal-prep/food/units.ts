// Recipe amounts -> grams. Recipe units are messy free text ("c.", "T.",
// "tbs", "lbs", "1 (14 oz) can", "to taste", "large"), so we first sort the
// unit into a kind, then convert with what we know about the ingredient
// (grams per cup, per piece, per can). Everything here is exact arithmetic;
// when we can't know the amount we return null rather than guess wildly.

import type { Confidence } from "@shared/meal-prep/contract";

export type UnitKind =
  | { kind: "mass"; grams: number }          // grams per 1 unit
  | { kind: "volume"; ml: number }           // ml per 1 unit
  | { kind: "piece"; size?: "small" | "medium" | "large"; portion?: PortionKey }
  | { kind: "pack"; pack: "can" | "package" | "jar" | "bag" | "box" | "bottle" }
  | { kind: "none" };                        // to taste, as needed, garnish

/** Household portions the catalog may know grams for */
export type PortionKey =
  | "piece" | "small" | "medium" | "large" | "clove" | "slice" | "stick" | "stalk" | "head"
  | "bunch" | "sprig" | "leaf" | "fillet" | "scoop" | "spray" | "inch" | "juice";

const ML = { tsp: 4.92892, tbsp: 14.7868, cup: 236.588, floz: 29.5735, pint: 473.176, quart: 946.353, gallon: 3785.41, l: 1000, ml: 1 };
const G = { g: 1, kg: 1000, mg: 0.001, oz: 28.3495, lb: 453.592 };

/** Lowercased unit spellings -> kind. Units arrive lowercased, so "t"/"T" are settled from the raw text. */
const UNIT_TABLE: Record<string, UnitKind> = {};
function add(names: string, k: UnitKind) { for (const n of names.split("|")) UNIT_TABLE[n] = k; }
add("g|gm|gms|gram|grams|gr|grs", { kind: "mass", grams: G.g });
add("kg|kgs|kilo|kilogram|kilograms", { kind: "mass", grams: G.kg });
add("mg|milligram|milligrams", { kind: "mass", grams: G.mg });
add("oz|ounce|ounces|onz", { kind: "mass", grams: G.oz });
add("lb|lbs|pound|pounds|#", { kind: "mass", grams: G.lb });
add("ml|milliliter|milliliters|millilitre|millilitres|cc", { kind: "volume", ml: 1 });
add("l|liter|liters|litre|litres", { kind: "volume", ml: ML.l });
add("dl|deciliter", { kind: "volume", ml: 100 });
add("cl", { kind: "volume", ml: 10 });
add("tsp|tsps|teaspoon|teaspoons|tsp each|tspn|cuillère à café|cuillères à café|t", { kind: "volume", ml: ML.tsp });
add("tbsp|tbsps|tbs|tbl|tbls|tb|tablespoon|tablespoons|heaped tbsp|heaping tbsp|heaping tablespoon|cuillère à soupe|cuillères à soupe", { kind: "volume", ml: ML.tbsp });
add("cup|cups|c|packed cups|packed cup|heaping cup|mug", { kind: "volume", ml: ML.cup });
add("fl oz|fluid ounce|fluid ounces|floz", { kind: "volume", ml: ML.floz });
add("pt|pint|pints", { kind: "volume", ml: ML.pint });
add("qt|quart|quarts", { kind: "volume", ml: ML.quart });
add("gal|gallon|gallons", { kind: "volume", ml: ML.gallon });
add("shot|shots", { kind: "volume", ml: 44 });
add("part|parts", { kind: "volume", ml: 30 }); // cocktail "parts": one shot-ish
add("drop|drops", { kind: "volume", ml: 0.05 });
add("pinch|pinches|sprinkle|shakes|shake", { kind: "volume", ml: 0.31 });
add("dash|dashes", { kind: "volume", ml: 0.62 });
add("splash|splashes|drizzle|squeeze", { kind: "volume", ml: 7.5 });
add("handful|handfuls", { kind: "volume", ml: 60 }); // about 1/4 cup
add("|whole|count|unit|units|item|items|each|piece|pieces|pc|pcs|ea|x|half|halves|portion|serving|servings|chunk|chunks|lump|lumps|ball|balls|bar|bars|cob|cobs|ear|ears|spear|spears|steak|steaks|breast|breasts|thigh|thighs|wedge|wedges|round|rounds|cube|cubes|roll|rolls|shell|shells|block|brick|bricks|rind|blade|bulb|rack|racks|strip|strips|cookie|cookies|crust|tenderloins|filet|filets", { kind: "piece" });
add("small|sm|smaller", { kind: "piece", size: "small" });
add("medium|med|mid", { kind: "piece", size: "medium" });
add("large|lg|big|jumbo|extra large|xl", { kind: "piece", size: "large" });
add("clove|cloves|gousse|gousses|medium clove", { kind: "piece", portion: "clove" });
add("slice|slices", { kind: "piece", portion: "slice" });
add("stick|sticks", { kind: "piece", portion: "stick" });
add("stalk|stalks|rib|ribs|stem|stems", { kind: "piece", portion: "stalk" });
add("head|heads|medium head|large head|small head", { kind: "piece", portion: "head" });
add("bunch|bunches|bouquet", { kind: "piece", portion: "bunch" });
add("sprig|sprigs", { kind: "piece", portion: "sprig" });
add("leaf|leaves", { kind: "piece", portion: "leaf" });
add("fillet|fillets", { kind: "piece", portion: "fillet" });
add("scoop|scoops", { kind: "piece", portion: "scoop" });
add("spray|sprays|spritz", { kind: "piece", portion: "spray" });
add("inch|inches|in|inch piece|cm", { kind: "piece", portion: "inch" });
add("juice of", { kind: "piece", portion: "juice" });
add("can|cans|tin|tins|small can", { kind: "pack", pack: "can" });
add("package|packages|pkg|pkgs|pack|packs|packet|packets|envelope|envelopes|sachet|container|carton|tub|tubs|large tub|large tubs", { kind: "pack", pack: "package" });
add("jar|jars", { kind: "pack", pack: "jar" });
add("bag|bags", { kind: "pack", pack: "bag" });
add("box|boxes", { kind: "pack", pack: "box" });
add("bottle|bottles", { kind: "pack", pack: "bottle" });
add("loaf|loaves", { kind: "pack", pack: "package" });
add("sheet|sheets", { kind: "pack", pack: "package" });
add("to taste|as needed|as desired|for garnish|garnish|for serving|to cover|for frying|for greasing|optional|some|few|null|none|n/a|batch|total|seconds|ripe|spiral", { kind: "none" });

export interface ParsedUnit {
  unit: UnitKind;
  /** grams stated in the line itself ("1 can (15 oz)", "(400 g)"); beats any lookup */
  statedGrams?: number;
  /** pack size stated in the line, e.g. "14.5 oz can" -> 411 g per can */
  packGrams?: number;
}

const WEIGHT_RE = /(\d+(?:\.\d+)?)\s*(-\s*)?(oz|ounce|ounces|g|gm|grams?|lbs?|pounds?|kg|ml)\b\.?/i;

function weightToGrams(n: number, u: string): number | null {
  const k = u.toLowerCase();
  if (k.startsWith("oz") || k.startsWith("ounce")) return n * G.oz;
  if (k.startsWith("lb") || k.startsWith("pound")) return n * G.lb;
  if (k === "kg") return n * G.kg;
  if (k === "ml") return n; // close enough for pack labels (liquids)
  if (k.startsWith("g")) return n;
  return null;
}

/**
 * Sort a recipe line's unit into a kind. `raw` is the original line, which
 * settles "t" vs "T" and carries pack sizes like "(14.5 oz)".
 */
export function parseUnit(unitIn: string | null | undefined, raw = "", quantity?: number | null): ParsedUnit {
  let u = (unitIn ?? "").trim().toLowerCase().replace(/\.$/, "").replace(/\s+/g, " ");
  if (u === "null" || u === "undefined") u = "";
  // Units like "14 oz can", "can (11 oz)", "7oz (200g)", "8 oz"
  const embedded = u.match(WEIGHT_RE);
  if (embedded && u !== embedded[0].trim()) {
    const per = weightToGrams(Number(embedded[1]), embedded[3]);
    const rest = u.replace(embedded[0], "").replace(/[()]/g, " ").trim();
    const restKind = UNIT_TABLE[rest];
    if (per && restKind?.kind === "pack") return { unit: restKind, packGrams: per };
    if (per) return { unit: { kind: "mass", grams: per } };
  }
  if (embedded && u === embedded[0].trim()) {
    const per = weightToGrams(Number(embedded[1]), embedded[3]);
    if (per) return { unit: { kind: "mass", grams: per } };
  }

  // "t"/"t." is a teaspoon and "T"/"T." a tablespoon; units were lowercased, so look at the raw line
  if (u === "t" || u === "tb") {
    const m = raw.match(/(?:^|[\s\d½¼¾⅓⅔)])(T|t)\.?(?=\s|$)/);
    u = m?.[1] === "T" ? "tbsp" : u === "tb" ? "tbsp" : "tsp";
  }
  let unit = UNIT_TABLE[u];
  if (!unit) {
    // Plural/abbreviation stragglers: "tbsp." "lbs." "pcs." etc.
    const stripped = u.replace(/[.\s]+$/, "").replace(/s$/, "");
    unit = UNIT_TABLE[stripped] ?? UNIT_TABLE[u.split(" ")[0]] ?? { kind: "piece" };
  }

  const out: ParsedUnit = { unit };
  // Weight stated in the raw text, e.g. "1 can (15 oz) black beans", "4 small avocados (400 g)"
  const paren = raw.match(/\((?:about |approx\.? |~)?(\d+(?:\.\d+)?)\s*-?\s*(oz|ounce|ounces|g|gm|grams?|lbs?|pounds?|kg|ml)\b\.?(?:\s*(?:each|can|cans|pkg|package|jar|box|bag))?\s*\)/i)
    ?? raw.match(/\b(\d+(?:\.\d+)?)\s*-?\s*(oz|ounce|ounces)\.?\s+(?:can|cans|pkg|package|jar|box|bag|container|tub)\b/i);
  if (paren) {
    const grams = weightToGrams(Number(paren[1]), paren[2]);
    if (grams) {
      if (unit.kind === "pack" || /each|can|pkg|package|jar|box|bag|container|tub/i.test(paren[0])) out.packGrams = grams;
      else if (unit.kind === "piece" || unit.kind === "volume") {
        // "4 small avocados (400 g)" is the total; "(42g)" after a bunch too
        out.statedGrams = grams;
      }
    }
  }
  if (unit.kind === "none" && /to taste|as needed|for (garnish|serving|frying|greasing)/i.test(raw) && !quantity) out.unit = { kind: "none" };
  return out;
}

/** What the converter needs to know about the ingredient */
export interface GramFacts {
  /** grams per US cup (density), if known */
  cup?: number;
  /** grams per household portion */
  portions?: Partial<Record<PortionKey, number>>;
  /** grams in the usual can/package */
  pack?: number;
  /** liquids, spices, etc. -- picks a fallback density when cup is unknown */
  aisle?: string;
}

export interface GramResult {
  grams: number | null;
  confidence: Confidence;
  /** short note on how we got it, for the review screen and tests */
  how: string;
}

// Fallback densities (g per cup) by aisle when the ingredient has no cup weight
const AISLE_CUP: Record<string, number> = {
  "Spices & Seasonings": 110, "Baking": 150, "Oils, Vinegars & Condiments": 230, "Beverages": 240,
  "Produce": 130, "Dairy & Eggs": 230, "Canned & Jarred": 240, "Pasta, Rice & Grains": 180,
  "Snacks": 100, "Pantry": 200, "Frozen": 140, "Meat & Seafood": 140, "Bakery": 60, "Other": 240,
};

// Sensible grams for portions when the ingredient doesn't say
const GENERIC_PORTION: Partial<Record<PortionKey, number>> = {
  sprig: 1, leaf: 0.5, spray: 0.3, scoop: 31, bunch: 50, slice: 25, inch: 6, stick: 113,
};

/**
 * Grams for `quantity` of `unit` of an ingredient. quantity null/0 with a
 * real unit means "some" (one of it); with "to taste" it's unknown.
 */
export function toGrams(quantity: number | null | undefined, parsed: ParsedUnit, facts: GramFacts | null): GramResult {
  const { unit } = parsed;
  if (unit.kind === "none") return { grams: null, confidence: "low", how: "to taste" };
  const q = quantity && quantity > 0 ? quantity : null;
  if (parsed.statedGrams && unit.kind !== "pack") return { grams: parsed.statedGrams, confidence: "high", how: "weight in line" };
  if (q == null) return { grams: null, confidence: "low", how: "no amount" };

  switch (unit.kind) {
    case "mass":
      return { grams: q * unit.grams, confidence: "high", how: "weight" };
    case "volume": {
      if (facts?.cup) return { grams: (q * unit.ml * facts.cup) / ML.cup, confidence: "high", how: "volume x density" };
      const cup = AISLE_CUP[facts?.aisle ?? "Other"] ?? 200;
      return { grams: (q * unit.ml * cup) / ML.cup, confidence: "medium", how: "volume x typical density" };
    }
    case "pack": {
      const per = parsed.packGrams ?? facts?.pack;
      if (per) return { grams: q * per, confidence: parsed.packGrams ? "high" : "medium", how: parsed.packGrams ? "pack size in line" : "usual pack size" };
      return { grams: null, confidence: "low", how: "unknown pack size" };
    }
    case "piece": {
      const p = facts?.portions ?? {};
      if (unit.portion) {
        const g = p[unit.portion] ?? (unit.portion === "head" ? p.large : undefined) ?? GENERIC_PORTION[unit.portion];
        if (g) return { grams: q * g, confidence: p[unit.portion] ? "high" : "medium", how: unit.portion };
        if (p.piece || p.medium) return { grams: q * (p.piece ?? p.medium)!, confidence: "medium", how: `${unit.portion} as piece` };
        return { grams: null, confidence: "low", how: `unknown ${unit.portion}` };
      }
      const size = unit.size ?? "medium";
      // A stated size we don't have a weight for scales the usual one (small ~0.7x, large ~1.3x)
      const scale = size === "small" ? 0.7 : size === "large" ? 1.3 : 1;
      const exact = p[size] ?? (size === "medium" ? p.piece : undefined);
      const g = exact ?? (p.medium ?? p.piece ? (p.medium ?? p.piece)! * scale : undefined);
      if (g) return { grams: q * g, confidence: exact || !unit.size ? "high" : "medium", how: unit.size ?? "piece" };
      return { grams: null, confidence: "low", how: "unknown piece weight" };
    }
  }
}
