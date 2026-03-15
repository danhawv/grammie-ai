import { neon } from "@neondatabase/serverless";

/**
 * Run startup migrations (idempotent CREATE INDEX IF NOT EXISTS statements).
 * Uses a raw neon() connection to execute SQL that Drizzle ORM doesn't support
 * natively (e.g., GIN indexes).
 */
export async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("[Migrations] DATABASE_URL not set, skipping migrations");
    return;
  }

  const sql = neon(connectionString);

  const ginIndexes = [
    `CREATE INDEX IF NOT EXISTS recipes_cuisines_gin ON recipes USING gin (cuisines)`,
    `CREATE INDEX IF NOT EXISTS recipes_meal_type_gin ON recipes USING gin (meal_type)`,
    `CREATE INDEX IF NOT EXISTS recipes_allergens_gin ON recipes USING gin (allergens)`,
    `CREATE INDEX IF NOT EXISTS recipes_cooking_methods_gin ON recipes USING gin (cooking_methods)`,
    `CREATE INDEX IF NOT EXISTS recipes_season_tags_gin ON recipes USING gin (season_tags)`,
    `CREATE INDEX IF NOT EXISTS recipes_time_convenience_tags_gin ON recipes USING gin (time_convenience_tags)`,
  ];

  console.log("[Migrations] Running GIN index migrations...");
  for (const statement of ginIndexes) {
    try {
      await sql(statement);
    } catch (err: any) {
      // Log but don't fail startup - indexes are performance optimizations
      console.warn(`[Migrations] Warning creating index: ${err.message}`);
    }
  }
  console.log("[Migrations] GIN index migrations complete.");
}
