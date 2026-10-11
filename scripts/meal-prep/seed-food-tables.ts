// Loads the committed food-data seeds (server/meal-prep/food/data/*.json)
// into the tables from migrations/2026-10-meal-prep-food.sql. Upserts, so it's
// safe to re-run after editing a seed. WRITES to DATABASE_URL: run it only
// when the migration has been applied and you mean to.
//   npx tsx scripts/meal-prep/seed-food-tables.ts --yes
import fs from "fs";
import pg from "pg";
import ingredients from "../../server/meal-prep/food/data/ingredients.json";
import itemMap from "../../server/meal-prep/food/data/item-map.json";
import packages from "../../server/meal-prep/food/data/packages.json";

if (!process.argv.includes("--yes")) {
  console.log("This writes the food-data seeds to the database in DATABASE_URL. Re-run with --yes to go ahead.");
  process.exit(0);
}
if (!process.env.DATABASE_URL && fs.existsSync(".env")) process.loadEnvFile(".env");
const url = process.env.DATABASE_URL!;
const ssl = /sslmode=disable|railway\.internal|localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false };
const client = new pg.Client({ connectionString: url.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, ""), ssl });
await client.connect();
try {
  await client.query("BEGIN");
  for (const i of ingredients as any[]) {
    await client.query(
      `INSERT INTO meal_prep_ingredients (id, name, aisle, fdc_id, usda_description, source, kcal, protein, carbs, fat, fiber,
         cup_grams, portions, pack_grams, allergens, protein_kind, cooked, aliases, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, now())
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, aisle=EXCLUDED.aisle, fdc_id=EXCLUDED.fdc_id,
         usda_description=EXCLUDED.usda_description, source=EXCLUDED.source, kcal=EXCLUDED.kcal, protein=EXCLUDED.protein,
         carbs=EXCLUDED.carbs, fat=EXCLUDED.fat, fiber=EXCLUDED.fiber, cup_grams=EXCLUDED.cup_grams, portions=EXCLUDED.portions,
         pack_grams=EXCLUDED.pack_grams, allergens=EXCLUDED.allergens, protein_kind=EXCLUDED.protein_kind, cooked=EXCLUDED.cooked,
         aliases=EXCLUDED.aliases, updated_at=now()`,
      [i.id, i.name, i.aisle, i.fdcId, i.usdaDescription, i.source, i.per100g.kcal, i.per100g.protein, i.per100g.carbs,
        i.per100g.fat, i.per100g.fiber, i.cup, JSON.stringify(i.portions), i.pack, i.allergens, i.protein, i.cooked, i.aliases]);
  }
  // Reviewed rows (edited by hand in SQL) are left alone
  for (const e of itemMap as any[]) {
    await client.query(
      `INSERT INTO meal_prep_item_map (item, ingredient_id, confidence, method) VALUES ($1,$2,$3,$4)
       ON CONFLICT (item) DO UPDATE SET ingredient_id=EXCLUDED.ingredient_id, confidence=EXCLUDED.confidence,
         method=EXCLUDED.method, updated_at=now() WHERE NOT meal_prep_item_map.reviewed`,
      [e.item, e.id, e.confidence, e.method]);
  }
  for (const [id, list] of Object.entries(packages as Record<string, Array<[string, number]>>)) {
    for (const [label, grams] of list) {
      await client.query(
        `INSERT INTO meal_prep_package_sizes (ingredient_id, label, grams) VALUES ($1,$2,$3)
         ON CONFLICT (ingredient_id, label) DO UPDATE SET grams=EXCLUDED.grams`, [id, label, grams]);
    }
  }
  await client.query("COMMIT");
  console.log(`Seeded ${ingredients.length} ingredients, ${itemMap.length} item names, ${Object.keys(packages).length} ingredients' package sizes.`);
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  await client.end();
}
