/**
 * Migrate base64 images out of the database into the configured media storage.
 *
 * Usage:
 *   MEDIA_STORAGE=disk npx tsx scripts/migrate-media.ts --confirm
 *
 * ⚠️  READ BEFORE RUNNING
 * This rewrites image columns to URLs served by THIS machine's media storage.
 * If the database is shared with a deployed instance (e.g. Replit) that does
 * not have access to the same storage, images will break there. Run only when:
 *   - storage is shared object storage (S3/R2) reachable by every deployment, or
 *   - this machine is the only thing serving the app.
 *
 * The script is resumable: already-migrated values (non-data: URLs) are skipped.
 */
import { db } from '../server/db';
import { recipes, customTemplates } from '../shared/schema';
import { eq, isNotNull, like } from 'drizzle-orm';
import { getMediaStorage } from '../server/lib/media-storage';

function parseDataUrl(dataUrl: string): { contentType: string; buffer: Buffer } | null {
  const m = dataUrl.match(/^data:([^;,]+);base64,(.*)$/s);
  if (!m) return null;
  return { contentType: m[1], buffer: Buffer.from(m[2], 'base64') };
}

async function main() {
  if (!process.argv.includes('--confirm')) {
    console.error('Refusing to run without --confirm. Read the warning at the top of this script first.');
    process.exit(1);
  }
  const media = getMediaStorage();
  if (!media) {
    console.error('MEDIA_STORAGE is not configured (set MEDIA_STORAGE=disk).');
    process.exit(1);
  }
  console.log(`Migrating base64 images to '${media.driver}' storage...`);

  // --- Recipes: one row at a time (rows are multi-MB) ---
  const recipeImageColumns = ['dishImage', 'dishImageThumbnail', 'dishImagePrint', 'handwrittenImage'] as const;
  const ids = await db.select({ id: recipes.id }).from(recipes);
  let migratedRecipes = 0;

  for (const { id } of ids) {
    const [row] = await db.select({
      dishImage: recipes.dishImage,
      dishImageThumbnail: recipes.dishImageThumbnail,
      dishImagePrint: recipes.dishImagePrint,
      handwrittenImage: recipes.handwrittenImage,
    }).from(recipes).where(eq(recipes.id, id));
    if (!row) continue;

    const updates: Record<string, string> = {};
    for (const col of recipeImageColumns) {
      const val = row[col];
      if (!val || !val.startsWith('data:')) continue;
      const parsed = parseDataUrl(val);
      if (!parsed) continue;
      const { url } = await media.put(parsed.buffer, { contentType: parsed.contentType, keyHint: `recipe-${col}` });
      updates[col] = url;
    }
    if (Object.keys(updates).length > 0) {
      await db.update(recipes).set(updates).where(eq(recipes.id, id));
      migratedRecipes++;
      if (migratedRecipes % 25 === 0) console.log(`  ...${migratedRecipes} recipes migrated`);
    }
  }
  console.log(`Recipes migrated: ${migratedRecipes}`);

  // --- Custom templates ---
  const templates = await db.select().from(customTemplates);
  let migratedTemplates = 0;
  for (const tpl of templates) {
    let changed = false;
    const updates: Record<string, unknown> = {};

    if (tpl.backgroundImage?.startsWith('data:')) {
      const parsed = parseDataUrl(tpl.backgroundImage);
      if (parsed) {
        updates.backgroundImage = (await media.put(parsed.buffer, { contentType: parsed.contentType, keyHint: 'template-bg' })).url;
        changed = true;
      }
    }

    const data = tpl.templateData as any;
    if (data?.cover?.coverImage?.startsWith?.('data:')) {
      const parsed = parseDataUrl(data.cover.coverImage);
      if (parsed) {
        data.cover.coverImage = (await media.put(parsed.buffer, { contentType: parsed.contentType, keyHint: 'template-cover' })).url;
        updates.templateData = data;
        changed = true;
      }
    }

    const fonts = tpl.customFonts as { dataUrl?: string; format?: string }[] | null;
    if (Array.isArray(fonts) && fonts.some(f => f.dataUrl?.startsWith('data:'))) {
      for (const f of fonts) {
        if (!f.dataUrl?.startsWith('data:')) continue;
        const parsed = parseDataUrl(f.dataUrl);
        if (parsed) f.dataUrl = (await media.put(parsed.buffer, { contentType: parsed.contentType, keyHint: 'template-font' })).url;
      }
      updates.customFonts = fonts;
      changed = true;
    }

    if (changed) {
      await db.update(customTemplates).set(updates).where(eq(customTemplates.id, tpl.id));
      migratedTemplates++;
    }
  }
  console.log(`Templates migrated: ${migratedTemplates}`);
  console.log('Done. Database rows now reference media URLs instead of inline base64.');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
