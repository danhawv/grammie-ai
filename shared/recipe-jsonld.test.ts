import { describe, expect, it } from "vitest";
import {
  buildRecipeJsonLd,
  escapeHtml,
  ingredientLines,
  instructionLines,
  jsonForScript,
  jsonLdScriptTag,
  minutesToIsoDuration,
  nutritionInfo,
  parseMinutes,
  recipeImageUrl,
  type RecipeJsonLdSource,
} from "./recipe-jsonld";

function recipe(overrides: Partial<RecipeJsonLdSource> = {}): RecipeJsonLdSource {
  return {
    id: "abc-123",
    title: "Grandma's Chicken Soup",
    description: "Warm and simple.",
    prepTime: "15 min",
    cookTime: "45 min",
    totalTime: "1 hr",
    prepTimeMinutes: 15,
    cookTimeMinutes: 45,
    totalTimeMinutes: 60,
    servings: 6,
    yield: null,
    ingredients: ["2 lb chicken thighs", "For the broth:", "• 8 cups water", "1 onion, chopped"],
    normalizedIngredients: null,
    instructions: ["Step 1: Put everything in a pot.", "2. Simmer 45 minutes."],
    normalizedInstructions: null,
    cuisine: "American",
    cuisines: ["American", "Jewish"],
    mealType: ["Dinner"],
    dietType: ["Dairy-free"],
    cookingMethods: ["Simmering"],
    occasionTags: null,
    seasonTags: ["Winter"],
    dishImage: "/media/soup.jpg",
    dishImageThumbnail: null,
    dishImages: null,
    calories: 320.4,
    protein: 28.26,
    carbohydrates: 12,
    fat: 15.5,
    fiber: 2,
    sugar: null,
    sodium: 640,
    cholesterol: null,
    publishedAt: null,
    createdAt: new Date("2026-09-01T12:00:00Z"),
    updatedAt: new Date("2026-10-01T12:00:00Z"),
    socialSourceUrl: null,
    ...overrides,
  };
}

describe("buildRecipeJsonLd", () => {
  it("builds a schema.org Recipe trackers can import", () => {
    const ld = buildRecipeJsonLd(recipe(), { baseUrl: "https://grammie.ai/", authorName: "Jean Smith", sourceUrl: "https://example.com/soup" });
    expect(ld).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Grandma's Chicken Soup",
      url: "https://grammie.ai/recipe/abc-123",
      description: "Warm and simple.",
      image: ["https://grammie.ai/media/soup.jpg"],
      author: { "@type": "Person", name: "Jean Smith" },
      datePublished: "2026-09-01",
      prepTime: "PT15M",
      cookTime: "PT45M",
      totalTime: "PT1H",
      recipeYield: "6 servings",
      recipeCategory: "Dinner",
      recipeCuisine: "American, Jewish",
      keywords: "Dairy-free, Simmering, Winter",
      recipeIngredient: ["2 lb chicken thighs", "8 cups water", "1 onion, chopped"],
      recipeInstructions: [
        { "@type": "HowToStep", position: 1, text: "Put everything in a pot." },
        { "@type": "HowToStep", position: 2, text: "Simmer 45 minutes." },
      ],
      nutrition: {
        "@type": "NutritionInformation",
        servingSize: "1 serving",
        calories: "320 calories",
        proteinContent: "28.3 g",
        carbohydrateContent: "12 g",
        fatContent: "15.5 g",
        fiberContent: "2 g",
        sodiumContent: "640 mg",
      },
      isBasedOn: "https://example.com/soup",
    });
    expect((ld.nutrition as any).sugarContent).toBeUndefined();
  });

  it("falls back to Grammie as author and leaves unknowns out", () => {
    const ld = buildRecipeJsonLd(
      recipe({
        description: null, cuisine: null, cuisines: null, mealType: null, dietType: null, cookingMethods: null, seasonTags: null,
        dishImage: null, calories: null, protein: null, carbohydrates: null, fat: null, fiber: null, sodium: null,
      }),
      { baseUrl: "https://grammie.ai" },
    );
    expect((ld.author as any).name).toBe("Grammie");
    for (const key of ["description", "image", "recipeCuisine", "recipeCategory", "keywords", "nutrition", "isBasedOn"]) {
      expect(ld).not.toHaveProperty(key);
    }
  });

  it("uses the social post as the source and ignores non-web source values", () => {
    expect(buildRecipeJsonLd(recipe({ socialSourceUrl: "https://www.tiktok.com/@cook/video/1" }), { baseUrl: "https://grammie.ai" }).isBasedOn)
      .toBe("https://www.tiktok.com/@cook/video/1");
    expect(buildRecipeJsonLd(recipe(), { baseUrl: "https://grammie.ai", sourceUrl: "javascript:alert(1)" })).not.toHaveProperty("isBasedOn");
  });

  it("works out times from text and adds prep + cook when total is missing", () => {
    const ld = buildRecipeJsonLd(
      recipe({ prepTimeMinutes: null, cookTimeMinutes: null, totalTimeMinutes: null, prepTime: "20 minutes", cookTime: "1 hour 10 mins", totalTime: "" }),
      { baseUrl: "https://grammie.ai" },
    );
    expect(ld).toMatchObject({ prepTime: "PT20M", cookTime: "PT1H10M", totalTime: "PT1H30M" });
  });

  it("uses the yield text when servings aren't known", () => {
    expect(buildRecipeJsonLd(recipe({ servings: 0, yield: "24 cookies" }), { baseUrl: "https://grammie.ai" }).recipeYield).toBe("24 cookies");
    expect(buildRecipeJsonLd(recipe({ servings: 1 }), { baseUrl: "https://grammie.ai" }).recipeYield).toBe("1 serving");
  });
});

describe("recipeImageUrl", () => {
  const base = "https://grammie.ai";
  it("keeps web URLs and makes /media paths absolute", () => {
    expect(recipeImageUrl(recipe({ dishImage: "https://cdn.example.com/a.jpg" }), base)).toBe("https://cdn.example.com/a.jpg");
    expect(recipeImageUrl(recipe({ dishImage: "/media/a.jpg" }), base)).toBe("https://grammie.ai/media/a.jpg");
  });
  it("sends stored data URLs through the og-image route and skips placeholders", () => {
    expect(recipeImageUrl(recipe({ dishImage: "data:image/jpeg;base64,AAAA" }), base)).toBe("https://grammie.ai/og-image/recipe/abc-123");
    expect(recipeImageUrl(recipe({ dishImage: "data:image/svg+xml;base64,AAAA", dishImageThumbnail: null }), base)).toBeUndefined();
    expect(recipeImageUrl(recipe({ dishImage: "//evil.example/a.jpg" }), base)).toBeUndefined();
  });
  it("falls back to the first extra photo", () => {
    const dishImages = [
      { id: "2", url: "/media/second.jpg", isAiGenerated: false, order: 1, createdAt: "" },
      { id: "1", url: "/media/first.jpg", isAiGenerated: false, order: 0, createdAt: "" },
    ];
    expect(recipeImageUrl(recipe({ dishImage: null, dishImages }), base)).toBe("https://grammie.ai/media/first.jpg");
  });
});

describe("ingredient and step lines", () => {
  it("uses normalized lines when there are no raw ones", () => {
    expect(ingredientLines({ ingredients: [], normalizedIngredients: [{ raw: " 1  cup   rice ", item: "rice", isOptional: false, isToolOrConsumable: false }] }))
      .toEqual(["1 cup rice"]);
    expect(instructionLines({
      instructions: [],
      normalizedInstructions: [
        { stepNumber: 2, text: "Eat.", ingredients: [], tools: [] },
        { stepNumber: 1, text: "Cook.", ingredients: [], tools: [] },
      ],
    })).toEqual(["Cook.", "Eat."]);
  });
  it("keeps decimals and plain numbers at the start", () => {
    expect(ingredientLines({ ingredients: ["1.5 cups flour", "- 2 eggs", "3) 1 tsp salt"], normalizedIngredients: null }))
      .toEqual(["1.5 cups flour", "2 eggs", "1 tsp salt"]);
    expect(instructionLines({ instructions: ["350°F oven for 20 minutes."], normalizedInstructions: null })).toEqual(["350°F oven for 20 minutes."]);
  });
});

describe("durations", () => {
  it("formats ISO 8601", () => {
    expect(minutesToIsoDuration(5)).toBe("PT5M");
    expect(minutesToIsoDuration(60)).toBe("PT1H");
    expect(minutesToIsoDuration(135)).toBe("PT2H15M");
    expect(minutesToIsoDuration(0)).toBeUndefined();
    expect(minutesToIsoDuration(null)).toBeUndefined();
  });
  it("parses written times", () => {
    expect(parseMinutes("45 min")).toBe(45);
    expect(parseMinutes("1.5 hours")).toBe(90);
    expect(parseMinutes("1h30m")).toBe(90);
    expect(parseMinutes("2 days")).toBe(2880);
    expect(parseMinutes("30")).toBe(30);
    expect(parseMinutes("overnight")).toBeNull();
    expect(parseMinutes(null)).toBeNull();
  });
});

describe("nutritionInfo", () => {
  it("is undefined with no numbers and skips negatives", () => {
    expect(nutritionInfo({ calories: null, protein: null, carbohydrates: null, fat: null, fiber: null, sugar: null, sodium: null, cholesterol: null })).toBeUndefined();
    expect(nutritionInfo({ calories: -5, protein: 3, carbohydrates: null, fat: null, fiber: null, sugar: null, sodium: null, cholesterol: null }))
      .toEqual({ "@type": "NutritionInformation", servingSize: "1 serving", proteinContent: "3 g" });
  });
});

describe("escaping", () => {
  it("escapes HTML attribute text", () => {
    expect(escapeHtml(`Mac & "cheese" <b>'s`)).toBe("Mac &amp; &quot;cheese&quot; &lt;b&gt;&#39;s");
  });
  it("can't close the script tag and stays valid JSON", () => {
    const value = { name: "</script><script>alert(1)</script>", note: "line\u2028sep\u2029 <!-- & -->" };
    const out = jsonForScript(value);
    expect(out).not.toMatch(/<\/script/i);
    expect(out).not.toContain("<!--");
    expect(out).not.toContain("\u2028");
    expect(out).not.toContain("\u2029");
    expect(JSON.parse(out)).toEqual(value);
    expect(jsonLdScriptTag(value)).toMatch(/^<script type="application\/ld\+json">\{.*\}<\/script>$/);
  });
});
