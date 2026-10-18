// Recipes for the meal-prep scripts: read-only from DATABASE_URL (a READ ONLY
// transaction, so nothing can be written), or from a JSON snapshot of rows
// ({ recipes: [...] }) when a path is given.
import fs from "fs";
import pg from "pg";

export async function loadRecipeRows(snapshot?: string): Promise<any[]> {
  if (snapshot) return JSON.parse(fs.readFileSync(snapshot, "utf8")).recipes;
  if (!process.env.DATABASE_URL && fs.existsSync(".env")) process.loadEnvFile(".env");
  const url = process.env.DATABASE_URL!;
  const ssl = /sslmode=disable|railway\.internal|localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false };
  const client = new pg.Client({ connectionString: url.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, ""), ssl });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const { rows } = await client.query(`SELECT id, title, servings, ingredients, normalized_ingredients, meal_type, cuisines, cuisine,
      allergens, prep_time_minutes, cook_time_minutes, total_time_minutes, calories, protein, carbohydrates, fat, fiber, tips, variations,
      total_cost, cooking_methods, equipment, standard_equipment, specialized_equipment, normalized_instructions,
      owner_user_id, updated_at FROM recipes ORDER BY created_at`);
    await client.query("COMMIT");
    return rows;
  } finally {
    await client.end();
  }
}
