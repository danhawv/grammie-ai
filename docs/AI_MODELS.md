# AI models and the import pipeline

Model choices live in `server/ai-models.ts`. Any job can be switched without a
code change by setting `GEMINI_MODEL_<JOB>` (for example
`GEMINI_MODEL_ENRICHCORE=gemini-3.8-flash:low`). Before changing a default,
run `scripts/bench-models.ts` with the override and compare against the numbers
below.

## How a link becomes a recipe

1. **Read the post or page.** No AI is involved at this step.
   - Web pages: we try an honest bot identity first, then a browser identity. Structured recipe data (JSON-LD) is used when the page has it.
   - Instagram: the public embed page, which gives the full caption in about 0.5 seconds. Apify is the fallback.
   - TikTok: TikTok's oEmbed API, which gives the full caption in about 0.4 seconds. Apify is the fallback.
   - YouTube: the video's description from the watch page.
   - Captions that only say "full recipe at …" lead to that page, which is imported instead.
2. **Extract.** The AI turns the text into recipe fields (`textExtraction` and `socialExtraction` jobs). This happens only when there's no structured data.
3. **Save.** The person lands on the review page here.
4. **Enrich, in the background.** Two parallel calls fill in the details:
   - `enrichCore`: normalized ingredients and steps, tags, allergens.
   - `enrichNutrition`: nutrition and cost.
5. **Photo.** The dish image (`dishImage`).
6. **Extra content.** `enrichContent` adds tips, variations and pairings after the recipe is usable.

## Benchmarks (October 2026)

Total time from pasting a link to having a finished recipe with a photo:

| Link | Before | After |
|---|---|---|
| Web page with structured data | 48.7s | 22.0s |
| Web page the AI has to read | 66.2s | 17.4s |
| Instagram | 45.6s (plus 10–60s for Apify) | 20.7s |
| TikTok | 57.5s (plus 10–60s for Apify) | 25.8s |
| YouTube | not supported | 20.4s |

Time the person waits on the "Reading…" spinner fell from 8–27s (plus Apify) to 2–3s.

Why each model was chosen:

- **Extraction: `gemini-3.5-flash-lite`.**
  - Takes 1.5s per caption, against 5.6s for `gemini-3-flash-preview`.
  - Identical ingredient counts.
  - Keeps the creator's own steps instead of splitting them.
- **Enrichment: `gemini-3.5-flash-lite`.**
  - The core call takes 12s, against 25–27s.
  - It gave the same calorie estimate on repeat runs (780 and 780). The old model gave 845, 1025 and 1249 for the same recipe.
  - It caught soy in gochujang.
  - `gemini-3.1-flash-lite` dropped most of the ingredients; don't use it for `enrichCore`.
  - `gemini-3.8-flash` took 38s, which is slower, not better.
- **Dish photo: `gemini-3.1-flash-image` (Nano Banana 2).**
  - Takes 10–11s, against 18–23s for `gemini-3-pro-image-preview`.
  - Photos looked comparable side by side.
  - It's a stable release, not a preview.
- **Thinking:**
  - Gemini 3+ models think by default, which cost about 1,000 extra tokens and 3–4 seconds per extraction for no change in the output.
  - Use `:low` or a Flash-Lite model for transcription-style work.

## Recipe cards (handwriting)

The `vision` job uses `gemini-3.6-flash` with minimal thinking. It was tested on 6 real recipe cards, scored against the saved, reviewed versions:

| Model | Median time | Slowest | Ingredient match | Long card (27 lines) |
|---|---|---|---|---|
| gemini-3-flash-preview (old) | 17.1s | 31.1s | 100% | 28 lines |
| gemini-3-flash-preview:low | 4.5s | 8.3s | 98% | 28 lines |
| **gemini-3.6-flash:minimal** | **3.1–3.3s** | **4.7s** | **99%** | **27 lines** |
| gemini-3.6-flash:low | 4.3s | 6.4s | 99% | 27 lines |
| gemini-3.5-flash-lite | 2.6s | 8.8s | 96% | 30 lines |
| gemini-3.8-flash:low | 7.7s | 10.6s | 99% | 28 lines |

Flash-Lite is slightly faster but invents extra lines. Gemini 3.6 Flash is a stable release, unlike the old preview model.

## Not changed yet

- The `@google/generative-ai` SDK is deprecated in favor of `@google/genai`. It still works, including thinking settings, but plan the move.
- The OpenAI code paths only run when `AI_PROVIDER=openai` and OpenAI keys are set. Production has neither.

## Delays and batch imports (October 2026)

**Rate limits aren't the problem.** In testing, Gemini accepted 60 text calls and 25 image calls at the same moment with no rejections. Images took about 9s each.

**What does cause delays:**
- Google has short capacity blips. These show up as a 429 without a quota violation, a 500, or a call that hangs. One image call took 108s.
- Our own queue made those blips worse:
  - It ran only 3 text jobs and 2 photo jobs at once.
  - A failed job held its worker slot while it waited 60s to retry.
  - Calls had no time limit short of the job's 5-minute timeout.
  - Optional tips content competed with extraction.

**What the queue does now (`server/job-queue.ts`):**
- Runs 10 text jobs and 8 image jobs at once. Change this with `QUEUE_TEXT_WORKERS` and `QUEUE_IMAGE_WORKERS`.
- Retries without holding a slot. It uses the delay Google asks for, or 15s after a 429 and 5s after a 5xx (`server/lib/rate-limit.ts`).
- Time-limits each call: text 60s, card photos 90s, dish photos 30s (`AI_CALL_TIMEOUT_MS`). A stalled dish photo switches to the backup image model.
- Runs tips content only when no extraction or core enrichment is waiting.

**Simulated batch of recipe-card photos**, using measured step times (cards 11s, enrichment 12s, tips 9s, photo 9s):

| Cards | Before: all recipes usable | Before: everything done | After: all recipes usable | After: everything done |
|---|---|---|---|---|
| 5 | 0.8 min | 0.9 min | 0.4 min | 0.5 min |
| 20 | 2.7 min | 3.6 min | 0.8 min | 1.1 min |
| 50 | 6.5 min | 8.9 min | 1.9 min | 2.7 min |

Splitting core enrichment into parallel calls (12s down to 3.5s, tested) would bring 50 cards down to about 1.2 min until every recipe is usable.

## Single-recipe speed loop (October 2026)

`scripts/bench-import.ts` runs every kind of import through the real pipeline and saves nothing. Run `single 3` for median per-stage timings, or `batch 20` for cards run concurrently through queue-sized pools. "Review" is when the review page opens; "photo" is when the dish photo appears.

| Change | Median review | Median photo |
|---|---|---|
| Start of the loop | 16.0s | 24.2s |
| Core enrichment split into parallel calls (ingredients in batches of 5, steps, recipe details), plus a JSON parser fix for bare arrays | 8.1s | 16.9s |
| Cards read by gemini-3.6-flash (minimal thinking); review page polls every 1s, not 3s; photo starts when the recipe is read, beside enrichment | 6.5s | 11.8s |
| Batch-size check: 3 = 6.6s, **5 = 6.2s**, 8 = 7.1s; short batches retried, originals kept if still short | 6.2s | 11.7s |
| Final run, 3 repetitions over 9 import types | **6.4s** | **11.3s** |

For links and pasted text, the review page now shows the recipe it has read (title, ingredients, steps) while the details finish. The recipe appears about 3s after pasting.

**20 recipe cards at once:**

| | First recipe usable | All usable | All photos |
|---|---|---|---|
| Before | 77s | 125s | 168s |
| After | 7s | 14s | 29s |

**Where a social link's ~6.4s goes now:**
- Reading the post: 0.5s
- Caption to recipe: about 2s
- Details: about 3s. That's the slowest batch, and below it is per-call overhead.
- The page noticing: 0.5s

Going further would need streaming or a much faster inference host, which is past the point of diminishing returns.
