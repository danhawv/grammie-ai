// Times the whole import pipeline (read, extract, enrich, photo) for each
// link type. Compare models with the GEMINI_MODEL_<JOB> overrides, e.g.
//   GEMINI_MODEL_ENRICHCORE=gemini-3.8-flash:low LABEL=try npx tsx --env-file=.env scripts/bench-models.ts
// Calls the AI for real (about 5 images per run) but saves nothing.
const { scrapePost } = await import("../server/social-import-service");
const { extractRecipeFromUrl } = await import("../server/enrichment");
const { extractRecipeFromSocialPostUnified, enrichRecipeEssential } = await import("../server/ai-service");
const { generateRecipeImageWithGemini } = await import("../server/gemini");
const links = [["web", "https://www.budgetbytes.com/one-pot-creamy-cajun-chicken-pasta/"], ["web (AI read)", "https://www.gutenberg.org/cache/epub/15464/pg15464-images.html"], ["instagram", "https://www.instagram.com/reel/Dd6ZrQNhv3t/"], ["tiktok", "https://www.tiktok.com/@derekkchen/video/7480603318859861291"], ["youtube", "https://www.youtube.com/watch?v=FSFTqzmuzy8"]];
for (const [name, url] of links) {
  const t0 = Date.now(); let raw: any;
  if (name.startsWith("web")) raw = await extractRecipeFromUrl(url);
  else { const sc = await scrapePost(url); const r = await extractRecipeFromSocialPostUnified(sc.post!); raw = { title: r!.title, ingredients: r!.rawIngredients, instructions: r!.rawInstructions, servings: r!.servings }; }
  const t1 = Date.now();
  const e: any = await enrichRecipeEssential(raw);
  const t2 = Date.now();
  await generateRecipeImageWithGemini(raw.title, e.enrichedData.cuisines || [], e.enrichedData.cookingMethods || [], { mealType: e.enrichedData.mealType, skillLevel: e.enrichedData.skillLevel } as any);
  const t3 = Date.now();
  console.log(`PIPE ${process.env.LABEL} ${name.padEnd(14)} saved ${((t1-t0)/1000).toFixed(1)}s | details ${((t2-t1)/1000).toFixed(1)}s | photo ${((t3-t2)/1000).toFixed(1)}s | total ${((t3-t0)/1000).toFixed(1)}s`);
}
process.exit(0);
