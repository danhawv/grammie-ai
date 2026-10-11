import type { TaskKind } from "@shared/meal-prep/contract";
import type { Heat } from "./types";

// Plain components that several recipes or plate adjusters can share: a pot
// of rice, a pan of chicken breast. When two recipes both call for "2 cups
// cooked rice", or the plan adds 900 g of plain rice to plates, it's cooked
// once. Times are for the base amount and scale with scaleTask.

export interface ComponentStep {
  text: string;
  kind: TaskKind;
  activeMin: number;
  passiveMin: number;
  heat: Heat;
  tempF?: number;
  vessel: string | null;
  appliance?: string;
  doneCue?: string;
  holdMin: number;
}

export interface ComponentDef {
  key: string;
  /** what it's called in task text */
  name: string;
  match: RegExp;
  /** cooked weight per raw (dry) weight */
  cookedPerRaw: number;
  /** recipe lines like "2 cups cooked rice" state the cooked amount; "1 lb chicken, cooked" the raw */
  lineAmountIs: "cooked" | "raw";
  /** raw grams the times below are for */
  baseRawGrams: number;
  steps(opts: { riceCooker: boolean }): ComponentStep[];
  /** food safety note for the session */
  safety?: string;
}

const NOT_PLAIN = /\b(brown|wild|cauliflower|paper|vinegar|noodle|wine|flour|cake|pudding|krispies|minute|instant)\b/;

export const COMPONENTS: ComponentDef[] = [
  {
    key: "rice", name: "rice", match: /\b(white |jasmine |basmati |long[- ]grain )?rice\b/, cookedPerRaw: 3,
    lineAmountIs: "cooked", baseRawGrams: 370,
    steps: ({ riceCooker }) => riceCooker
      ? [{ text: "Rinse the rice and start it in the rice cooker", kind: "simmer", activeMin: 4, passiveMin: 35, heat: "appliance", appliance: "rice cooker", vessel: null, doneCue: "Rice cooker clicks to warm", holdMin: 30 }]
      : [
          { text: "Rinse the rice, then bring it to a boil with water (1 part rice to 1½ parts water), cover and cook on low", kind: "simmer", activeMin: 4, passiveMin: 18, heat: "burner", vessel: "saucepan", doneCue: "Water is absorbed", holdMin: 15 },
          { text: "Take the rice off the heat and let it stand, covered, then fluff with a fork", kind: "rest", activeMin: 1, passiveMin: 10, heat: "none", vessel: "saucepan", holdMin: 30 },
        ],
    safety: "Cooked rice: spread it out in a shallow container so it cools fast, and refrigerate it soon after cooking.",
  },
  {
    key: "brown-rice", name: "brown rice", match: /\bbrown rice\b/, cookedPerRaw: 2.6, lineAmountIs: "cooked", baseRawGrams: 370,
    steps: () => [
      { text: "Rinse the brown rice, bring it to a boil with water (1 part rice to 2 parts water), cover and cook on low", kind: "simmer", activeMin: 4, passiveMin: 45, heat: "burner", vessel: "saucepan", doneCue: "Water is absorbed", holdMin: 15 },
      { text: "Let the brown rice stand, covered, then fluff with a fork", kind: "rest", activeMin: 1, passiveMin: 10, heat: "none", vessel: "saucepan", holdMin: 30 },
    ],
    safety: "Cooked rice: spread it out in a shallow container so it cools fast, and refrigerate it soon after cooking.",
  },
  {
    key: "quinoa", name: "quinoa", match: /\bquinoa\b/, cookedPerRaw: 2.7, lineAmountIs: "cooked", baseRawGrams: 340,
    steps: () => [
      { text: "Rinse the quinoa, bring it to a boil with water (1 to 2), cover and cook on low", kind: "simmer", activeMin: 3, passiveMin: 15, heat: "burner", vessel: "saucepan", doneCue: "Water is absorbed", holdMin: 15 },
      { text: "Let the quinoa stand, covered, then fluff it", kind: "rest", activeMin: 1, passiveMin: 5, heat: "none", vessel: "saucepan", holdMin: 30 },
    ],
  },
  {
    key: "pasta", name: "pasta", match: /\b(pasta|spaghetti|penne|macaroni|rotini|fusilli)\b/, cookedPerRaw: 2.2, lineAmountIs: "cooked", baseRawGrams: 450,
    steps: () => [
      { text: "Bring a large pot of salted water to a boil", kind: "simmer", activeMin: 2, passiveMin: 12, heat: "burner", vessel: "large pot", holdMin: 30 },
      { text: "Boil the pasta until just tender, drain and toss with a little oil", kind: "cook", activeMin: 4, passiveMin: 8, heat: "burner", vessel: "large pot", doneCue: "Tender with a little bite", holdMin: 20 },
    ],
  },
  {
    key: "chicken-breast", name: "chicken breast", match: /\bchicken breast|\bchix breast|\bchicken\b(?!.*\b(thigh|stock|broth|soup|base|bouillon|leg|wing)\b)/, cookedPerRaw: 0.75,
    lineAmountIs: "raw", baseRawGrams: 900,
    steps: () => [
      { text: "Season the chicken breasts with salt, pepper and a little oil and lay them on a sheet pan", kind: "prep", activeMin: 5, passiveMin: 0, heat: "none", vessel: "sheet pan", holdMin: 30 },
      { text: "Roast the chicken breasts", kind: "bake", activeMin: 1, passiveMin: 22, heat: "oven", tempF: 425, vessel: "sheet pan", doneCue: "Thickest part reaches 165°F", holdMin: 20 },
      { text: "Let the chicken rest, then cut or shred it", kind: "prep", activeMin: 6, passiveMin: 5, heat: "none", vessel: null, holdMin: 60 },
    ],
  },
  {
    key: "chicken-thigh", name: "chicken thighs", match: /\bchicken thigh/, cookedPerRaw: 0.7, lineAmountIs: "raw", baseRawGrams: 900,
    steps: () => [
      { text: "Season the chicken thighs with salt, pepper and a little oil and lay them on a sheet pan", kind: "prep", activeMin: 5, passiveMin: 0, heat: "none", vessel: "sheet pan", holdMin: 30 },
      { text: "Roast the chicken thighs", kind: "bake", activeMin: 1, passiveMin: 25, heat: "oven", tempF: 425, vessel: "sheet pan", doneCue: "Reaches 175°F", holdMin: 20 },
      { text: "Let the chicken rest, then cut it", kind: "prep", activeMin: 5, passiveMin: 5, heat: "none", vessel: null, holdMin: 60 },
    ],
  },
  {
    key: "ground-meat", name: "ground meat", match: /\bground (beef|turkey|chicken|pork)\b/, cookedPerRaw: 0.75, lineAmountIs: "raw", baseRawGrams: 450,
    steps: () => [
      { text: "Brown the ground meat in a skillet, breaking it up, and drain the fat", kind: "cook", activeMin: 10, passiveMin: 0, heat: "burner", vessel: "skillet", doneCue: "No pink left (160°F)", holdMin: 30 },
    ],
  },
  {
    key: "egg", name: "eggs", match: /\b(hard[- ]boiled )?eggs?\b/, cookedPerRaw: 1, lineAmountIs: "raw", baseRawGrams: 600,
    steps: () => [
      { text: "Cover the eggs with water, bring to a boil, then turn off the heat and cover", kind: "simmer", activeMin: 2, passiveMin: 22, heat: "burner", vessel: "saucepan", holdMin: 10 },
      { text: "Move the eggs to cold water to cool", kind: "chill", activeMin: 2, passiveMin: 10, heat: "none", vessel: "mixing bowl", holdMin: 120 },
    ],
  },
  {
    key: "potato", name: "potatoes", match: /\b(sweet )?potato/, cookedPerRaw: 0.85, lineAmountIs: "raw", baseRawGrams: 900,
    steps: () => [
      { text: "Cut the potatoes into chunks, toss with oil and salt on a sheet pan", kind: "prep", activeMin: 8, passiveMin: 0, heat: "none", vessel: "sheet pan", holdMin: 30 },
      { text: "Roast the potatoes, turning once", kind: "bake", activeMin: 2, passiveMin: 30, heat: "oven", tempF: 425, vessel: "sheet pan", doneCue: "Browned and tender", holdMin: 30 },
    ],
  },
  {
    key: "roast-veg", name: "vegetables", match: /\b(broccoli|green beans|brussels|cauliflower|vegetables|veggies|asparagus)\b/, cookedPerRaw: 0.85,
    lineAmountIs: "raw", baseRawGrams: 700,
    steps: () => [
      { text: "Cut the vegetables, toss with oil and salt on a sheet pan", kind: "prep", activeMin: 8, passiveMin: 0, heat: "none", vessel: "sheet pan", holdMin: 60 },
      { text: "Roast the vegetables", kind: "bake", activeMin: 1, passiveMin: 20, heat: "oven", tempF: 425, vessel: "sheet pan", doneCue: "Browned at the edges", holdMin: 30 },
    ],
  },
];

/** The shared component an ingredient or adjuster is, if any */
export function componentFor(text: string): ComponentDef | null {
  const t = text.toLowerCase().replace(/-/g, " ");
  for (const def of COMPONENTS) {
    if (!def.match.test(t)) continue;
    if ((def.key === "rice" || def.key === "pasta") && NOT_PLAIN.test(t)) continue;
    return def;
  }
  return null;
}

/** A recipe line that asks for something already cooked ("2 cups cooked rice", "1 lb chicken, cooked and cubed") */
export function isCookedLine(raw: string, prep: string | null, id: string | null): boolean {
  const text = `${raw} ${prep ?? ""} ${id ?? ""}`.toLowerCase();
  return /\bcooked\b/.test(text.replace(/-/g, " ")) && !/\b(un|pre|half)[- ]?cooked\b/.test(text);
}

/** Raw grams to buy and cook for a component amount stated as `is` */
export function rawGrams(def: ComponentDef, grams: number, is: "cooked" | "raw"): number {
  return is === "cooked" ? grams / def.cookedPerRaw : grams;
}
