import { db } from './db';
import { recipes } from '@shared/schema';
import { isNull, isNotNull, and } from 'drizzle-orm';
import { generateThumbnail } from './thumbnail';

/**
 * Migration script to generate thumbnails for all existing recipes
 * that have full images but no thumbnails
 */
async function migrateThumbnails() {
  console.log('🔄 Starting thumbnail migration...');
  
  try {
    // First, get just IDs and titles (small query to avoid 67MB limit)
    const recipeIds = await db
      .select({
        id: recipes.id,
        title: recipes.title,
      })
      .from(recipes)
      .where(and(
        isNotNull(recipes.dishImage),
        isNull(recipes.dishImageThumbnail)
      ));

    console.log(`📊 Found ${recipeIds.length} recipes needing thumbnails`);

    if (recipeIds.length === 0) {
      console.log('✅ All recipes already have thumbnails!');
      return;
    }

    let successCount = 0;
    let failCount = 0;

    // Process each recipe individually
    for (const recipeInfo of recipeIds) {
      try {
        console.log(`🖼️  Processing: ${recipeInfo.title} (${recipeInfo.id})`);
        
        // Fetch just this one recipe's full image
        const [recipe] = await db
          .select({ dishImage: recipes.dishImage })
          .from(recipes)
          .where(eq(recipes.id, recipeInfo.id));
        
        if (!recipe?.dishImage) {
          console.log(`   ⚠️  Skipping - no image found`);
          continue;
        }
        
        // Generate thumbnail from full image
        const thumbnail = await generateThumbnail(recipe.dishImage);
        
        // Update recipe with thumbnail
        await db
          .update(recipes)
          .set({ 
            dishImageThumbnail: thumbnail,
            updatedAt: new Date()
          })
          .where(eq(recipes.id, recipeInfo.id));
        
        successCount++;
        console.log(`   ✅ Success (${successCount}/${recipeIds.length})`);
      } catch (error) {
        failCount++;
        console.error(`   ❌ Failed for ${recipeInfo.title}:`, error instanceof Error ? error.message : String(error));
      }
    }

    console.log('\n📈 Migration complete!');
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Failed: ${failCount}`);
    console.log(`   📊 Total: ${recipeIds.length}`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Missing import
import { eq } from 'drizzle-orm';

// Run migration
migrateThumbnails()
  .then(() => {
    console.log('✅ Thumbnail migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Thumbnail migration failed:', error);
    process.exit(1);
  });
