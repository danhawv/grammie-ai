// Which Gemini model each job uses, in one place. Benchmarks behind these
// choices are in docs/AI_MODELS.md; re-run scripts/bench-models.ts before
// changing them.
//
// thinkingLevel: Gemini 3+ models "think" before answering by default, which
// roughly doubles response time. Reading a recipe out of text doesn't need
// it, so extraction runs with thinking off or low.

export interface ModelChoice {
  model: string;
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
}

const DEFAULTS = {
  /** Captions, pasted text and web pages -> recipe fields (transcription) */
  textExtraction: { model: "gemini-3.5-flash-lite" },
  /** Social captions that may need missing steps filled in */
  socialExtraction: { model: "gemini-3.5-flash-lite" },
  /** Enrichment group 1: normalized ingredients/steps, tags, allergens */
  enrichCore: { model: "gemini-3.5-flash-lite" },
  /** Enrichment group 2: nutrition and cost */
  enrichNutrition: { model: "gemini-3.5-flash-lite" },
  /** Enrichment group 3: tips, variations, pairings (runs after the recipe is usable) */
  enrichContent: { model: "gemini-3.5-flash-lite" },
  /** Short helper answers (substitutions, generated steps) */
  quickText: { model: "gemini-3.5-flash-lite" },
  /** Dish photo for recipes without one */
  dishImage: { model: "gemini-3.1-flash-image" },
  /** Tried when dishImage is rate-limited or erroring (separate quota) */
  dishImageBackup: { model: "gemini-nano-banana-2.1" },
} satisfies Record<string, ModelChoice>;

export type AIJob = keyof typeof DEFAULTS;

/**
 * Model for a job. GEMINI_MODEL_<JOB> (e.g. GEMINI_MODEL_ENRICHCORE=
 * "gemini-3.8-flash:low") overrides it for benchmarking or a quick switch.
 */
export function modelFor(job: AIJob): ModelChoice {
  const override = process.env[`GEMINI_MODEL_${job.toUpperCase()}`];
  if (override) {
    const [model, thinkingLevel] = override.split(":");
    return { model, thinkingLevel: (thinkingLevel || undefined) as ModelChoice["thinkingLevel"] };
  }
  return DEFAULTS[job];
}

/** generationConfig for a model choice, JSON output by default */
export function generationConfigFor(choice: ModelChoice, json = true): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (json) config.responseMimeType = "application/json";
  if (choice.thinkingLevel) config.thinkingConfig = { thinkingLevel: choice.thinkingLevel };
  return config;
}
