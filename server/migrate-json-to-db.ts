/**
 * Migration script to import existing recipes from JSON file to PostgreSQL
 * Run once to migrate from JSON storage to database storage
 */

import { readFileSync, existsSync } from "fs";
import { db } from "./db";
import { users, recipes } from "@shared/schema";
import type { Recipe } from "@shared/schema";

const STORAGE_FILE = "recipes-data.json";
const SYSTEM_USER_ID = "system";

interface JsonStorageData {
  recipes: Record<string, Recipe>;
}

async function migrate() {
  console.log("🚀 Starting migration from JSON to PostgreSQL...\n");

  // Step 1: Check if JSON file exists
  if (!existsSync(STORAGE_FILE)) {
    console.log("❌ No recipes-data.json found. Nothing to migrate.");
    return;
  }

  // Step 2: Load JSON data
  console.log("📖 Reading recipes-data.json...");
  const fileContent = readFileSync(STORAGE_FILE, "utf8");
  const data: JsonStorageData = JSON.parse(fileContent);
  const recipesArray = Object.values(data.recipes);
  console.log(`✅ Found ${recipesArray.length} recipes to migrate\n`);

  if (recipesArray.length === 0) {
    console.log("❌ No recipes to migrate.");
    return;
  }

  // Step 3: Create system user
  console.log("👤 Creating system user...");
  try {
    const [systemUser] = await db
      .insert(users)
      .values({
        id: SYSTEM_USER_ID,
        email: "system@recipes.local",
        firstName: "System",
        lastName: "User",
        username: "system",
        bio: "Default owner for legacy recipes imported from JSON storage",
        defaultRecipeVisibility: "public",
        autoEnrichRecipes: true,
      })
      .onConflictDoNothing()
      .returning();

    if (systemUser) {
      console.log("✅ System user created");
    } else {
      console.log("✅ System user already exists");
    }
  } catch (error) {
    console.error("❌ Error creating system user:", error);
    throw error;
  }

  // Step 4: Migrate recipes
  console.log("\n📦 Migrating recipes...");
  let successCount = 0;
  let errorCount = 0;

  for (const recipe of recipesArray) {
    try {
      // Add ownership and visibility fields
      const recipeToInsert = {
        ...recipe,
        ownerUserId: SYSTEM_USER_ID,
        isPublic: true,
        forkCount: 0,
        // Convert createdAt from ISO string to Date if needed
        createdAt: recipe.createdAt ? new Date(recipe.createdAt) : new Date(),
        updatedAt: new Date(),
      };

      await db
        .insert(recipes)
        .values(recipeToInsert)
        .onConflictDoNothing(); // Skip if already exists

      successCount++;
      console.log(`  ✅ Migrated: ${recipe.title}`);
    } catch (error) {
      errorCount++;
      console.error(`  ❌ Failed to migrate: ${recipe.title}`, error);
    }
  }

  // Step 5: Summary
  console.log("\n📊 Migration Summary:");
  console.log(`  Total recipes: ${recipesArray.length}`);
  console.log(`  Successfully migrated: ${successCount}`);
  console.log(`  Errors: ${errorCount}`);

  if (errorCount === 0) {
    console.log("\n🎉 Migration completed successfully!");
    console.log(
      `\n💡 Tip: The original recipes-data.json file is preserved as a backup.`
    );
  } else {
    console.log("\n⚠️  Migration completed with errors. Please review the logs.");
  }
}

// Run migration if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("\n💥 Migration failed:", error);
      process.exit(1);
    });
}

export { migrate };
