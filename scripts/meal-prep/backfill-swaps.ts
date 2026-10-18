// Fills meal_prep_recipe_swaps (ingredient swaps per recipe) for recipes that
// have none for their current version. Needs migrations/2026-10-meal-prep-swaps.sql.
//   npx tsx scripts/meal-prep/backfill-swaps.ts                 dry run (READ ONLY): counts + cost estimate
//   npx tsx scripts/meal-prep/backfill-swaps.ts --write         one Gemini call per missing recipe, 4 at a time
//   ... [--limit 50] [--ids id1,id2]
// Measured cost: ~$0.0004 per recipe (gemini-3.5-flash-lite), so ~$0.30 for 700 recipes.
import fs from "fs";
import pg from "pg";
import { ensureSwaps } from "../../server/meal-prep/food/index";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const write = process.argv.includes("--write");
if (fs.existsSync(".env")) process.loadEnvFile(".env");
const url = process.env.DATABASE_URL!;
const ssl = /sslmode=disable|railway\.internal|localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false };
const client = new pg.Client({ connectionString: url.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, ""), ssl });
await client.connect();
try {
  // A dry run can't write anything: every statement runs in a READ ONLY transaction
  if (!write) await client.query("BEGIN READ ONLY");
  const query = (sql: string, params?: unknown[]) => client.query(sql, params as any[]);
  const ids = arg("ids")?.split(",") ?? (await query(`SELECT id FROM recipes WHERE jsonb_typeof(normalized_ingredients) = 'array' ORDER BY created_at`)).rows.map((r) => r.id);
  const t0 = Date.now();
  const res = await ensureSwaps(ids, {
    query, write, limit: arg("limit") ? Number(arg("limit")) : undefined, concurrency: 4,
    onProgress(done, total, f, swaps) {
      console.log(`${String(done).padStart(4)}/${total} ${f.title.slice(0, 50).padEnd(50)} ${swaps.map((s) => `${s.title} (${s.perServingDelta.protein >= 0 ? "+" : ""}${s.perServingDelta.protein} g, ${s.perServingDelta.kcal >= 0 ? "+" : ""}${s.perServingDelta.kcal} kcal)`).join("; ") || "-"}`);
    },
  });
  console.log(`\n${res.checked} recipes checked, ${res.missing.length} without swaps for their current version.`);
  if (!write) console.log(`Dry run: nothing called or written. Estimated cost to fill them: ~$${(res.estimatedCostMicros / 1e6).toFixed(2)}. Re-run with --write.`);
  else console.log(`Filled ${res.filled} (${res.swaps} swaps), ${res.failed.length} failed, cost $${(res.costMicros / 1e6).toFixed(4)}, ${Math.round((Date.now() - t0) / 1000)}s.`);
  for (const f of res.failed.slice(0, 20)) console.log(`  failed ${f.recipeId}: ${f.error}`);
  if (!write) await client.query("COMMIT");
} finally {
  await client.end();
}
