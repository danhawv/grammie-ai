// Appliances a recipe may need, in one normalized vocabulary shared by food
// data (what a recipe needs), the planner (what the kitchen has) and the
// screens. Ovens, stovetops, pans, pots, knives and bowls are basic: every
// kitchen has them, so they're never "needed" appliances.

export const APPLIANCE_KINDS = [
  "rice cooker", "slow cooker", "instant pot", "air fryer", "grill", "smoker", "sous vide",
  "ice cream maker", "waffle iron", "bread machine", "dehydrator", "deep fryer",
  "stand mixer", "hand mixer", "blender", "food processor",
] as const;
export type ApplianceKind = (typeof APPLIANCE_KINDS)[number];

/** Nice to have: the dish can be made without one (by hand, a whisk, a knife). */
export const SOFT_APPLIANCES: ReadonlySet<string> = new Set(["stand mixer", "hand mixer", "blender", "food processor"]);

// Order matters: the first match wins ("grill pan" is a pan, not a grill).
const RULES: Array<[RegExp, ApplianceKind | null]> = [
  [/grill pan|griddle pan|grill basket|grilling pan/, null],
  [/pastry blender|dough blender/, null], // hand tools
  [/rice cooker/, "rice cooker"],
  [/slow[- ]?cooker|crock[- ]?pot/, "slow cooker"],
  [/instant ?pot|pressure cooker|multi[- ]?cooker/, "instant pot"],
  [/air[- ]?fryer/, "air fryer"],
  [/smoker/, "smoker"],
  [/\bgrill\b|barbecue|\bbbq\b/, "grill"],
  [/sous[- ]?vide|immersion circulator/, "sous vide"],
  [/ice cream (maker|machine)|ninja creami|\bcreami\b/, "ice cream maker"],
  [/waffle (iron|maker)/, "waffle iron"],
  [/bread (machine|maker)/, "bread machine"],
  [/dehydrator/, "dehydrator"],
  [/deep[- ]?fryer/, "deep fryer"],
  [/stand mixer|kitchenaid/, "stand mixer"],
  [/hand mixer|electric mixer|\bmixer\b/, "hand mixer"],
  [/blender/, "blender"],
  [/food processor|mini chopper/, "food processor"],
];

/** "Large Slow Cooker (6 qt)" -> "slow cooker"; basic tools -> null */
export function normalizeAppliance(raw: string): ApplianceKind | null {
  const t = raw.toLowerCase().replace(/[_]/g, " ");
  for (const [re, kind] of RULES) if (re.test(t)) return kind;
  return null;
}

/** Distinct appliance kinds named in a list of equipment or tool strings. */
export function appliancesIn(items: Array<string | null | undefined>): ApplianceKind[] {
  const out = new Set<ApplianceKind>();
  for (const i of items) {
    if (!i) continue;
    const k = normalizeAppliance(i);
    if (k) out.add(k);
  }
  return APPLIANCE_KINDS.filter((k) => out.has(k));
}
