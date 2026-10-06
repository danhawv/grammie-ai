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

## Not changed yet

- Photo and handwriting extraction (`GEMINI_TEXT_MODEL` in `server/gemini.ts`) still uses `gemini-3-flash-preview` with thinking on. Handwriting is the hardest reading job, so benchmark it on real recipe cards before moving it.
- The `@google/generative-ai` SDK is deprecated in favor of `@google/genai`. It still works, including thinking settings, but plan the move.
- The OpenAI code paths only run when `AI_PROVIDER=openai` and OpenAI keys are set. Production has neither.
