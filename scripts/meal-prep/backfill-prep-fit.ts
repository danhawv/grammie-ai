// Judges "good for meal prep" for every recipe (server/meal-prep/food/prep-fit.ts)
// and fills recipes.meal_prep_friendly / _keeps_days / _note. Needs
// migrations/2026-10-meal-prep-fit.sql. Pure code, no AI calls, no cost.
//   npx tsx scripts/meal-prep/backfill-prep-fit.ts            dry run (READ ONLY): counts + a sample
//   npx tsx scripts/meal-prep/backfill-prep-fit.ts --write    saves the judgement (updated_at is left alone)
//   ... [--limit 50] [--ids id1,id2] [--only-unjudged] [--show 40]
// Recipes still being extracted or enriched are skipped (the app judges them when enrichment finishes).
import fs from "fs";
import pg from "pg";
import { seedCatalog } from "../../server/meal-prep/food/catalog";
import { mealPrepFit } from "../../server/meal-prep/food/prep-fit";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const write = process.argv.includes("--write");
const onlyUnjudged = process.argv.includes("--only-unjudged");
const limit = arg("limit") ? Number(arg("limit")) : undefined;
const show = arg("show") ? Number(arg("show")) : 30;
if (fs.existsSync(".env")) process.loadEnvFile(".env");
const url = process.env.DATABASE_URL!;
const ssl = /sslmode=disable|railway\.internal|localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false };
const client = new pg.Client({ connectionString: url.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, ""), ssl });
await client.connect();
const BATCH = 200;
try {
  // A dry run can't write anything: every statement runs in a READ ONLY transaction
  await client.query(write ? "BEGIN" : "BEGIN READ ONLY");
  const { rows: [{ migrated }] } = await client.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'recipes' AND column_name = 'meal_prep_friendly') AS migrated`);
  if (!migrated && (write || onlyUnjudged)) throw new Error("Apply migrations/2026-10-meal-prep-fit.sql first (a dry run works without it).");
  const where = [
    arg("ids") ? `id = ANY($1::varchar[])` : "true",
    onlyUnjudged ? "meal_prep_friendly IS NULL" : "true",
  ].join(" AND ");
  const params = arg("ids") ? [arg("ids")!.split(",")] : [];
  const { rows: all } = await client.query(
    `SELECT id FROM recipes WHERE ${where} ORDER BY created_at ${limit ? `LIMIT ${limit}` : ""}`, params);
  const ids: string[] = all.map((r) => r.id);
  const catalog = seedCatalog();
  const counts = { friendly: 0, not: 0, skipped: 0, written: 0 };
  const sample: string[] = [];
  const t0 = Date.now();
  for (let i = 0; i < ids.length; i += BATCH) {
    const { rows } = await client.query(
      `SELECT id, title, normalized_ingredients, meal_type, cooking_methods, tips, enrichment_status, ${migrated ? "meal_prep_friendly" : "NULL AS meal_prep_friendly"}
       FROM recipes WHERE id = ANY($1::varchar[]) ORDER BY created_at`, [ids.slice(i, i + BATCH)]);
    for (const r of rows) {
      if (r.enrichment_status === "extracting" || r.enrichment_status === "enriching") { counts.skipped++; continue; }
      const fit = mealPrepFit({
        title: r.title, normalizedIngredients: Array.isArray(r.normalized_ingredients) ? r.normalized_ingredients : null,
        mealType: r.meal_type, cookingMethods: r.cooking_methods, tips: Array.isArray(r.tips) ? r.tips : null,
      }, catalog);
      counts[fit.friendly ? "friendly" : "not"]++;
      const changed = r.meal_prep_friendly !== fit.friendly ? (r.meal_prep_friendly == null ? "new" : "changed") : "same";
      if (sample.length < show) sample.push(`  ${fit.friendly ? "YES" : " no"} ${String(r.title).slice(0, 48).padEnd(48)} ${fit.note}${changed === "same" ? "" : `  [${changed}]`}`);
      if (write) {
        await client.query(
          `UPDATE recipes SET meal_prep_friendly = $2, meal_prep_keeps_days = $3, meal_prep_note = $4 WHERE id = $1`,
          [r.id, fit.friendly, fit.keepsDays, fit.note]);
        counts.written++;
      }
    }
    console.log(`${Math.min(i + BATCH, ids.length)}/${ids.length} judged`);
  }
  console.log(`\n${sample.join("\n")}`);
  console.log(`\n${ids.length} recipes: ${counts.friendly} good for meal prep, ${counts.not} best eaten fresh, ${counts.skipped} skipped (still enriching). ${Math.round((Date.now() - t0) / 1000)}s.`);
  if (!write) console.log("Dry run: nothing written. Re-run with --write to save.");
  else console.log(`Saved ${counts.written} judgements.`);
  await client.query("COMMIT");
} catch (e) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw e;
} finally {
  await client.end();
}
