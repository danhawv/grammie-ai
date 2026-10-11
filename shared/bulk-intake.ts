// Bulk intake: bringing in a whole box of recipe cards at once (hundreds of
// photos from a folder, a .zip or Google Drive). The server looks at every
// photo cheaply first (which way up, what it is, front or back), then this
// file turns those answers into a plan the person reviews before anything is
// imported: which photos make one recipe, which are incomplete (a front that
// says "over" with no back), which are already in the cookbook, and which
// are duplicates. Pure logic, shared by the server (plan, limits, estimates)
// and the review screen. See docs/BULK_IMPORT.md.

// ---------------------------------------------------------------------------
// What the cheap first look says about one photo
// ---------------------------------------------------------------------------

export type CardRotation = 0 | 90 | 180 | 270;
export type PhotoKind = "recipe" | "dish_photo" | "blank" | "other";

export interface PhotoCatalog {
  /** Clockwise degrees that make the photo upright */
  rotate: CardRotation;
  kind: PhotoKind;
  /** Recipe name as written ("" when the photo has none, e.g. a card's back) */
  title: string;
  /** "back" = the rest of a recipe that starts on another card */
  side: "front" | "back";
  /** Says "over" / "cont." / "see back", or stops mid-recipe */
  continues: boolean;
  /** Has cooking directions (a front with only ingredients may have a back) */
  hasDirections: boolean;
  /** How many separate recipes are on this photo */
  recipeCount: number;
  /** First line of the recipe text (after the title) */
  firstLine: string;
  /** Last few words of text, where a continuation would pick up */
  lastLine: string;
  /** Short description of the paper ("white lined index card, blue ink") */
  paper: string;
  /** Part of the writing is outside the photo */
  cutOff: boolean;
  hardToRead: boolean;
}

/** Bumped when the first-look prompt changes, so cached answers are redone */
export const CATALOG_VERSION = 1;

const KINDS: PhotoKind[] = ["recipe", "dish_photo", "blank", "other"];
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

/**
 * Checks and tidies a model's answer (docs/DESIGN_PRINCIPLES.md §6.10: AI
 * output is untrusted). `panel` is the 1-4 panel the model said reads upright.
 */
export function sanitizeCatalog(raw: unknown): PhotoCatalog | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const panel = Number(r.panel);
  const rotations: CardRotation[] = [0, 90, 180, 270];
  const kind = KINDS.includes(r.kind as PhotoKind) ? (r.kind as PhotoKind) : "other";
  const title = clip(r.title, 120);
  const count = Math.round(Number(r.recipe_count ?? r.recipeCount));
  return {
    rotate: panel >= 1 && panel <= 4 ? rotations[panel - 1] : 0,
    kind,
    title,
    // Models rarely call a side "back" on their own; a recipe with no title
    // is almost always the second side of something
    side: kind === "recipe" && (!title || r.side === "back") ? "back" : "front",
    continues: r.continues === true,
    hasDirections: r.has_directions !== false && r.hasDirections !== false,
    recipeCount: kind === "recipe" ? (count >= 1 && count <= 20 ? count : 1) : 0,
    firstLine: clip(r.first_line ?? r.firstLine, 160),
    lastLine: clip(r.last_line ?? r.lastLine, 160),
    paper: clip(r.paper, 80),
    cutOff: r.cut_off === true || r.cutOff === true,
    hardToRead: r.hard_to_read === true || r.hardToRead === true,
  };
}

// ---------------------------------------------------------------------------
// Titles and duplicates
// ---------------------------------------------------------------------------

/** "Avocado/Goat Cheese Dip (12)" and "avocado-goat cheese dip" compare equal */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/\bw\/\s*/g, "with ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an|my|grandmas?|moms?|recipe)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(s: string): string[] {
  return s.split(" ").filter(Boolean).map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
}

/** One typo apart ("chimichuri" / "chimichurri"); only for longer words */
function nearlySame(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 6 || b.length < 6 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return Math.max(a.length, b.length) - i - j <= 1;
}

/** Same recipe name? Exact after tidying (allowing a typo), or nearly all the same words */
export function titlesMatch(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const wa = words(na);
  const wb = words(nb);
  if (wa.length === wb.length && wa.every((w, i) => nearlySame(w, wb[i]))) return true;
  if (new Set(wa).size < 2 || new Set(wb).size < 2) return false;
  const ua = Array.from(new Set(wa));
  const ub = Array.from(new Set(wb));
  const shared = ua.filter((w) => ub.some((x) => nearlySame(w, x))).length;
  return shared / Math.max(ua.length, ub.length) >= 0.8;
}

/** Loose check that two first lines start the same recipe ("3 ripe avocados") */
export function linesOverlap(a: string, b: string): boolean {
  const wa = new Set(words(normalizeTitle(a)).filter((w) => w.length > 2 && !/^\d/.test(w)));
  const wb = new Set(words(normalizeTitle(b)).filter((w) => w.length > 2 && !/^\d/.test(w)));
  if (!wa.size || !wb.size) return true; // nothing to compare: don't call them different
  let shared = 0;
  wa.forEach((w) => { if (wb.has(w)) shared++; });
  return shared > 0;
}

// ---------------------------------------------------------------------------
// The plan the person reviews
// ---------------------------------------------------------------------------

export interface PlanPhoto {
  id: string;
  /** Order the photos were taken or listed in */
  seq: number;
  sourceHash: string;
  /** null until the first look is done (or if it failed) */
  catalog: PhotoCatalog | null;
  /** This photo is the back of that photo (set by the pairing step or by the person) */
  pairedTo: string | null;
  /** The person split this pair; don't pair it again */
  pairLocked: boolean;
  /** The person's include/exclude choice for the recipe this photo starts */
  includeOverride: boolean | null;
  recipeId?: string | null;
}

export interface ExistingRecipe {
  id: string;
  title: string;
  /** First ingredient, to tell two different "Spinach Dip"s apart */
  firstLine?: string;
}

export type GroupStatus =
  | "ready" // will be imported
  | "incomplete" // front says "over" and there's no back, or a back with no front
  | "existing" // already in the person's recipes
  | "duplicate" // the same recipe appears twice in this pile
  | "not_recipe"; // a dish photo, a blank or something else

export interface PlanGroup {
  /** Id of the first photo (the front); stable across plan rebuilds */
  key: string;
  photoIds: string[];
  title: string;
  status: GroupStatus;
  /** Plain-words reason for anything that isn't "ready" */
  reason: string;
  include: boolean;
  /** Notes that don't stop the import ("Part of the card may be cut off") */
  warnings: string[];
  duplicateOf?: string;
  existingRecipeId?: string;
  recipeId?: string | null;
}

export interface PlanSummary {
  photos: number;
  recipes: number;
  toImport: number;
  incomplete: number;
  existing: number;
  duplicates: number;
  notRecipes: number;
  /** Photos the first look couldn't read (they're imported as single recipes) */
  unchecked: number;
}

export interface Plan {
  groups: PlanGroup[];
  summary: PlanSummary;
}

const isRecipe = (p: PlanPhoto) => !p.catalog || p.catalog.kind === "recipe";

/**
 * Turns the photos (with their first-look answers and pairings) into
 * recipes to import. Deterministic: the same inputs always give the same
 * plan, so the person's choices can be stored as small overrides on photos.
 */
export function buildPlan(photos: PlanPhoto[], existing: ExistingRecipe[] = []): Plan {
  const byId = new Map(photos.map((p) => [p.id, p]));
  const ordered = [...photos].sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id));

  // Backs attach to their front (only one level deep; a back of a back
  // attaches to the same front)
  const frontOf = (p: PlanPhoto): PlanPhoto | null => {
    let cur = p;
    for (let i = 0; i < 5 && cur.pairedTo; i++) {
      const next = byId.get(cur.pairedTo);
      if (!next || next.id === p.id) break;
      cur = next;
    }
    return cur === p ? null : cur;
  };
  const backs = new Map<string, PlanPhoto[]>();
  const isBackPhoto = new Set<string>();
  for (const p of ordered) {
    const front = frontOf(p);
    if (front) {
      isBackPhoto.add(p.id);
      backs.set(front.id, [...(backs.get(front.id) ?? []), p]);
    }
  }

  const groups: PlanGroup[] = [];
  const seenHash = new Map<string, string>();
  for (const p of ordered) {
    if (isBackPhoto.has(p.id)) continue;
    const pages = [p, ...(backs.get(p.id) ?? [])];
    const c = p.catalog;
    const warnings: string[] = [];
    let status: GroupStatus = "ready";
    let reason = "";
    let duplicateOf: string | undefined;

    const title = c?.title || pages.map((x) => x.catalog?.title).find(Boolean) || "";
    if (!c) warnings.push("We couldn't check this photo first. It will be read like any other.");
    if (c?.cutOff) warnings.push("Part of the writing may be outside the photo.");
    if (c?.hardToRead) warnings.push("Some words were hard to read. Check this one after it's imported.");
    if (c && c.recipeCount > 1) warnings.push(`There are ${c.recipeCount} recipes on this card. Only the first will be imported.`);

    const firstSeen = seenHash.get(p.sourceHash);
    if (firstSeen) {
      status = "duplicate";
      duplicateOf = firstSeen;
      reason = "The same photo was added twice.";
    } else if (!isRecipe(p)) {
      status = "not_recipe";
      reason = c?.kind === "dish_photo" ? "A photo of food, not a recipe." : c?.kind === "blank" ? "Nothing written on it." : "This doesn't look like a recipe.";
    } else if (c && c.side === "back" && !c.title && pages.length === 1) {
      status = "incomplete";
      reason = "This looks like the back of a card. We couldn't find its front.";
    } else if (pages.length === 1 && c?.continues) {
      status = "incomplete";
      reason = "The card says it continues on the back, but we couldn't find a photo of the back.";
    }
    seenHash.set(p.sourceHash, p.id);

    groups.push({
      key: p.id,
      photoIds: pages.map((x) => x.id),
      title,
      status,
      reason,
      include: false,
      warnings,
      duplicateOf,
      recipeId: p.recipeId ?? null,
    });
  }

  // Already in the cookbook (title match against the person's own recipes)
  for (const g of groups) {
    if (g.status === "not_recipe" || g.status === "duplicate" || !g.title) continue;
    const first = byId.get(g.key)?.catalog?.firstLine ?? "";
    const match = existing.find((r) => titlesMatch(r.title, g.title) && linesOverlap(r.firstLine ?? "", first));
    if (match) {
      g.status = "existing";
      g.existingRecipeId = match.id;
      g.reason = `"${match.title}" is already in your recipes.`;
    }
  }

  // The same recipe twice in this pile: keep the more complete copy
  const score = (g: PlanGroup) => (g.status === "ready" ? 10 : 0) + g.photoIds.length * 2 - g.warnings.length;
  const candidates = groups.filter((g) => g.title && (g.status === "ready" || g.status === "incomplete"));
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    if (a.status === "duplicate") continue;
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      if (b.status === "duplicate" || !titlesMatch(a.title, b.title)) continue;
      const la = byId.get(a.key)?.catalog?.firstLine ?? "";
      const lb = byId.get(b.key)?.catalog?.firstLine ?? "";
      if (!linesOverlap(la, lb)) continue;
      const [keep, drop] = score(b) > score(a) ? [b, a] : [a, b];
      drop.status = "duplicate";
      drop.duplicateOf = keep.key;
      drop.reason = "The same recipe is in this pile twice. We'll keep the other copy.";
      if (drop === a) break;
    }
  }

  for (const g of groups) {
    const override = byId.get(g.key)?.includeOverride;
    g.include = override ?? g.status === "ready";
  }

  const summary: PlanSummary = {
    photos: photos.length,
    recipes: groups.filter((g) => g.status !== "not_recipe" && g.status !== "duplicate").length,
    toImport: groups.filter((g) => g.include && !g.recipeId).length,
    incomplete: groups.filter((g) => g.status === "incomplete").length,
    existing: groups.filter((g) => g.status === "existing").length,
    duplicates: groups.filter((g) => g.status === "duplicate").length,
    notRecipes: groups.filter((g) => g.status === "not_recipe").length,
    unchecked: photos.filter((p) => !p.catalog).length,
  };
  return { groups, summary };
}

// ---------------------------------------------------------------------------
// Pairing fronts with backs
// ---------------------------------------------------------------------------

export interface PairCandidate {
  id: string;
  seq: number;
  catalog: PhotoCatalog;
}

/**
 * Fronts that may have a back; photos that look like backs (no title); and
 * other titled cards, which a front can name as its back ("b'milk, sour cr.
 * subs over" -> the "Buttermilk" card).
 */
export function pairingCandidates(photos: PairCandidate[]): { fronts: PairCandidate[]; backs: PairCandidate[]; others: PairCandidate[] } {
  const recipes = photos.filter((p) => p.catalog.kind === "recipe");
  const backs = recipes.filter((p) => p.catalog.side === "back" && !p.catalog.title);
  const fronts = recipes.filter((p) => p.catalog.title && (p.catalog.continues || !p.catalog.hasDirections));
  const frontIds = new Set(fronts.map((f) => f.id));
  const others = fronts.some((f) => f.catalog.continues) ? recipes.filter((p) => p.catalog.title && !frontIds.has(p.id)) : [];
  return { fronts, backs, others };
}

/**
 * Pairs that need no AI: when photos were taken in order (real capture
 * times), a back that comes straight after a front that continues is its
 * back. Returns back id -> front id.
 */
export function pairBySequence(photos: PairCandidate[], orderIsReliable: boolean): Map<string, string> {
  const out = new Map<string, string>();
  if (!orderIsReliable) return out;
  const ordered = [...photos].sort((a, b) => a.seq - b.seq);
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    if (cur.catalog.kind !== "recipe" || cur.catalog.side !== "back" || cur.catalog.title) continue;
    if (prev.catalog.kind === "recipe" && prev.catalog.side === "front" && (prev.catalog.continues || !prev.catalog.hasDirections) && !out.has(cur.id)) {
      out.set(cur.id, prev.id);
    }
  }
  return out;
}

/** Validates the pairing model's answer: each back and each front used once, ids must exist */
export function sanitizePairs(raw: unknown, fronts: Set<string>, backs: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  const usedFronts = new Set<string>();
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.pairs) ? (raw as any).pairs : [];
  for (const item of list) {
    const front = String(item?.front ?? "");
    const back = String(item?.back ?? "");
    if (!fronts.has(front) || !backs.has(back) || front === back) continue;
    if (out.has(back) || usedFronts.has(front)) continue;
    out.set(back, front);
    usedFronts.add(front);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Limits and estimates
// ---------------------------------------------------------------------------

export interface BulkLimits {
  /** Photos in one pile */
  maxPhotosPerBatch: number;
  /** Photos looked at per person per 30 days (the cheap first look) */
  maxPhotosPerMonth: number;
  /** Piles not yet imported or cancelled, per person */
  maxOpenBatches: number;
  /** Recipes imported from piles per person per day */
  maxImportsPerDay: number;
  /** Above this many recipes, the Import button needs one more tick to confirm */
  confirmAbove: number;
  /** Largest single photo accepted after the browser shrinks it (bytes) */
  maxPhotoBytes: number;
}

export const DEFAULT_BULK_LIMITS: BulkLimits = {
  maxPhotosPerBatch: 600,
  maxPhotosPerMonth: 2000,
  maxOpenBatches: 3,
  maxImportsPerDay: 1000,
  confirmAbove: 100,
  maxPhotoBytes: 15 * 1024 * 1024,
};

/**
 * Rough costs in US dollars, from Gemini list prices (October 2026) and
 * measured token counts. Re-measure with scripts/bench-bulk-intake.ts when
 * models change.
 *  - firstLook: one gemini-3.1-flash-lite call per photo (four-way 448px
 *    strip: 1,587 input + ~130 output tokens, measured $0.00057 a photo on
 *    37 real cards; gemini-2.5-flash-lite is cheaper but closed to new keys)
 *  - pairing: one text call per pile ($0.0007 for 37 photos)
 *  - recipe: reading the card (gemini-3.6-flash) + enrichment
 *    (gemini-3.5-flash-lite, several calls) + one dish photo
 *    (gemini-3.1-flash-image, ~$0.067 of the total). An estimate, not measured.
 */
export const COST = {
  firstLookPerPhoto: 0.0006,
  pairingPerBatch: 0.003,
  recipeStandard: 0.09,
  /**
   * The batch lane sends the dish photo (on the cheaper bulk photo model,
   * ~1.7¢) and the tips/pairings to the Gemini Batch API at half price;
   * reading the card and the core details still run right away
   */
  recipeBatch: 0.036,
};

export type ImportLane = "standard" | "batch";

export interface Estimate {
  dollars: number;
  minutes: number;
  /** "about 6¢" / "about $8" */
  costText: string;
  /** "about 4 minutes" / "a few hours" */
  timeText: string;
}

export function formatDollars(d: number): string {
  if (d < 0.01) return "less than 1¢";
  if (d < 1) return `about ${Math.max(1, Math.round(d * 100))}¢`;
  if (d < 10) {
    // To the nearest 50¢: "about $1.50", "about $3"
    const r = Math.max(1, Math.round(d * 2) / 2);
    return `about $${r % 1 ? r.toFixed(2) : r}`;
  }
  return `about $${Math.round(d)}`;
}

export function formatMinutes(m: number): string {
  if (m < 1.5) return "about a minute";
  if (m < 60) return `about ${Math.round(m)} minutes`;
  const h = m / 60;
  return h < 1.5 ? "about an hour" : h <= 24 ? `about ${Math.round(h)} hours` : "about a day";
}

/** The first look at every photo (runs while photos upload) */
export function estimateFirstLook(photos: number): Estimate {
  const dollars = photos * COST.firstLookPerPhoto + COST.pairingPerBatch;
  // 8 at a time, ~3s each
  const minutes = Math.max(0.5, (photos / 8) * 3 / 60);
  return { dollars, minutes, costText: formatDollars(dollars), timeText: formatMinutes(minutes) };
}

/** Reading and finishing the recipes the person chose */
export function estimateImport(recipes: number, lane: ImportLane = "standard"): Estimate {
  const dollars = recipes * (lane === "batch" ? COST.recipeBatch : COST.recipeStandard);
  // The queue finishes ~20 cards in ~30s with everything, but bulk imports
  // are fed in a few at a time so single uploads stay quick
  // (server/bulk-intake/worker.ts), ~4s per recipe. With the batch lane, dish
  // photos follow later: the Batch API usually returns within a few hours.
  const minutes = Math.max(1, (recipes * 4) / 60);
  const timeText = formatMinutes(minutes) + (lane === "batch" ? " (photos of each dish can take a few hours more)" : "");
  return { dollars, minutes, costText: formatDollars(dollars), timeText };
}

// ---------------------------------------------------------------------------
// Status words for the screen
// ---------------------------------------------------------------------------

export type IntakeStatus = "uploading" | "pairing" | "review" | "importing" | "done" | "cancelled";

export interface IntakeProgress {
  uploaded: number;
  expected: number | null;
  checked: number;
  failed: number;
}

/** "Checking your photos: 120 of 231" */
export function progressText(status: IntakeStatus, p: IntakeProgress): string {
  if (status === "uploading") {
    const total = p.expected ?? p.uploaded;
    if (p.expected !== null && p.uploaded < p.expected) return `Uploading photos: ${p.uploaded} of ${p.expected}`;
    return `Looking at your photos: ${Math.min(p.checked + p.failed, total)} of ${total}`;
  }
  if (status === "pairing") return "Matching fronts and backs…";
  return "";
}
