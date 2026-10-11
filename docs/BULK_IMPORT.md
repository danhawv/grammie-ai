# Bringing in a whole box of recipes (bulk intake)

For handing over a big pile of recipes at once: hundreds of photos of recipe
cards from a folder, a .zip or Google Drive. It grew out of the October 2026
import of 231 photos of Grandma's cards, which was done by hand with scripts.
Those steps are now the product.

Page: `/import` (linked from Add → Photo → "Add several recipes at once").

## The flow

1. **Choose.** Drop a folder, a .zip or lots of photos, or choose them (phones
   pick from the photo library), or use Google Drive when it's set up.
   PDFs are left out with a note (see "Not done yet").
2. **Upload** (`client/src/lib/bulk-upload.ts`). Each photo is shrunk to
   2400px in the browser (a 4 MB phone photo becomes ~600 KB) and sent on its
   own, 4 at a time. Failures are retried with growing waits (1s to 16s, 6
   tries). Each photo's id is the SHA-256 of the original file, and the server
   ignores photos it already has. So after a dropped connection or a closed
   tab, the person picks the same folder again and only the missing ones go.
   .zip files are opened in the browser, so nothing big is sent in one piece.
3. **First look** (`server/bulk-intake/worker.ts`, `catalog.ts`). It starts
   while photos are still uploading, 8 at a time. There is one cheap AI call
   per photo. The photo is shown turned four ways, the trick from
   `card-orientation.ts`, and the model answers which way is up, what the photo
   is, its title, and whether it's a front or a back. It also says whether it
   says "over", whether it has directions, its first and last lines, and what
   the paper looks like. A photo the person sent before reuses the earlier
   answer (cached by file hash per person), so re-uploads are free.
4. **Pairing.** Once every photo is in, backs are matched to fronts:
   - If every photo has a real capture time, a back taken right after a front
     that continues is its back.
   - Otherwise one text-only AI call matches them from the notes. A front
     can also name a titled card as its back ("b'milk, sour cr. subs over"
     goes with the "Buttermilk" card).
5. **Review** (`client/src/components/bulk-import/intake-review.tsx`). The
   summary reads like this: "We found 31 recipes in 37 photos. 19 ready, 11
   look incomplete (missing a side) — held, 1 already in your recipes —
   skipped, 3 duplicates — skipped." The person can:
   - tick or untick any recipe
   - split a wrong pair
   - choose a card's back from the untitled photos
   - add a photo of a missing back (or front)
   - pick the cookbook to add the recipes to, which is also checked for
     recipes they already have

   The Import button names the count and the cost ("Import 19 recipes · about
   $1.50"). Above 100 recipes it also needs a "Yes, add all N recipes" tick.
6. **Import.** The approved plan is frozen and recipes are fed into the normal
   pipeline, 6 at a time per box (see Handoff). Progress is shown with
   `JobStatus`. The staged full-size photos are deleted once each recipe has
   them.

The plan logic (grouping, incomplete, duplicates, already-in-cookbook,
estimates, limits) is pure code in `shared/bulk-intake.ts`, with tests. The
person's choices are stored as small overrides on the photo rows, so the plan
is always rebuilt the same way.

Everything is driven by the database (`bulk_intakes`, `bulk_intake_photos`),
so a deploy or restart picks up where it left off.

## Cost and accuracy (measured October 2026)

These were tested on 37 of the 231 real photos. The subset included every
pair, hold and duplicate case from the hand-made plan
(`scripts/bench-bulk-intake.ts`). Total spend for all tests was about $0.05.

| | Result |
|---|---|
| First look | `gemini-3.1-flash-lite` (minimal thinking), 1,587 input + ~130 output tokens: **$0.00057 a photo** (231 photos ≈ 13¢), ~1.2–2 s each |
| Pairing | one call, $0.0007 for the subset |
| Turned the right way up | 36 of 37 (the miss was a long newspaper strip) |
| Front/back pairs | 2 of 2 found (including the "Buttermilk" back named by its front), 0 wrong pairs |
| Held as incomplete | 9 of 9 that were held by hand, plus 4 more held for a look: 3 cards that say "over", and 1 loose back the hand plan also flagged as unsure |
| Duplicates in the pile | 3 of 4 (the miss: two different "Corn Cheese" cards) |
| Already in the cookbook (all 231 photos' titles vs the 47-recipe cookbook, title + first ingredient; offline, no AI) | 37 of 38 found, 2 flagged that the hand plan kept |

`gemini-2.5-flash-lite` would be cheaper ($0.10/$0.40 per M tokens) but
Google has closed it to new keys.

The import itself is the expensive part: about **$0.09 a recipe** (reading the
card, enrichment, and a $0.067 dish photo), or about $0.055 with the batch
lane. That figure is estimated from list prices, not measured. The constants
are in `COST` in `shared/bulk-intake.ts`.

## Limits

Set with env vars; defaults are in `DEFAULT_BULK_LIMITS`.

| Limit | Default | Why |
|---|---|---|
| Photos in one box | 600 | ~$0.35 of first looks; ~360 MB staged at most |
| Photos per person per 30 days | 2,000 | caps first-look spend at ~$1.20 a person a month |
| Boxes in progress per person | 3 | |
| Recipes imported from boxes per person per day | 1,000 | caps import spend at ~$90 a day |
| Extra confirmation | above 100 recipes | |
| Largest photo | 15 MB (after the browser shrinks it) | |

The server also feeds bulk recipes slowly (6 being read at once per box),
and bulk extractions go to the back of the queue, so a box of cards never
slows down someone's single photo.

## Handoff to the import pipeline (and the Batch API lane)

The single place is `handOffRecipe()` in `server/bulk-intake/handoff.ts`,
called from `feedPile()` in `server/bulk-intake/worker.ts`. For each
approved recipe it:

1. Creates one upload session per box, sized to the whole import
   (`createImportSession`, `storage.createUploadSession({ totalFiles: N })`).
   It bypasses the 10-file cap on `POST /api/uploads/sessions`.
2. Creates the same placeholder recipe as `POST /api/recipes/upload`, with
   `uploadSessionId` = that session and `sourceImageIndex` = the photo's order.
   It also writes a `recipe_imports` row (`sourceType: 'photo'`, backs in
   `extraPageImages`).
3. Calls `jobQueue.addExtractionJob(recipeId, image, { bulk: true })`, or
   `addMultiImageExtractionJob(recipeId, pages, { bulk: true })` for a front
   and back.

So a bulk recipe is recognizable three ways:
- in memory: `{ bulk: true }`
- after a restart: its upload session's `total_files` (≥ `GEMINI_BATCH_MIN_RECIPES`)
- permanently: `bulk_intake_photos.recipe_id`, which links it to its box
  (`bulk_intakes.id`)

In this branch `{ bulk: true }` only puts the extraction at the back of the
queue. On the `cost-savings` branch the same option calls `markBulkImport()`.

When merging, change `bulkLane()` in `handoff.ts` to
`batchLaneConfig().enabled ? "batch" : "standard"`. The review screen then
shows the batch price and says dish photos follow later.

## Google Drive

Everything happens in the browser (`client/src/lib/google-drive.ts`). Photos
are downloaded there and go through the same shrink-and-upload path, so the
server never holds a Google token. It stays off until the env vars below are
set; `/api/bulk-intake/config` hands them to the page.

**Recommended: Google Picker with the `drive.file` scope.** The person signs
in to Google and picks photos (or a folder) in Google's own window. `drive.file`
only reaches what they pick. It's a non-sensitive scope, so there's no Google
security review. By contrast, `drive.readonly` is a restricted scope that
needs a paid annual security assessment.

One thing to test once the keys are set: whether picking a *folder* under
`drive.file` lets us list the photos inside it. If Google says no, the page
asks the person to open the folder in the picker and select the photos
(⌘A / Ctrl+A), which always works.

**Optional: a shared folder link.** This works for a folder shared "Anyone
with the link" and is read with the API key. There's no sign-in, but the
folder must be public, so it's off unless `GOOGLE_DRIVE_LINKS=on`.

### What the owner sets up in Google Cloud

1. Go to console.cloud.google.com and create or choose a project. Note its
   **project number** (on the Dashboard). That's `GOOGLE_DRIVE_APP_ID`.
2. Under APIs & Services → Library, enable **Google Drive API** and
   **Google Picker API**.
3. Set up the OAuth consent screen:
   - User type: External.
   - App name: "Grammie". Add a support email, the logo, and the
     https://grammie.ai home, privacy and terms links.
   - Scopes: add `https://www.googleapis.com/auth/drive.file` only.
   - Publish the app (Testing mode limits it to 100 named test users). With
     only `drive.file` no verification is needed, though Google may ask to
     confirm the domain in Search Console.
4. Under Credentials → Create credentials → **OAuth client ID**:
   - Type: Web application.
   - Authorized JavaScript origins: `https://grammie.ai` (and the Railway
     URL, and `http://localhost:5000` for development).
   - No redirect URIs are needed (the token flow is a popup).
   - Copy the client ID → `GOOGLE_DRIVE_CLIENT_ID`.
5. Under Credentials → Create credentials → **API key**:
   - Restrict it to HTTP referrers `https://grammie.ai/*` (plus the Railway
     and localhost URLs).
   - Restrict it to the APIs Google Drive API and Google Picker API.
   - Copy it → `GOOGLE_DRIVE_API_KEY`.
6. In Railway, set `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_API_KEY` and
   `GOOGLE_DRIVE_APP_ID`. Add `GOOGLE_DRIVE_LINKS=on` if shared links should
   work too.
7. If the site sends a Content-Security-Policy, allow `https://apis.google.com`,
   `https://accounts.google.com` and `https://docs.google.com` (frames),
   plus `https://www.googleapis.com` (fetch). It doesn't send one today.

### Follow-ups, not built

- **Google Photos.** Picking from Google Photos needs the new Photos Picker
  API (sessions plus polling; the old library scopes were removed in 2025).
  It's a similar amount of work to Drive.
- **iCloud shared albums.** There's no public API. A public shared album's
  web page can be read unofficially, which is fragile. Better: tell people
  to choose the photos in Photos and drag them in, or to use "Export" to a
  folder.

## Not done yet

- **PDFs** are skipped with a note. Reading them needs page rendering in the
  browser (pdf.js, a large dependency) or Gemini's PDF input plus a page
  split.
- **Cropping to the card** (step 2 of the hand process) isn't done; photos
  are only turned upright. The first look could return the card's corners,
  as `grammie-work/corners.json` did.
- **Dish photos** in the pile are set aside. They could become the photo of
  the recipe next to them.
- A card with two recipes imports only the first, as single uploads do. The
  review screen says so.
- A recipe whose handoff keeps failing is retried every 10 minutes with no
  cap.
- `/api/admin/recover-jobs` re-queues recipes stuck in "extracting" after a
  restart using page 1 only and without `{ bulk: true }` (as for all photo
  imports). The upload-session size still marks them bulk for the batch lane.
