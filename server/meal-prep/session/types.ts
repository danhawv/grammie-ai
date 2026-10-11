import type { TaskKind } from "@shared/meal-prep/contract";

// Internal shapes for the session builder (part 3). The contract's PrepTask
// is what leaves this module; these are the steps on the way there.

/** The recipe fields step structuring reads (a slice of the recipes row) */
export interface RecipeSource {
  id: string;
  title: string;
  servings: number;
  /** ISO timestamp; with STEPS_VERSION it keys the cached structure */
  updatedAt: string;
  ingredients: string[];
  instructions: string[];
  normalizedInstructions: NormalizedStep[] | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  totalTimeMinutes: number | null;
}

/** recipes.normalizedInstructions entries (shared/schema.ts instructionStepSchema), loosely typed: old rows vary */
export interface NormalizedStep {
  stepNumber?: number;
  text: string;
  ingredients?: string[];
  tools?: string[];
  timeMinutes?: number | null;
  timeRange?: { min?: number; max?: number; approximate?: boolean } | null;
  temperature?: { value?: number | null; scale?: "F" | "C" | null; range?: string | null } | null;
  stepType?: string | null;
  donenessCue?: string | null;
}

export type Heat = "none" | "oven" | "burner" | "appliance";

/** One ingredient a task uses: the recipe's ingredient line, how much of it, and how it's cut */
export interface TaskIngredient {
  index: number;
  /** share of the line used in this task (1 = all of it) */
  fraction: number;
  prep: string | null;
}

/** A recipe's task at scale 1, before merging, padding and scheduling */
export interface RecipeTask {
  /** local to the recipe ("t3") */
  id: string;
  text: string;
  kind: TaskKind;
  activeMin: number;
  passiveMin: number;
  heat: Heat;
  tempF: number | null;
  appliance: string | null;
  /** pot, pan or dish it happens in; the same name across steps means the same vessel */
  vessel: string | null;
  dependsOn: string[];
  holdMin: number;
  doneCue: string | null;
  ingredients: TaskIngredient[];
  /** recipe step numbers it came from */
  fromSteps: number[];
}

/** Bump when the task shape or prompt changes enough that cached rows should be redone */
export const STEPS_VERSION = 1;

export interface RecipeSteps {
  recipeId: string;
  recipeUpdatedAt: string;
  version: number;
  source: "ai" | "heuristic";
  model: string | null;
  tasks: RecipeTask[];
  /** steps that belong at mealtime, not in the session ("Garnish with cheese") */
  atServing: string[];
  /** what validation corrected, for debugging and prompt tuning */
  fixes: string[];
  /** cost of the AI call, millionths of a dollar (0 for heuristic) */
  costMicros: number;
}
