import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from "@google/generative-ai";
import { modelFor, generationConfigFor, AI_CALL_TIMEOUT_MS } from "../../ai-models";
import { parseModelJson } from "../../lib/model-json";
import type { RecipeSource } from "./types";
import { stepTempF } from "./structure";

// The one AI call in the session builder: a recipe's steps -> kitchen tasks.
// The model only labels and splits; every number it gives is checked against
// the recipe in structure.ts (validateSteps), and nothing is added up by it.

/** Gemini list prices, US dollars per million tokens (October 2026; same table as bulk-intake/catalog.ts) */
const PRICES: Record<string, { input: number; output: number }> = {
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
};

export function costMicros(model: string, meta: any): number {
  const input = Number(meta?.promptTokenCount) || 0;
  // Thinking tokens bill as output
  const output = (Number(meta?.candidatesTokenCount) || 0) + (Number(meta?.thoughtsTokenCount) || 0);
  const price = PRICES[model] ?? PRICES["gemini-3.6-flash"];
  return Math.round(input * price.input + output * price.output);
}

const KINDS = ["prep", "cook", "simmer", "bake", "rest", "chill", "marinate", "assemble"];

const str = (description?: string) => ({ type: SchemaType.STRING, ...(description ? { description } : {}) });
const num = (description?: string) => ({ type: SchemaType.NUMBER, ...(description ? { description } : {}) });

// Built loosely and cast: the SDK's Schema union types each node shape separately
export const STEPS_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    tasks: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          id: str("t1, t2, ..."),
          text: str("short instruction in plain words"),
          kind: { type: SchemaType.STRING, format: "enum", enum: KINDS },
          activeMin: num("hands-on minutes"),
          passiveMin: num("minutes it sits on its own"),
          heat: { type: SchemaType.STRING, format: "enum", enum: ["none", "oven", "burner", "appliance"] },
          tempF: { ...num("oven temperature in Fahrenheit"), nullable: true },
          appliance: { ...str(), nullable: true },
          vessel: { ...str(), nullable: true },
          dependsOn: { type: SchemaType.ARRAY, items: str() },
          holdMin: num("minutes the result can wait before the next step"),
          doneCue: { ...str(), nullable: true },
          ingredients: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                index: { type: SchemaType.INTEGER },
                fraction: num("share of the line used here, 1 = all"),
                prep: { ...str("diced, minced, sliced, chopped, grated, juiced..."), nullable: true },
              },
              required: ["index", "fraction"],
            },
          },
          fromSteps: { type: SchemaType.ARRAY, items: { type: SchemaType.INTEGER } },
        },
        required: ["id", "text", "kind", "activeMin", "passiveMin", "heat", "dependsOn", "holdMin", "ingredients", "fromSteps"],
      },
    },
    atServing: { type: SchemaType.ARRAY, items: str() },
  },
  required: ["tasks", "atServing"],
} as unknown as ResponseSchema;

const PROMPT = `You turn one recipe into kitchen tasks for a cook who is making several recipes in one long batch-cooking session. A scheduler will interleave tasks from different recipes, so get the hands-on time, waiting time and order right.

Rules:
- Cutting gets its own "prep" task, ONE ingredient per cutting task ("Dice the onion", "Mince the garlic"), with the prep form (diced, minced, sliced, chopped, grated, juiced, peeled and cubed). Cutting tasks depend on nothing. Measuring and opening cans need no task.
- Every other step becomes a task. Split a step that mixes hands-on work and waiting: "brown the beef, then simmer 1 hour" is a cook task and a simmer task.
- kind: prep (cutting, mixing a marinade or sauce), cook (hands-on at the stove: brown, sear, saute, stir, whisk in), simmer (a pot that mostly sits: simmering, boiling, cooking rice), bake (anything in the oven, roasting too), rest, chill, marinate, assemble (combine, layer, fill a dish, blend).
- activeMin = hands-on minutes. passiveMin = minutes it sits on its own. Use the recipe's own times when it gives them. Simmer, bake, rest, chill and marinate are mostly passive (1-5 minutes hands-on).
- heat: "oven" with tempF in Fahrenheit (convert Celsius), "burner", "appliance" (name it in appliance: blender, food processor, slow cooker, rice cooker, instant pot, air fryer), or "none". Do NOT make preheat tasks; put the temperature on the oven task.
- vessel: large pot, dutch oven, saucepan, skillet, sheet pan, baking dish, mixing bowl, blender or food processor (or null). Keep the same name while the food stays in the same pot.
- dependsOn: ids of tasks that must be finished first.
- ingredients: the recipe's ingredient lines (by index) the task uses, with fraction (share of that line used here) and prep form. Every ingredient line must appear in at least one task. A cutting task lists what it cuts, and the task that adds it to the pot lists it too.
- Leave serving steps out of tasks (plating, garnish, serve hot, pair with) and put them in atServing. Making a salad, sauce, dressing or topping IS a task (assemble): it gets made in the session and packed separately.
- doneCue: how to tell it's done ("no longer pink", "golden and bubbly", "chicken reaches 165°F"), or null.
- holdMin: how long the result can wait before the next step without harm.
- fromSteps: the recipe step numbers the task comes from.
- Task text: a short instruction a cook who hasn't seen the recipe can follow. Name the recipe's ingredients; don't do math on amounts.

Example
Recipe: {"title":"Sausage and Pepper Bake","servings":4,"ingredients":[{"index":0,"text":"1 lb Italian sausage"},{"index":1,"text":"1 onion"},{"index":2,"text":"2 bell peppers"},{"index":3,"text":"2 tbsp olive oil"},{"index":4,"text":"1 cup rice"},{"index":5,"text":"2 cups water"},{"index":6,"text":"parsley for garnish"}],"steps":[{"n":1,"text":"Preheat oven to 400°F."},{"n":2,"text":"Slice the onion and peppers and toss with the oil and sausage on a sheet pan."},{"n":3,"text":"Roast 25 minutes until the sausage reaches 160°F.","minutes":25,"tempF":400},{"n":4,"text":"Meanwhile bring rice and water to a boil, cover and cook on low 18 minutes, then let stand 5 minutes.","minutes":23},{"n":5,"text":"Serve the sausage over rice, sprinkled with parsley."}]}
Answer: {"tasks":[
{"id":"t1","text":"Slice the onion","kind":"prep","activeMin":3,"passiveMin":0,"heat":"none","tempF":null,"appliance":null,"vessel":null,"dependsOn":[],"holdMin":240,"doneCue":null,"ingredients":[{"index":1,"fraction":1,"prep":"sliced"}],"fromSteps":[2]},
{"id":"t2","text":"Slice the bell peppers","kind":"prep","activeMin":4,"passiveMin":0,"heat":"none","tempF":null,"appliance":null,"vessel":null,"dependsOn":[],"holdMin":240,"doneCue":null,"ingredients":[{"index":2,"fraction":1,"prep":"sliced"}],"fromSteps":[2]},
{"id":"t3","text":"Toss the onion, peppers and sausage with the olive oil on a sheet pan","kind":"assemble","activeMin":3,"passiveMin":0,"heat":"none","tempF":null,"appliance":null,"vessel":"sheet pan","dependsOn":["t1","t2"],"holdMin":30,"doneCue":null,"ingredients":[{"index":0,"fraction":1,"prep":null},{"index":1,"fraction":1,"prep":"sliced"},{"index":2,"fraction":1,"prep":"sliced"},{"index":3,"fraction":1,"prep":null}],"fromSteps":[2]},
{"id":"t4","text":"Roast the sausage and peppers","kind":"bake","activeMin":1,"passiveMin":25,"heat":"oven","tempF":400,"appliance":null,"vessel":"sheet pan","dependsOn":["t3"],"holdMin":20,"doneCue":"Sausage reaches 160°F","ingredients":[],"fromSteps":[3]},
{"id":"t5","text":"Bring the rice and water to a boil, cover and cook on low","kind":"simmer","activeMin":3,"passiveMin":18,"heat":"burner","tempF":null,"appliance":null,"vessel":"saucepan","dependsOn":[],"holdMin":20,"doneCue":"Water is absorbed","ingredients":[{"index":4,"fraction":1,"prep":null},{"index":5,"fraction":1,"prep":null}],"fromSteps":[4]},
{"id":"t6","text":"Take the rice off the heat and let it stand, covered","kind":"rest","activeMin":0,"passiveMin":5,"heat":"none","tempF":null,"appliance":null,"vessel":"saucepan","dependsOn":["t5"],"holdMin":30,"doneCue":null,"ingredients":[],"fromSteps":[4]}],
"atServing":["Serve the sausage over the rice, sprinkled with parsley (ingredient 6)"]}`;

/** What the model sees: the recipe trimmed to what matters for timing */
export function promptInput(recipe: RecipeSource): string {
  const norm = recipe.normalizedInstructions?.length ? recipe.normalizedInstructions : null;
  const steps = norm
    ? norm.map((s, i) => {
        const tempF = stepTempF(s);
        return {
          n: s.stepNumber ?? i + 1,
          text: s.text,
          ...(s.timeMinutes ? { minutes: s.timeMinutes } : {}),
          ...(tempF ? { tempF } : {}),
        };
      })
    : recipe.instructions.map((text, i) => ({ n: i + 1, text }));
  return JSON.stringify({
    title: recipe.title,
    servings: recipe.servings,
    prepMinutes: recipe.prepTimeMinutes ?? undefined,
    cookMinutes: recipe.cookTimeMinutes ?? undefined,
    ingredients: recipe.ingredients.map((text, index) => ({ index, text })),
    steps,
  });
}

export interface AIStepsAnswer {
  raw: any;
  model: string;
  costMicros: number;
}

/** Asks Gemini for the task breakdown. Throws when Gemini isn't set up or answers junk. */
export async function structureWithGemini(recipe: RecipeSource): Promise<AIStepsAnswer> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const choice = modelFor("prepSteps");
  const model = new GoogleGenerativeAI(key).getGenerativeModel(
    {
      model: choice.model,
      generationConfig: { ...generationConfigFor(choice), responseSchema: STEPS_SCHEMA, temperature: 0 } as any,
    },
    { timeout: AI_CALL_TIMEOUT_MS.text },
  );
  const result = await model.generateContent([PROMPT, `Recipe: ${promptInput(recipe)}\nAnswer:`]);
  return {
    raw: parseModelJson(result.response.text()),
    model: choice.model,
    costMicros: costMicros(choice.model, result.response.usageMetadata),
  };
}
