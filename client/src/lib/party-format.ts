import {
  ALLERGENS,
  COURSES,
  PARTY_DIETS,
  safeDishesFor,
  type Allergen,
  type DishRecipeFacts,
  type PartyCourse,
  type PartyDetail,
  type PartyDiet,
  type PartyDish,
  type PartyGuest,
  type PartySlot,
} from "@shared/party";
import { formatQuantityNumber } from "@shared/recipe-display";
import { publicUrl } from "./platform";

// Small, pure helpers for the party screens: dates, links, scale wording,
// import progress, the host's "Everyone covered?" check, and Food profile
// prefill for the join form.

/** Client routes */
export const partyPath = (id: string) => `/parties/${id}`;
export const guestPath = (token: string) => `/p/${token}`;
export const dishPath = (token: string, dishId: string) => `/p/${token}/dish/${dishId}`;
export const printPath = (id: string, kind: string) => `/parties/${id}/print/${kind}`;

/** Sign-up (or sign-in) that comes back to the party; with claim, the guest's dish moves to the new account */
export function signUpPath(token: string, claim: boolean, mode: "signup" | "signin" = "signup"): string {
  const next = guestPath(token) + (claim ? "?claim=1" : "");
  return `/login?${mode === "signup" ? "mode=signup&" : ""}next=${encodeURIComponent(next)}`;
}

/** A ?next= value that's safe to go to after sign-in: a path on this site, else null */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}

/** "Saturday, Nov 8 · 6:30 PM", or null when there's no date yet */
export function formatPartyDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}

/** ISO → the value a <input type="datetime-local"> wants, in local time */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value → ISO, or null when blank or invalid */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The invite token from the host's invite link ("https://…/p/abc" or "/p/abc") */
export function inviteTokenFrom(inviteUrl: string | null | undefined): string | null {
  if (!inviteUrl) return null;
  const m = /\/p\/([^/?#]+)/.exec(inviteUrl);
  return m ? decodeURIComponent(m[1]) : null;
}

/** The invite link as something to send: full URL that works from the app too */
export function shareableInvite(inviteUrl: string | null | undefined): string | null {
  if (!inviteUrl) return null;
  if (/^https?:\/\//i.test(inviteUrl)) return inviteUrl;
  const token = inviteTokenFrom(inviteUrl);
  return publicUrl(token ? guestPath(token) : inviteUrl);
}

/** "2.5" → "2½" */
export function formatScale(scale: number): string {
  return formatQuantityNumber(scale) || String(scale);
}

/** "Make 2½× the recipe: enough for 10", or null when there's nothing to say */
export function scaleText(dish: Pick<PartyDish, "scale" | "makeServings">, style: PartyDetail["style"]): string | null {
  if (style !== "dinner" || !dish.makeServings) return null;
  if (dish.scale === 1) return `Make the recipe as written: enough for ${dish.makeServings}`;
  return `Make ${formatScale(dish.scale)}× the recipe: enough for ${dish.makeServings}`;
}

const DONE = new Set(["ready", "complete", "completed", "failed", "error"]);

/** True while a dish's recipe is still being read (an import is running) */
export function isImporting(recipe: Pick<DishRecipeFacts, "status"> | null | undefined): boolean {
  return !!recipe?.status && !DONE.has(recipe.status);
}

export function importFailed(recipe: Pick<DishRecipeFacts, "status"> | null | undefined): boolean {
  return recipe?.status === "failed" || recipe?.status === "error";
}

/** Poll the party while any dish's import is still running */
export function anyImporting(party: Pick<PartyDetail, "dishes"> | null | undefined): boolean {
  return !!party?.dishes.some((d) => isImporting(d.recipe));
}

export interface CourseGroup {
  course: PartyCourse;
  title: string;
  slots: { slot: PartySlot; dish: PartyDish | null }[];
  /** Dishes in this course that aren't on a slot (slot removed, or "something else") */
  extras: PartyDish[];
}

/** The menu board: each course with its slots (claimed or open) and any extra dishes */
export function menuBoard(slots: PartySlot[], dishes: PartyDish[]): CourseGroup[] {
  const sorted = [...slots].sort((a, b) => a.position - b.position);
  const used = new Set<string>();
  return COURSES.map((c) => {
    const courseSlots = sorted.filter((s) => s.course === c.id).map((slot) => {
      const dish = dishes.find((d) => d.slotId === slot.id && !used.has(d.id)) ?? null;
      if (dish) used.add(dish.id);
      return { slot, dish };
    });
    return { course: c.id, title: c.plural, slots: courseSlots, extras: [] as PartyDish[] };
  }).map((g) => ({ ...g, extras: dishes.filter((d) => d.course === g.course && !used.has(d.id)) }))
    .filter((g) => g.slots.length > 0 || g.extras.length > 0);
}

/** Who has a restriction, and how many dishes they can eat; `worry` = 0–1 safe mains and sides */
export interface Coverage {
  guest: PartyGuest;
  safe: number;
  unknown: number;
  safeMainsAndSides: number;
  worry: boolean;
}

export function coverage(guests: PartyGuest[], dishes: PartyDish[]): Coverage[] {
  return guests
    .filter((g) => g.rsvp !== "no" && (g.allergies.length > 0 || g.diets.length > 0))
    .map((guest) => {
      const { safe, unknown } = safeDishesFor(guest, dishes);
      const safeSet = new Set(safe);
      const safeMainsAndSides = dishes.filter((d) => safeSet.has(d.id) && (d.course === "main" || d.course === "side")).length;
      return { guest, safe: safe.length, unknown: unknown.length, safeMainsAndSides, worry: safeMainsAndSides <= 1 };
    });
}

/** "Peanuts, vegetarian" for a guest's restrictions */
export function restrictionsText(g: Pick<PartyGuest, "allergies" | "diets" | "dietNote">): string {
  const parts = [
    ...g.allergies.map((a) => `${a} allergy`),
    ...g.diets.map((d) => PARTY_DIETS.find((x) => x.id === d)?.label ?? d),
  ];
  if (g.dietNote) parts.push(g.dietNote);
  return parts.join(", ");
}

const ALLERGY_WORDS: Record<string, Allergen> = {
  peanut: "Peanuts", peanuts: "Peanuts",
  "tree nut": "Tree Nuts", "tree nuts": "Tree Nuts", nuts: "Tree Nuts", nut: "Tree Nuts", almonds: "Tree Nuts", walnuts: "Tree Nuts",
  dairy: "Dairy", milk: "Dairy", lactose: "Dairy",
  egg: "Eggs", eggs: "Eggs",
  gluten: "Gluten", wheat: "Gluten",
  shellfish: "Shellfish", shrimp: "Shellfish",
  fish: "Fish",
  soy: "Soy", soya: "Soy",
  sesame: "Sesame",
};

/**
 * A signed-in guest's Food profile as join-form answers. Allergies that
 * aren't on the party list (e.g. "cilantro") go into the note.
 */
export function joinPrefillFromProfile(profile: { allergies: string[]; diets: string[] }): {
  allergies: Allergen[];
  diets: PartyDiet[];
  dietNote: string;
} {
  const allergies = new Set<Allergen>();
  const other: string[] = [];
  for (const raw of profile.allergies) {
    const v = raw.trim().toLowerCase();
    if (!v) continue;
    const hit = ALLERGY_WORDS[v] ?? ALLERGENS.find((a) => a.toLowerCase() === v);
    if (hit) allergies.add(hit);
    else other.push(raw.trim());
  }
  const dietIds = new Set<string>(PARTY_DIETS.map((d) => d.id));
  const diets = profile.diets.map((d) => d.trim().toLowerCase()).filter((d): d is PartyDiet => dietIds.has(d));
  return {
    allergies: ALLERGENS.filter((a) => allergies.has(a)),
    diets: Array.from(new Set(diets)),
    dietNote: other.length ? `Also avoid: ${other.join(", ")}` : "",
  };
}

/** A recipe from the user's own list as facts for the conflict and duplicate checks */
export function recipeFactsFrom(r: any): DishRecipeFacts {
  const diets: string[] = (Array.isArray(r?.dietType) ? r.dietType : []).map((d: unknown) => String(d).toLowerCase());
  const flag = (on: unknown, id: string) => { if (on === true && !diets.includes(id)) diets.push(id); };
  flag(r?.isVegetarian, "vegetarian");
  flag(r?.isVegan, "vegan");
  flag(r?.isPescatarian, "pescatarian");
  flag(r?.isGlutenFree, "gluten-free");
  flag(r?.isDairyFree, "dairy-free");
  return {
    id: String(r?.id ?? ""),
    title: String(r?.title ?? ""),
    description: r?.description ?? null,
    image: r?.dishImageThumbnail ?? r?.dishImage ?? null,
    servings: typeof r?.servings === "number" ? r.servings : null,
    allergens: Array.isArray(r?.allergens) ? r.allergens : [],
    diets,
    ingredients: Array.isArray(r?.ingredients) ? r.ingredients.map(String) : [],
    status: null,
  };
}

/** Scaled amounts for one normalized ingredient (quantity × scale) */
export function scaleIngredient<T extends { quantity?: number | null }>(ing: T, scale: number): T {
  if (scale === 1 || typeof ing?.quantity !== "number") return ing;
  return { ...ing, quantity: Math.round(ing.quantity * scale * 100) / 100 };
}
