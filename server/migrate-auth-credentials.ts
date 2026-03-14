import { db } from "./db";
import { users, authCredentials } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Migrate existing Replit Auth users to auth_credentials table
 * This creates auth_credential records for all existing users
 */
async function migrateAuthCredentials() {
  console.log("🔄 Starting auth credentials migration...");
  
  try {
    // Get all users from the database
    const allUsers = await db.select().from(users);
    console.log(`📊 Found ${allUsers.length} users to migrate`);
    
    let migratedCount = 0;
    let skippedCount = 0;
    
    for (const user of allUsers) {
      // Check if this user already has an auth credential
      const existingCred = await db
        .select()
        .from(authCredentials)
        .where(eq(authCredentials.userId, user.id));
      
      if (existingCred.length > 0) {
        console.log(`⏭️  Skipping user ${user.id} - already has auth credentials`);
        skippedCount++;
        continue;
      }
      
      // Create auth_credential record for Replit Auth
      await db.insert(authCredentials).values({
        userId: user.id,
        provider: 'replit',
        providerUserId: user.id, // For Replit Auth, the user ID is the sub claim
        passwordHash: null, // No password for OAuth users
      });
      
      console.log(`✅ Migrated user ${user.id} (${user.email || 'no email'})`);
      migratedCount++;
    }
    
    console.log("\n🎉 Migration complete!");
    console.log(`   Migrated: ${migratedCount} users`);
    console.log(`   Skipped: ${skippedCount} users (already migrated)`);
    
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

// Run the migration
migrateAuthCredentials()
  .then(() => {
    console.log("✨ Migration script finished successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Migration script failed:", error);
    process.exit(1);
  });
