import OpenAI from "openai";
import { Buffer } from "node:buffer";

// Check if Replit AI Integrations OpenAI is available
const hasOpenAI = !!(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY);

// Using Replit AI Integrations for OpenAI (charges to Replit credits, no personal API key needed)
const openai = hasOpenAI
  ? new OpenAI({
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    })
  : null;

export interface ExtractedRecipe {
  title: string;
  description?: string;
  prepTime: string;
  cookTime?: string;
  totalTime: string;
  coolingTime?: string;
  servings: number;
  ingredients: string[];
  instructions: string[];
  dietType?: string[];
  cuisine?: string;
  mealType?: string[];
  calories?: number;
  protein?: number;
  carbohydrates?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
  cholesterol?: number;
}

export async function extractRecipeFromImage(
  imageBase64: string
): Promise<ExtractedRecipe> {
  if (!hasOpenAI || !openai) {
    // Return mock data if OpenAI is not configured
    console.warn("OpenAI API key not found - using mock extraction");
    return {
      title: "Extracted Recipe",
      description: "A delicious recipe extracted from your handwritten note. Note: OpenAI API key required for actual extraction.",
      prepTime: "15 mins",
      cookTime: "20 mins",
      totalTime: "35 mins",
      servings: 4,
      ingredients: [
        "2 cups of main ingredient",
        "1 cup of secondary ingredient",
        "1/2 teaspoon of seasoning",
        "Salt and pepper to taste",
      ],
      instructions: [
        "Prepare all ingredients by washing and chopping as needed.",
        "Combine main ingredients in a large bowl or pot.",
        "Cook according to your recipe's method (bake, sauté, or simmer).",
        "Season to taste and serve hot.",
      ],
      dietType: ["vegetarian"],
      cuisine: "International",
      mealType: ["dinner"],
      calories: 300,
      protein: 15.0,
      carbohydrates: 35.0,
      fat: 10.0,
      fiber: 5.0,
      sugar: 3.0,
      sodium: 400,
      cholesterol: 0,
    };
  }

  try {
    console.log("Extracting recipe from image with OpenAI Vision...");
    // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are a recipe extraction and nutrition expert. Analyze this handwritten recipe image and extract ALL information in a complete structured JSON format.

Extract the following information:
- title (recipe name)
- description (brief appealing description - create one if not visible)
- prepTime (preparation time in format like "15 mins")
- cookTime (cooking time if mentioned, in format like "45 mins")
- totalTime (total time in format like "1 hr")
- coolingTime (if mentioned)
- servings (number of servings as integer)
- ingredients (array of ingredient strings with quantities)
- instructions (array of step-by-step instructions)
- dietType (array: "vegetarian", "vegan", "gluten-free", "dairy-free", etc. - infer from ingredients)
- cuisine (e.g., "American", "Italian", "French", etc. - infer from recipe style)
- mealType (array: "breakfast", "lunch", "dinner", "dessert", "snack", "appetizer", "side dish", "beverage", "sauce", "dip", "marinade", "rub" - infer appropriately)

ALWAYS provide estimated nutritional information per serving based on the ingredients:
- calories (integer - estimate based on ingredients)
- protein (grams as decimal - estimate based on ingredients)
- carbohydrates (grams as decimal - estimate based on ingredients)
- fat (grams as decimal - estimate based on ingredients)  
- fiber (grams as decimal - estimate based on ingredients)
- sugar (grams as decimal - estimate based on ingredients)
- sodium (mg as integer - estimate based on ingredients)
- cholesterol (mg as integer - estimate based on ingredients)

Return ONLY a complete JSON object with ALL fields filled in. Make reasonable estimates for any missing data.`,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 8192, // gpt-5 uses max_completion_tokens instead of max_tokens
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    const extracted = JSON.parse(content) as ExtractedRecipe;
    return extracted;
  } catch (error) {
    console.error("Error extracting recipe from image:", error);
    console.warn("Falling back to mock recipe data due to OpenAI error");
    
    // Fall back to mock data instead of throwing error
    return {
      title: "Extracted Recipe",
      description: "A delicious recipe extracted from your handwritten note. (Using mock data - OpenAI quota exceeded)",
      prepTime: "15 mins",
      cookTime: "20 mins",
      totalTime: "35 mins",
      servings: 4,
      ingredients: [
        "2 cups of main ingredient",
        "1 cup of secondary ingredient",
        "1/2 teaspoon of seasoning",
        "Salt and pepper to taste",
      ],
      instructions: [
        "Prepare all ingredients by washing and chopping as needed.",
        "Combine main ingredients in a large bowl or pot.",
        "Cook according to your recipe's method (bake, sauté, or simmer).",
        "Season to taste and serve hot.",
      ],
      dietType: ["vegetarian"],
      cuisine: "International",
      mealType: ["dinner"],
      calories: 300,
      protein: 15.0,
      carbohydrates: 35.0,
      fat: 10.0,
      fiber: 5.0,
      sugar: 3.0,
      sodium: 400,
      cholesterol: 0,
    };
  }
}

export async function completeRecipeInfo(
  recipe: Partial<ExtractedRecipe>
): Promise<ExtractedRecipe> {
  if (!hasOpenAI || !openai) {
    // Return the recipe as-is with some defaults if OpenAI is not configured
    console.warn("OpenAI API key not found - skipping auto-completion");
    return {
      title: recipe.title || "Recipe",
      description:
        recipe.description || "A delicious homemade recipe",
      prepTime: recipe.prepTime || "15 mins",
      cookTime: recipe.cookTime,
      totalTime: recipe.totalTime || "30 mins",
      coolingTime: recipe.coolingTime,
      servings: recipe.servings || 4,
      ingredients: recipe.ingredients || ["Ingredients not specified"],
      instructions: recipe.instructions || ["Instructions not specified"],
      dietType: recipe.dietType || [],
      cuisine: recipe.cuisine || "International",
      mealType: recipe.mealType || [],
      calories: recipe.calories ?? 250,
      protein: recipe.protein ?? 12.0,
      carbohydrates: recipe.carbohydrates ?? 30.0,
      fat: recipe.fat ?? 8.0,
      fiber: recipe.fiber ?? 3.0,
      sugar: recipe.sugar ?? 5.0,
      sodium: recipe.sodium ?? 300,
      cholesterol: recipe.cholesterol ?? 25,
    };
  }

  try {
    // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "user",
          content: `You are a recipe nutritionist. Given this recipe information, fill in any missing nutritional data and ensure all required fields are present.

Recipe: ${JSON.stringify(recipe, null, 2)}

Please provide complete recipe information with:
1. Estimated nutritional values per serving (calories, protein, carbs, fat, fiber, sugar, sodium, cholesterol) if not provided
2. Appropriate diet tags based on ingredients (vegetarian, vegan, gluten-free, etc.)
3. Cuisine type if it can be determined
4. Meal type classifications
5. A brief appealing description if one isn't provided

Return ONLY the complete JSON object with all fields filled in.`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 8192, // gpt-5 uses max_completion_tokens instead of max_tokens
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    const completed = JSON.parse(content) as ExtractedRecipe;
    return completed;
  } catch (error) {
    console.error("Error completing recipe info:", error);
    console.warn("Falling back to default values due to OpenAI error");
    
    // Fall back to defaults instead of throwing error
    return {
      title: recipe.title || "Recipe",
      description:
        recipe.description || "A delicious homemade recipe",
      prepTime: recipe.prepTime || "15 mins",
      cookTime: recipe.cookTime,
      totalTime: recipe.totalTime || "30 mins",
      coolingTime: recipe.coolingTime,
      servings: recipe.servings || 4,
      ingredients: recipe.ingredients || ["Ingredients not specified"],
      instructions: recipe.instructions || ["Instructions not specified"],
      dietType: recipe.dietType || [],
      cuisine: recipe.cuisine || "International",
      mealType: recipe.mealType || [],
      calories: recipe.calories ?? 250,
      protein: recipe.protein ?? 12.0,
      carbohydrates: recipe.carbohydrates ?? 30.0,
      fat: recipe.fat ?? 8.0,
      fiber: recipe.fiber ?? 3.0,
      sugar: recipe.sugar ?? 5.0,
      sodium: recipe.sodium ?? 300,
      cholesterol: recipe.cholesterol ?? 25,
    };
  }
}

interface RecipeImageContext {
  instructions?: Array<{ step: string }> | string[];
  cookingMethods?: string[];
  cuisines?: string[];
  mealType?: string[];
  skillLevel?: string;
}

export async function generateDishImage(
  recipeName: string,
  ingredients: string[],
  recipeContext?: RecipeImageContext
): Promise<Buffer> {
  if (!hasOpenAI || !openai) {
    // Return a placeholder image if OpenAI is not configured
    console.warn("OpenAI API key not found - using placeholder image");
    // Create a simple SVG placeholder
    const svg = `<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
      <rect width="1024" height="1024" fill="#f3f4f6"/>
      <text x="512" y="462" font-family="Arial" font-size="48" fill="#9ca3af" text-anchor="middle">${recipeName}</text>
      <text x="512" y="562" font-family="Arial" font-size="24" fill="#d1d5db" text-anchor="middle">AI Image Generation Available</text>
      <text x="512" y="602" font-family="Arial" font-size="24" fill="#d1d5db" text-anchor="middle">with OpenAI API Key</text>
    </svg>`;
    return Buffer.from(svg, "utf8");
  }

  try {
    // Build enhanced prompt using recipe context
    const prompt = buildImagePrompt(recipeName, ingredients, recipeContext);
    
    console.log(`Generating image with prompt: ${prompt.substring(0, 150)}...`);

    // the newest image model is "gpt-image-1". do not change this unless explicitly requested by the user
    const response = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
    });

    // gpt-image-1 returns base64 format directly
    const base64 = response.data?.[0]?.b64_json;
    if (!base64) {
      throw new Error("No image data returned from image generation");
    }

    return Buffer.from(base64, "base64");
  } catch (error) {
    console.error("Error generating dish image:", error);
    console.warn("Falling back to placeholder image due to OpenAI error");
    
    // Fall back to placeholder SVG instead of throwing error
    const svg = `<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
      <rect width="1024" height="1024" fill="#f3f4f6"/>
      <text x="512" y="462" font-family="Arial" font-size="48" fill="#9ca3af" text-anchor="middle">${recipeName}</text>
      <text x="512" y="562" font-family="Arial" font-size="24" fill="#d1d5db" text-anchor="middle">AI Image Generation Available</text>
      <text x="512" y="602" font-family="Arial" font-size="24" fill="#d1d5db" text-anchor="middle">with OpenAI API Key</text>
    </svg>`;
    return Buffer.from(svg, "utf8");
  }
}

export function buildImagePrompt(
  recipeName: string,
  ingredients: string[],
  context?: RecipeImageContext
): string {
  const visualCues: string[] = [];
  
  if (context?.instructions) {
    const instructionText = context.instructions
      .map(i => typeof i === 'string' ? i : i.step)
      .join(' ')
      .toLowerCase();
    
    if (instructionText.includes('golden brown') || instructionText.includes('golden')) {
      visualCues.push('golden brown finish');
    }
    if (instructionText.includes('charred') || instructionText.includes('grill marks')) {
      visualCues.push('visible char marks');
    }
    if (instructionText.includes('crispy') || instructionText.includes('crisp')) {
      visualCues.push('crispy texture');
    }
    if (instructionText.includes('caramelize')) {
      visualCues.push('caramelized golden color');
    }
    if (instructionText.includes('glaze') || instructionText.includes('glazed')) {
      visualCues.push('glossy glaze');
    }
    if (instructionText.includes('melted') || instructionText.includes('bubbly')) {
      visualCues.push('melted bubbly topping');
    }
    if (instructionText.includes('frothy') || instructionText.includes('foam')) {
      visualCues.push('frothy foam');
    }
    if (instructionText.includes('layer')) {
      visualCues.push('visible layers');
    }
    if (instructionText.includes('drizzle')) {
      visualCues.push('artful drizzle');
    }

    const garnishPatterns = [
      /garnish\s+with\s+([^.,;]+)/,
      /top\s+with\s+([^.,;]+)/,
      /sprinkle\s+(?:with\s+)?([^.,;]+)/,
      /finish\s+with\s+([^.,;]+)/,
    ];
    for (const pattern of garnishPatterns) {
      const match = instructionText.match(pattern);
      if (match) {
        const garnish = match[1].trim();
        if (garnish.length < 40 && !garnish.includes('the ') && !garnish.includes('into ')) {
          visualCues.push(`garnished with ${garnish}`);
          break;
        }
      }
    }
  }
  
  let cuisineStyle = '';
  if (context?.cuisines && context.cuisines.length > 0) {
    cuisineStyle = `Authentic ${context.cuisines[0]} presentation.`;
  }
  
  let mealContext = '';
  if (context?.mealType && context.mealType.length > 0) {
    const meal = context.mealType[0].toLowerCase();
    if (meal === 'breakfast') mealContext = 'Morning table setting.';
    else if (meal === 'dessert') mealContext = 'Elegant dessert presentation.';
    else if (meal === 'appetizer') mealContext = 'Sophisticated appetizer plating.';
    else if (meal === 'beverage') mealContext = 'Served in an appropriate glass or cup.';
    else if (['sauce', 'dip', 'marinade', 'rub'].includes(meal)) mealContext = `Presented in a small bowl as a ${meal}.`;
  }
  
  let cookingIndicators = '';
  if (context?.cookingMethods && context.cookingMethods.length > 0) {
    cookingIndicators = `${context.cookingMethods.join(' and ')} preparation.`;
  }
  
  let platingLevel = 'Home-style plating.';
  if (context?.skillLevel) {
    const skill = context.skillLevel.toLowerCase();
    if (skill.includes('advanced')) platingLevel = 'Michelin-star artistic plating.';
    else if (skill.includes('intermediate')) platingLevel = 'Restaurant-style plating.';
  }
  
  const promptParts = [
    `Professional food photograph of the FINISHED, FULLY COOKED ${recipeName}.`,
    cookingIndicators,
    visualCues.length > 0 ? `Appearance: ${visualCues.join(', ')}.` : '',
    cuisineStyle,
    mealContext,
    platingLevel,
    'The dish is fully assembled, cooked, and ready to serve on appropriate dinnerware.',
    'IMPORTANT: Show ONLY the final plated dish. Do NOT show raw ingredients, cutting boards, prep bowls, or cooking process.',
    'Composition: hero shot from 45-degree angle, vibrant appetizing colors.',
    'Lighting: soft natural side lighting with subtle shadows.',
    'Style: Bon Appétit magazine cover quality, photorealistic, shallow depth of field.'
  ];
  
  return promptParts
    .filter(p => p && p.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Generate dish image with a custom prompt (for regeneration with edited prompts)
export async function generateDishImageWithCustomPrompt(
  prompt: string
): Promise<{ buffer: Buffer; prompt: string }> {
  if (!hasOpenAI || !openai) {
    console.warn("OpenAI API key not found - using placeholder image");
    const svg = `<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
      <rect width="1024" height="1024" fill="#f3f4f6"/>
      <text x="512" y="512" font-family="Arial" font-size="24" fill="#9ca3af" text-anchor="middle">AI Image Generation Available with OpenAI API Key</text>
    </svg>`;
    return { buffer: Buffer.from(svg, "utf8"), prompt };
  }

  try {
    console.log(`Generating image with custom prompt: ${prompt.substring(0, 150)}...`);

    const response = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
    });

    const base64 = response.data?.[0]?.b64_json;
    if (!base64) {
      throw new Error("No image data returned from image generation");
    }

    return { buffer: Buffer.from(base64, "base64"), prompt };
  } catch (error) {
    console.error("Error generating dish image with custom prompt:", error);
    throw error;
  }
}

// Export the RecipeImageContext type for external use
export type { RecipeImageContext };
