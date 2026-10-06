// Import speed test loop. Runs the real server pipeline functions (nothing
// is saved) and reports when each thing a person sees would appear:
//   spinner  - "Reading the post..." until the review page opens
//   review   - the review page shows the recipe (essential enrichment done)
//   photo    - the dish photo appears
//
//   npx tsx --env-file=.env scripts/bench-import.ts single [reps]
//   npx tsx --env-file=.env scripts/bench-import.ts batch [cards]
//
// Pipeline variants are switched with env vars so before/after can be
// compared in one session: PHOTO_EARLY=1 starts the photo as soon as the
// recipe is read instead of after enrichment; POLL_MS sets the review page's
// status poll (default 3000). Card photos are read from existing recipes
// (read-only).
import { neon } from "@neondatabase/serverless";

const { scrapePost } = await import("../server/social-import-service");
const { extractRecipeFromUrl, extractRecipeFromText } = await import("../server/enrichment");
const {
  extractRecipeFromSocialPostUnified,
  extractRecipeFromImageUnified,
  enrichRecipeEssential,
  generateMissingInstructions,
} = await import("../server/ai-service");
const { generateRecipeImageWithGemini } = await import("../server/gemini");

const POLL_MS = Number(process.env.POLL_MS ?? 3000);
const PHOTO_EARLY = process.env.PHOTO_EARLY === "1";

type Case = { name: string; kind: "web" | "social" | "text" | "card"; input: string };

const CASES: Case[] = [
  { name: "instagram", kind: "social", input: "https://www.instagram.com/p/DbpNUpFCnKO/" },
  { name: "instagram (no embed)", kind: "social", input: "https://www.instagram.com/p/DbYmVApitx1/" },
  { name: "tiktok", kind: "social", input: "https://www.tiktok.com/@derekkchen/video/7480603318859861291" },
  { name: "youtube", kind: "social", input: "https://www.youtube.com/watch?v=FSFTqzmuzy8" },
  { name: "web (recipe data)", kind: "web", input: "https://www.budgetbytes.com/one-pot-creamy-cajun-chicken-pasta/" },
  { name: "web (AI reads page)", kind: "web", input: "https://www.gutenberg.org/cache/epub/15464/pg15464-images.html" },
  {
    name: "pasted text",
    kind: "text",
    input: "Grandma's Buttermilk Biscuits\n2 cups flour\n1 tbsp baking powder\n1/2 tsp baking soda\n1 tsp salt\n6 tbsp cold butter\n3/4 cup buttermilk\nHeat oven to 450F. Whisk the dry ingredients, cut in the butter until it looks like coarse crumbs. Stir in the buttermilk just until it comes together. Pat to 1 inch thick, cut rounds, bake 12 to 14 minutes until golden.",
  },
];

async function cardCases(limit: number): Promise<Case[]> {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`SELECT title, handwritten_image FROM recipes WHERE handwritten_image LIKE 'data:image%' ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map((r: any) => ({ name: `card: ${String(r.title).slice(0, 18)}`, kind: "card" as const, input: String(r.handwritten_image).split(",")[1] }));
}

interface Timing {
  name: string;
  read: number; // until saved (spinner); for cards, until the photo is read
  instructions: number;
  enrich: number;
  review: number;
  photo: number;
  ingredients: number;
  normalized: number;
  steps: number;
  error?: string;
}

async function readCase(c: Case): Promise<any> {
  if (c.kind === "web") return extractRecipeFromUrl(c.input);
  if (c.kind === "text") return extractRecipeFromText(c.input, "pasted");
  if (c.kind === "card") return extractRecipeFromImageUnified(c.input);
  const scraped = await scrapePost(c.input);
  if (!scraped.success) throw new Error(scraped.error);
  const r = await extractRecipeFromSocialPostUnified(scraped.post!);
  if (!r) throw new Error("no recipe");
  return { title: r.title, ingredients: r.rawIngredients, instructions: r.rawInstructions, servings: r.servings, cuisine: r.cuisineType, mealType: r.mealType ? [r.mealType] : undefined };
}

function photo(raw: any, enriched?: any) {
  const gen = () =>
    generateRecipeImageWithGemini(raw.title, enriched?.cuisines || (raw.cuisine ? [raw.cuisine] : []), enriched?.cookingMethods || [], {
      mealType: enriched?.mealType || raw.mealType,
      skillLevel: enriched?.skillLevel,
    } as any);
  return gen().catch(gen); // the queue retries too
}

async function runOne(c: Case): Promise<Timing> {
  const t0 = Date.now();
  const at = () => Date.now() - t0;
  const t: Timing = { name: c.name, read: 0, instructions: 0, enrich: 0, review: 0, photo: 0, ingredients: 0, normalized: 0, steps: 0 };
  try {
    const raw = await readCase(c);
    t.read = at();
    t.ingredients = raw.ingredients?.length || 0;
    let photoDone: Promise<number> | null = PHOTO_EARLY ? photo(raw).then(at) : null;

    const s1 = Date.now();
    const gen = await generateMissingInstructions({ title: raw.title, ingredients: raw.ingredients, instructions: raw.instructions || [] }, false);
    if (gen.wasGenerated) raw.instructions = gen.instructions;
    t.instructions = Date.now() - s1;

    const s2 = Date.now();
    const enriched: any = (await enrichRecipeEssential(raw)).enrichedData;
    t.enrich = Date.now() - s2;
    t.normalized = enriched.normalizedIngredients?.length || 0;
    t.steps = enriched.normalizedInstructions?.length || 0;
    // The review page notices on its next status poll: on average half an interval later
    t.review = at() + POLL_MS / 2;

    if (!photoDone) photoDone = photo(raw, enriched).then(at);
    t.photo = (await photoDone) + POLL_MS / 2;
  } catch (err: any) {
    t.error = String(err?.message || err).slice(0, 80);
  }
  return t;
}

const sec = (ms: number) => (ms / 1000).toFixed(1).padStart(5);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
};

async function single(reps: number) {
  const cases = [...CASES, ...(await cardCases(2))];
  const all: Timing[] = [];
  for (let r = 0; r < reps; r++) {
    // One at a time, like a person adding a single recipe
    for (const c of cases) all.push(await runOne(c));
  }
  console.log(`\nSINGLE  poll=${POLL_MS}ms photoEarly=${PHOTO_EARLY} reps=${reps}  (medians, seconds)`);
  console.log(`${"case".padEnd(22)} spinner  instr  enrich  REVIEW  PHOTO  ingredients  steps`);
  for (const c of cases) {
    const rows = all.filter((x) => x.name === c.name && !x.error);
    const errs = all.filter((x) => x.name === c.name && x.error);
    if (!rows.length) {
      console.log(`${c.name.padEnd(22)} FAILED: ${errs[0]?.error}`);
      continue;
    }
    const m = (k: keyof Timing) => median(rows.map((x) => x[k] as number));
    const lost = rows.some((x) => x.normalized !== x.ingredients) ? " (some lost!)" : "";
    console.log(
      `${c.name.padEnd(22)} ${sec(m("read"))}  ${sec(m("instructions"))}  ${sec(m("enrich"))}  ${sec(m("review"))}  ${sec(m("photo"))}  ${String(m("normalized")).padStart(4)}/${m("ingredients")}${lost}  ${m("steps")}${errs.length ? `  [${errs.length} failed: ${errs[0].error}]` : ""}`
    );
  }
  const ok = all.filter((x) => !x.error);
  console.log(`ALL CASES median: review ${sec(median(ok.map((x) => x.review)))}s, photo ${sec(median(ok.map((x) => x.photo)))}s, failures ${all.length - ok.length}/${all.length}`);
}

// Batch: N recipe cards at once through pools the size of the job queue's
async function batch(n: number) {
  const textWorkers = Number(process.env.QUEUE_TEXT_WORKERS) || 10;
  const imageWorkers = Number(process.env.QUEUE_IMAGE_WORKERS) || 8;
  const cards = await cardCases(3);
  const jobs = Array.from({ length: n }, (_, i) => cards[i % cards.length]);
  const t0 = Date.now();
  const pool = (size: number) => {
    let active = 0;
    const waiting: (() => void)[] = [];
    return async <T>(fn: () => Promise<T>): Promise<T> => {
      if (active >= size) await new Promise<void>((r) => waiting.push(r));
      active++;
      try {
        return await fn();
      } finally {
        active--;
        waiting.shift()?.();
      }
    };
  };
  const text = pool(textWorkers);
  const image = pool(imageWorkers);
  const usable: number[] = [];
  const photos: number[] = [];
  let failed = 0;
  await Promise.all(
    jobs.map(async (c) => {
      try {
        const raw = await text(() => readCase(c));
        const photoP = PHOTO_EARLY ? image(() => photo(raw)).then(() => photos.push(Date.now() - t0)) : null;
        const enriched: any = (await text(() => enrichRecipeEssential(raw))).enrichedData;
        usable.push(Date.now() - t0);
        await (photoP ?? image(() => photo(raw, enriched)).then(() => photos.push(Date.now() - t0)));
      } catch {
        failed++;
      }
    })
  );
  usable.sort((a, b) => a - b);
  photos.sort((a, b) => a - b);
  console.log(
    `\nBATCH ${n} cards (text ${textWorkers}, image ${imageWorkers}, photoEarly=${PHOTO_EARLY}): first usable ${sec(usable[0] ?? 0)}s | all usable ${sec(usable.at(-1) ?? 0)}s | all photos ${sec(photos.at(-1) ?? 0)}s | failed ${failed}`
  );
}

const [mode, arg] = process.argv.slice(2);
if (mode === "batch") await batch(Number(arg) || 20);
else await single(Number(arg) || 1);
process.exit(0);
