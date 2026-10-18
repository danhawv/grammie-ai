// Dinner parties and potlucks: a host makes a party, sends one invite link,
// and guests claim a course and bring a dish (a recipe from their Grammie
// cookbooks, an upload, or just a name). Shared by the server, the host and
// guest screens and the printables, so they all agree on shapes and rules.
//
// Guests don't need an account. An anonymous guest is a "guest user": a users
// row with is_guest = true that the party creates, so imports and credits work
// exactly as for anyone else. If they later make an account, the guest user's
// recipes and party places move to it (claimGuest).

// ---------------------------------------------------------------- kinds

/**
 * dinner  = everyone cooks for the whole table: recipes scale to the headcount
 * potluck = everyone brings one normal-sized dish: recipes stay as written
 */
export type PartyStyle = "dinner" | "potluck";

export type PartyCourse = "appetizer" | "salad" | "side" | "main" | "dessert" | "drink" | "bread" | "other";

/** Menu and print order */
export const COURSES: { id: PartyCourse; label: string; plural: string }[] = [
  { id: "appetizer", label: "Appetizer", plural: "Appetizers" },
  { id: "salad", label: "Salad or soup", plural: "Salads & Soups" },
  { id: "bread", label: "Bread", plural: "Breads" },
  { id: "main", label: "Main", plural: "Mains" },
  { id: "side", label: "Side", plural: "Sides" },
  { id: "dessert", label: "Dessert", plural: "Desserts" },
  { id: "drink", label: "Drink", plural: "Drinks" },
  { id: "other", label: "Something else", plural: "Also on the table" },
];

export function courseLabel(course: PartyCourse, plural = false): string {
  const c = COURSES.find((x) => x.id === course) ?? COURSES[COURSES.length - 1];
  return plural ? c.plural : c.label;
}

export type RsvpStatus = "yes" | "maybe" | "no";

/** The allergy list guests choose from (matches recipe.allergens from enrichment) */
export const ALLERGENS = [
  "Peanuts", "Tree Nuts", "Dairy", "Eggs", "Gluten", "Shellfish", "Fish", "Soy", "Sesame",
] as const;
export type Allergen = (typeof ALLERGENS)[number];

/** Diets guests can ask for */
export const PARTY_DIETS = [
  { id: "vegetarian", label: "Vegetarian" },
  { id: "vegan", label: "Vegan" },
  { id: "gluten-free", label: "Gluten-free" },
  { id: "dairy-free", label: "Dairy-free" },
  { id: "pescatarian", label: "Pescatarian" },
] as const;
export type PartyDiet = (typeof PARTY_DIETS)[number]["id"];

/** Free credits a guest user starts with (a real account still gets WELCOME_CREDITS) */
export const GUEST_CREDITS = 50;

/** Most dishes one guest can bring to one party */
export const MAX_DISHES_PER_GUEST = 50;

export const MAX_SLOTS = 40;
export const MAX_GUESTS = 150;

// ---------------------------------------------------------------- API shapes

export interface PartySlot {
  id: string;
  course: PartyCourse;
  /** Optional host label, e.g. "Something green" */
  label: string | null;
  position: number;
}

export interface PartyGuest {
  id: string;
  name: string;
  rsvp: RsvpStatus;
  /** +1s etc.: how many people this RSVP covers (1 = just them) */
  partySize: number;
  allergies: Allergen[];
  diets: PartyDiet[];
  /** Free text: "no cilantro", "kosher" */
  dietNote: string | null;
  isHost: boolean;
  /** True when the guest has a real Grammie account (not a guest user) */
  hasAccount: boolean;
  /** Only sent to the host, and to the guest themselves */
  isYou?: boolean;
}

/** What we know about a dish's recipe, enough for the menu, labels and conflicts */
export interface DishRecipeFacts {
  id: string;
  title: string;
  description: string | null;
  image: string | null;
  servings: number | null;
  allergens: string[];
  /** From recipe.dietType / is* flags, lower-case ids as in PARTY_DIETS */
  diets: string[];
  ingredients: string[];
  /** 'extracting' | 'enriching' | 'complete' | 'failed' etc. while an import runs */
  status: string | null;
}

export interface PartyDish {
  id: string;
  slotId: string | null;
  course: PartyCourse;
  guestId: string;
  guestName: string;
  /** Shown on the menu; the recipe title unless the guest typed one */
  title: string;
  note: string | null;
  recipe: DishRecipeFacts | null;
  /** Servings the bringer should make: headcount for dinner, as written for potluck */
  makeServings: number | null;
  /** Multiply the recipe by this (1 for potluck) */
  scale: number;
  conflicts: DishConflict[];
  createdAt: string;
}

export interface DishConflict {
  kind: "allergy" | "diet";
  /** "Peanuts" or "vegetarian" */
  what: string;
  /** Guests affected (names) */
  guests: string[];
  /** "Contains peanuts — Sam is allergic" */
  message: string;
}

export interface PartySummary {
  id: string;
  title: string;
  style: PartyStyle;
  startsAt: string | null;
  location: string | null;
  role: "host" | "guest";
  dishCount: number;
  guestCount: number;
  coverImage: string | null;
}

export interface PartyDetail {
  id: string;
  title: string;
  style: PartyStyle;
  /** ISO date-time, or null while undecided */
  startsAt: string | null;
  location: string | null;
  theme: string | null;
  hostNote: string | null;
  /** Head count the host expects (dinner style scales to this) */
  headcount: number;
  /** Partiful / Evite / Paperless Post page for the same party, if the host linked one */
  externalInviteUrl: string | null;
  coverImage: string | null;
  cookbookId: number | null;
  hostName: string;
  role: "host" | "guest" | "visitor";
  /** Only for the host: the invite link to send guests */
  inviteUrl: string | null;
  slots: PartySlot[];
  guests: PartyGuest[];
  dishes: PartyDish[];
  /** RSVP'd yes, counting party sizes */
  confirmedPeople: number;
  /** The viewer's guest id, if they've joined */
  youGuestId: string | null;
  /** For guests: how many credits their (guest) account has left; null when not enforced/unknown */
  credits: number | null;
}

// ---------------------------------------------------------------- requests

export interface CreatePartyRequest {
  title: string;
  style: PartyStyle;
  startsAt?: string | null;
  location?: string | null;
  theme?: string | null;
  hostNote?: string | null;
  headcount: number;
  /** Course slots to start with; defaultSlots() when omitted */
  slots?: { course: PartyCourse; label?: string | null }[];
}

export type UpdatePartyRequest = Partial<Omit<CreatePartyRequest, "slots">> & {
  externalInviteUrl?: string | null;
};

export interface JoinPartyRequest {
  name: string;
  rsvp: RsvpStatus;
  partySize?: number;
  allergies?: Allergen[];
  diets?: PartyDiet[];
  dietNote?: string | null;
}

/** Bring a dish. Exactly one of recipeId / import / title-only. */
export interface AddDishRequest {
  slotId?: string | null;
  course: PartyCourse;
  /** A recipe the guest already has in Grammie (signed-in guests) */
  recipeId?: string;
  /** Free-text dish with no recipe, e.g. "Bottle of red" */
  title?: string;
  note?: string | null;
}

/** Anonymous guests send this header on /api/party/:token/* calls */
export const GUEST_HEADER = "X-Party-Guest";

/** localStorage key holding { [inviteToken]: guestToken } */
export const GUEST_STORAGE_KEY = "grammie.partyGuests";

// ---------------------------------------------------------------- rules

/** A reasonable start for the course list */
export function defaultSlots(style: PartyStyle, headcount: number): { course: PartyCourse; label: null }[] {
  const n = Math.max(2, Math.min(60, Math.round(headcount)));
  const counts: Record<PartyCourse, number> =
    style === "dinner"
      ? { appetizer: 1, salad: 1, bread: 0, main: 1, side: n >= 8 ? 2 : 1, dessert: 1, drink: 1, other: 0 }
      : {
          appetizer: Math.max(1, Math.round(n / 8)),
          salad: Math.max(1, Math.round(n / 12)),
          bread: 0,
          main: Math.max(1, Math.round(n / 8)),
          side: Math.max(1, Math.round(n / 6)),
          dessert: Math.max(1, Math.round(n / 8)),
          drink: 1,
          other: 0,
        };
  const out: { course: PartyCourse; label: null }[] = [];
  for (const c of COURSES) for (let i = 0; i < counts[c.id]; i++) out.push({ course: c.id, label: null });
  return out;
}

/**
 * How much of a recipe to make. Dinner style feeds the whole table; potluck
 * means a normal-sized dish. Scales are rounded to quarters and kept between
 * 0.25 and 12 so the numbers stay cookable.
 */
export function dishScale(style: PartyStyle, recipeServings: number | null | undefined, headcount: number): { scale: number; makeServings: number | null } {
  if (!recipeServings || recipeServings <= 0) return { scale: 1, makeServings: null };
  if (style === "potluck") return { scale: 1, makeServings: recipeServings };
  const raw = Math.max(1, headcount) / recipeServings;
  const scale = Math.min(12, Math.max(0.25, Math.round(raw * 4) / 4));
  return { scale, makeServings: Math.round(recipeServings * scale) };
}

const ALLERGEN_WORDS: Record<Allergen, RegExp> = {
  Peanuts: /\bpeanut/i,
  "Tree Nuts": /\b(almond|walnut|pecan|cashew|pistachio|hazelnut|macadamia|pine nut|brazil nut|praline|marzipan|nutella)/i,
  Dairy: /\b(milk|butter|cream|cheese|yogurt|yoghurt|ghee|parmesan|mozzarella|cheddar|ricotta|buttermilk|half-and-half|whey)\b/i,
  Eggs: /\beggs?\b|\bmayonnaise\b|\bmayo\b|\bmeringue\b/i,
  Gluten: /\b(flour|bread|breadcrumbs?|panko|pasta|noodles?|wheat|barley|rye|couscous|cracker|tortilla|pie crust|soy sauce|beer)\b/i,
  Shellfish: /\b(shrimp|prawn|crab|lobster|scallop|clam|mussel|oyster|crawfish|crayfish)/i,
  Fish: /\b(salmon|tuna|cod|tilapia|halibut|anchov|sardine|trout|fish|mahi|snapper|bass)\b/i,
  Soy: /\b(soy|tofu|edamame|miso|tempeh|tamari)\b/i,
  Sesame: /\b(sesame|tahini)\b/i,
};

/** Flags that undo a word match ("almond milk" isn't dairy, "gluten-free flour" isn't gluten) */
const FREE_OF: Partial<Record<Allergen, RegExp>> = {
  Dairy: /\b(almond|oat|soy|coconut|rice|cashew) (milk|cream|yogurt)|dairy[- ]free( \w+)?|vegan (butter|cheese)|cream of tartar|peanut butter|almond butter|cocoa butter|coconut cream/i,
  Gluten: /gluten[- ]free( \w+)?|almond flour|coconut flour|rice flour|corn tortilla|tamari/i,
  Eggs: /egg[- ]free|eggplant/i,
  Soy: /soy[- ]free( \w+)?/i,
};

/**
 * Allergens in a recipe: what enrichment found, plus a word check of the
 * ingredients so a dish still being imported (or never enriched) is covered.
 * Errs on the side of flagging; the host can see why.
 */
export function dishAllergens(recipe: Pick<DishRecipeFacts, "allergens" | "ingredients"> | null): Allergen[] {
  if (!recipe) return [];
  const found = new Set<Allergen>();
  for (const a of recipe.allergens ?? []) {
    const hit = ALLERGENS.find((x) => x.toLowerCase() === String(a).toLowerCase());
    if (hit) found.add(hit);
  }
  for (const line of recipe.ingredients ?? []) {
    for (const a of ALLERGENS) {
      if (found.has(a)) continue;
      const free = FREE_OF[a];
      const cleaned = free ? line.replace(new RegExp(free.source, "gi"), " ") : line;
      if (ALLERGEN_WORDS[a].test(cleaned)) found.add(a);
    }
  }
  return ALLERGENS.filter((a) => found.has(a));
}

const MEAT = /\b(beef|pork|chicken|turkey|lamb|bacon|ham|sausage|prosciutto|pepperoni|salami|veal|duck|chorizo|steak|ground meat|gelatin|lard)\b/i;
const SEAFOOD = /\b(shrimp|prawn|crab|lobster|scallop|clam|mussel|oyster|salmon|tuna|cod|tilapia|halibut|anchov|sardine|trout|fish)\b/i;
const ANIMAL = /\b(honey|egg|eggs|milk|butter|cream|cheese|yogurt|ghee|mayonnaise)\b/i;

/** Whether a dish suits a diet; null when there's no recipe to judge by */
export function dishFitsDiet(recipe: Pick<DishRecipeFacts, "diets" | "allergens" | "ingredients"> | null, diet: PartyDiet): boolean | null {
  if (!recipe) return null;
  if ((recipe.diets ?? []).map((d) => d.toLowerCase()).includes(diet)) return true;
  const text = (recipe.ingredients ?? []).join("\n");
  const allergens = dishAllergens(recipe);
  switch (diet) {
    case "vegetarian": return !MEAT.test(text) && !SEAFOOD.test(text);
    case "pescatarian": return !MEAT.test(text);
    case "vegan": return !MEAT.test(text) && !SEAFOOD.test(text) && !allergens.includes("Dairy") && !allergens.includes("Eggs") && !ANIMAL.test(text.replace(/\b(almond|oat|soy|coconut) (milk|butter|cream|yogurt)|peanut butter|vegan \w+/gi, " "));
    case "gluten-free": return !allergens.includes("Gluten");
    case "dairy-free": return !allergens.includes("Dairy");
  }
}

/** Allergy and diet clashes between one dish and the guests coming */
export function dishConflicts(
  recipe: Pick<DishRecipeFacts, "diets" | "allergens" | "ingredients"> | null,
  guests: Pick<PartyGuest, "name" | "rsvp" | "allergies" | "diets">[],
): DishConflict[] {
  if (!recipe) return [];
  const coming = guests.filter((g) => g.rsvp !== "no");
  const allergens = dishAllergens(recipe);
  const out: DishConflict[] = [];
  for (const a of allergens) {
    const names = coming.filter((g) => g.allergies.includes(a)).map((g) => g.name);
    if (names.length) out.push({ kind: "allergy", what: a, guests: names, message: `Contains ${a.toLowerCase()}: ${listNames(names)} ${names.length === 1 ? "is" : "are"} allergic` });
  }
  for (const d of PARTY_DIETS) {
    const names = coming.filter((g) => g.diets.includes(d.id)).map((g) => g.name);
    if (names.length && dishFitsDiet(recipe, d.id) === false) {
      out.push({ kind: "diet", what: d.id, guests: names, message: `Not ${d.label.toLowerCase()}: ${listNames(names)} ${names.length === 1 ? "eats" : "eat"} ${d.label.toLowerCase()}` });
    }
  }
  return out;
}

/** What each guest with a restriction can eat, for the host's "everyone's covered?" check */
export function safeDishesFor(
  guest: Pick<PartyGuest, "allergies" | "diets">,
  dishes: Pick<PartyDish, "id" | "course" | "recipe">[],
): { safe: string[]; unknown: string[] } {
  const safe: string[] = [];
  const unknown: string[] = [];
  for (const d of dishes) {
    if (!d.recipe) { unknown.push(d.id); continue; }
    const bad = dishAllergens(d.recipe).some((a) => guest.allergies.includes(a))
      || guest.diets.some((diet) => dishFitsDiet(d.recipe, diet) === false);
    if (!bad) safe.push(d.id);
  }
  return { safe, unknown };
}

/** Same dish twice? Compares normalised titles */
export function duplicateOf(title: string, dishes: Pick<PartyDish, "id" | "title" | "guestName">[]): Pick<PartyDish, "id" | "title" | "guestName"> | null {
  const key = normTitle(title);
  if (!key) return null;
  return dishes.find((d) => normTitle(d.title) === key) ?? null;
}

function normTitle(t: string): string {
  return t.toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\band\b|\bwith\b/g, " ")
    .replace(/\b(grandma'?s|grammie'?s|mom'?s|my|the|best|easy|classic|homemade|famous|world'?s)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/s\b/g, "");
}

export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`;
}

/** Dishes grouped by course in menu order, empty courses left out */
export function menuSections<T extends Pick<PartyDish, "course">>(dishes: T[]): { course: PartyCourse; title: string; dishes: T[] }[] {
  return COURSES
    .map((c) => ({ course: c.id, title: c.plural, dishes: dishes.filter((d) => d.course === c.id) }))
    .filter((s) => s.dishes.length > 0);
}

/** Slots nobody has claimed yet */
export function openSlots(slots: PartySlot[], dishes: Pick<PartyDish, "slotId">[]): PartySlot[] {
  const taken = new Set(dishes.map((d) => d.slotId).filter(Boolean));
  return slots.filter((s) => !taken.has(s.id));
}

/** Short allergen labels for food tents ("Contains: nuts, dairy") */
export const ALLERGEN_SHORT: Record<Allergen, string> = {
  Peanuts: "peanuts", "Tree Nuts": "tree nuts", Dairy: "dairy", Eggs: "eggs", Gluten: "gluten",
  Shellfish: "shellfish", Fish: "fish", Soy: "soy", Sesame: "sesame",
};

// ---------------------------------------------------------------- printables

export type PrintableKind = "menu" | "place-cards" | "food-labels" | "recipe-cards";

export const PRINTABLES: { id: PrintableKind; title: string; hint: string }[] = [
  { id: "menu", title: "Menu", hint: "One page: every course, each dish and who made it" },
  { id: "place-cards", title: "Place cards", hint: "Fold-over name cards for the table, 6 per page" },
  { id: "food-labels", title: "Food labels", hint: "A tent card beside each dish: name, cook and what's in it" },
  { id: "recipe-cards", title: "Take-home recipe cards", hint: "Each recipe with a code that opens it on a phone" },
];

// ---------------------------------------------------------------- Partiful and other invite apps

/**
 * Partiful has no API, so the link goes both ways by hand: the host pastes
 * their Partiful (or Evite, Luma, Paperless Post) link here, and copies a
 * blurb with the Grammie link into Partiful's "Custom link or text" field.
 * Pasting a link prefills the title and image from its public preview tags
 * (what any link preview reads); nothing else is fetched from those sites.
 */
export interface InvitePreview {
  /** "partiful" | "evite" | "luma" | "paperless" | "other" */
  site: string;
  title: string | null;
  image: string | null;
}

export function inviteSite(url: string): string {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  if (host.endsWith("partiful.com")) return "partiful";
  if (host.endsWith("evite.com")) return "evite";
  if (host === "lu.ma" || host.endsWith("luma.com")) return "luma";
  if (host.endsWith("paperlesspost.com")) return "paperless";
  return "other";
}

/** The text a host pastes into Partiful's custom link field or description */
export function inviteBlurb(party: Pick<PartyDetail, "style">, link: string): string {
  return party.style === "potluck"
    ? `🍲 Potluck sign-up: claim a dish and flag any allergies here (no account needed): ${link}`
    : `🍽️ Pick what you're bringing and flag any allergies here (no account needed): ${link}`;
}
