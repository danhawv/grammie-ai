import type { Recipe } from "./schema";

// schema.org Recipe data for public recipe pages. MyFitnessPal ("Add From
// Web") and Cronometer (recipe importer) read this from the page's HTML to
// import a recipe from its link, and search engines use it for rich results.
// server/routes/social.ts embeds it; everything here is pure so it can be
// tested without a server.

export type RecipeJsonLdSource = Pick<
  Recipe,
  | "id"
  | "title"
  | "description"
  | "prepTime"
  | "cookTime"
  | "totalTime"
  | "prepTimeMinutes"
  | "cookTimeMinutes"
  | "totalTimeMinutes"
  | "servings"
  | "yield"
  | "ingredients"
  | "normalizedIngredients"
  | "instructions"
  | "normalizedInstructions"
  | "cuisine"
  | "cuisines"
  | "mealType"
  | "dietType"
  | "cookingMethods"
  | "occasionTags"
  | "seasonTags"
  | "dishImage"
  | "dishImageThumbnail"
  | "dishImages"
  | "calories"
  | "protein"
  | "carbohydrates"
  | "fat"
  | "fiber"
  | "sugar"
  | "sodium"
  | "cholesterol"
  | "publishedAt"
  | "createdAt"
  | "updatedAt"
  | "socialSourceUrl"
>;

export interface RecipeJsonLdOptions {
  /** The public site, e.g. "https://grammie.ai" (no trailing slash needed) */
  baseUrl: string;
  /** The owner's name as shown on the site; "Grammie" when unknown */
  authorName?: string | null;
  /** Where the recipe was imported from (website or social post), if anywhere */
  sourceUrl?: string | null;
}

// ---------- Escaping ----------

/** Escapes text for an HTML attribute value or element body */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * JSON that is safe inside <script type="application/ld+json">: no "</script>",
 * "<!--" or U+2028/2029 can end the script early or break older parsers.
 * The output is still valid JSON with the same value.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** The full <script> tag for a JSON-LD object */
export function jsonLdScriptTag(value: unknown): string {
  return `<script type="application/ld+json">${jsonForScript(value)}</script>`;
}

// ---------- Small helpers ----------

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function isHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Minutes as an ISO 8601 duration: 90 -> "PT1H30M"; undefined when unknown */
export function minutesToIsoDuration(minutes: number | null | undefined): string | undefined {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return undefined;
  const total = Math.max(1, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `PT${hours ? `${hours}H` : ""}${mins ? `${mins}M` : ""}`;
}

/**
 * Minutes from a written time like "1 hour 30 minutes", "45 min", "1.5 hrs",
 * "1h30m" or a bare "20". Null when it can't tell.
 */
export function parseMinutes(text: string | null | undefined): number | null {
  const s = cleanText(text).toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  let total = 0;
  let found = false;
  const re = /(\d+(?:\.\d+)?)\s*(days?|hours?|hrs?|minutes?|mins?|[dhm])(?![a-z])/g;
  for (const m of Array.from(s.matchAll(re))) {
    const n = Number(m[1]);
    const unit = m[2];
    found = true;
    if (unit.startsWith("d")) total += n * 24 * 60;
    else if (unit.startsWith("h")) total += n * 60;
    else total += n;
  }
  return found && total > 0 ? Math.round(total) : null;
}

function minutesOf(minutes: number | null | undefined, text: string | null | undefined): number | null {
  if (minutes != null && Number.isFinite(minutes) && minutes > 0) return minutes;
  return parseMinutes(text);
}

/** Section labels like "For the sauce:" aren't ingredients */
function isSectionHeader(line: string): boolean {
  return /:$/.test(line) && !/\d/.test(line) && line.length <= 60;
}

/** One clean text line per ingredient, no bullets or headings */
export function ingredientLines(recipe: Pick<RecipeJsonLdSource, "ingredients" | "normalizedIngredients">): string[] {
  const raw = recipe.ingredients?.length
    ? recipe.ingredients
    : (recipe.normalizedIngredients ?? []).map((i) => i.raw || i.item);
  return raw
    .map((line) => cleanText(String(line ?? "")).replace(/^(?:[-*•·▢□◦‣–—]|\d+[.)](?=\s))\s*/, ""))
    .filter((line) => line && !isSectionHeader(line));
}

/** Step text in order, without "Step 1:" style prefixes */
export function instructionLines(recipe: Pick<RecipeJsonLdSource, "instructions" | "normalizedInstructions">): string[] {
  const steps = recipe.normalizedInstructions?.length
    ? [...recipe.normalizedInstructions].sort((a, b) => (a.stepNumber ?? 0) - (b.stepNumber ?? 0)).map((s) => s.text)
    : recipe.instructions ?? [];
  return steps
    .map((line) => cleanText(String(line ?? "")).replace(/^(?:step\s*\d+\s*[:.)-]?|\d+[.)])\s*/i, ""))
    .filter(Boolean);
}

/**
 * An absolute, crawlable photo URL. Photos stored as data: URLs go through
 * the /og-image/recipe/:id route; drawn placeholders (SVG) are skipped.
 */
export function recipeImageUrl(
  recipe: Pick<RecipeJsonLdSource, "id" | "dishImage" | "dishImageThumbnail" | "dishImages">,
  baseUrl: string,
): string | undefined {
  const base = trimBase(baseUrl);
  const firstExtra = [...(recipe.dishImages ?? [])].sort((a, b) => a.order - b.order)[0]?.url;
  for (const ref of [recipe.dishImage, firstExtra, recipe.dishImageThumbnail]) {
    if (!ref || ref.startsWith("data:image/svg")) continue;
    if (isHttpUrl(ref)) return ref;
    if (ref.startsWith("/") && !ref.startsWith("//")) return base + ref;
    if (/^data:image\/[a-z]+;base64,/i.test(ref)) return `${base}/og-image/recipe/${encodeURIComponent(recipe.id)}`;
  }
  return undefined;
}

function nutritionNumber(value: number | null | undefined, digits = 1): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** schema.org NutritionInformation per serving; undefined when nothing is known */
export function nutritionInfo(
  recipe: Pick<RecipeJsonLdSource, "calories" | "protein" | "carbohydrates" | "fat" | "fiber" | "sugar" | "sodium" | "cholesterol">,
): Record<string, string> | undefined {
  const parts: Array<[string, number | null, string]> = [
    ["calories", nutritionNumber(recipe.calories, 0), "calories"],
    ["proteinContent", nutritionNumber(recipe.protein), "g"],
    ["carbohydrateContent", nutritionNumber(recipe.carbohydrates), "g"],
    ["fatContent", nutritionNumber(recipe.fat), "g"],
    ["fiberContent", nutritionNumber(recipe.fiber), "g"],
    ["sugarContent", nutritionNumber(recipe.sugar), "g"],
    ["sodiumContent", nutritionNumber(recipe.sodium, 0), "mg"],
    ["cholesterolContent", nutritionNumber(recipe.cholesterol, 0), "mg"],
  ];
  const out: Record<string, string> = {};
  for (const [key, n, unit] of parts) {
    if (n != null) out[key] = `${n} ${unit}`;
  }
  if (!Object.keys(out).length) return undefined;
  return { "@type": "NutritionInformation", servingSize: "1 serving", ...out };
}

function uniqueList(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = cleanText(v);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

function isoDate(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

// ---------- The builder ----------

export function buildRecipeJsonLd(recipe: RecipeJsonLdSource, opts: RecipeJsonLdOptions): Record<string, unknown> {
  const base = trimBase(opts.baseUrl);
  const url = `${base}/recipe/${encodeURIComponent(recipe.id)}`;
  const title = cleanText(recipe.title) || "Recipe";

  const prep = minutesOf(recipe.prepTimeMinutes, recipe.prepTime);
  const cook = minutesOf(recipe.cookTimeMinutes, recipe.cookTime);
  const total = minutesOf(recipe.totalTimeMinutes, recipe.totalTime) ?? (prep || cook ? (prep ?? 0) + (cook ?? 0) : null);

  const servings = recipe.servings && recipe.servings > 0 ? recipe.servings : null;
  const yieldText = cleanText(recipe.yield);
  const recipeYield = servings ? `${servings} ${servings === 1 ? "serving" : "servings"}` : yieldText || undefined;

  const cuisines = uniqueList([...(recipe.cuisines ?? []), recipe.cuisine]);
  const categories = uniqueList(recipe.mealType ?? []);
  const keywords = uniqueList([
    ...(recipe.dietType ?? []),
    ...(recipe.cookingMethods ?? []),
    ...(recipe.occasionTags ?? []),
    ...(recipe.seasonTags ?? []),
  ]);

  const image = recipeImageUrl(recipe, base);
  const sourceUrl = [opts.sourceUrl, recipe.socialSourceUrl].find((u): u is string => isHttpUrl(u));
  const steps = instructionLines(recipe);

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: title,
    url,
    mainEntityOfPage: url,
    description: cleanText(recipe.description) || undefined,
    image: image ? [image] : undefined,
    author: { "@type": "Person", name: cleanText(opts.authorName) || "Grammie" },
    publisher: { "@type": "Organization", name: "Grammie", url: base },
    datePublished: isoDate(recipe.publishedAt ?? recipe.createdAt),
    dateModified: isoDate(recipe.updatedAt),
    prepTime: minutesToIsoDuration(prep),
    cookTime: minutesToIsoDuration(cook),
    totalTime: minutesToIsoDuration(total),
    recipeYield,
    recipeCategory: categories.length ? categories.join(", ") : undefined,
    recipeCuisine: cuisines.length ? cuisines.join(", ") : undefined,
    keywords: keywords.length ? keywords.join(", ") : undefined,
    recipeIngredient: ingredientLines(recipe),
    recipeInstructions: steps.length
      ? steps.map((text, i) => ({ "@type": "HowToStep", position: i + 1, text }))
      : undefined,
    nutrition: nutritionInfo(recipe),
    isBasedOn: sourceUrl,
  };

  // Leave out anything unknown rather than sending empty values
  for (const key of Object.keys(data)) {
    if (data[key] === undefined) delete data[key];
  }
  return data;
}
