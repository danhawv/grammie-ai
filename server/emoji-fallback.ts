/**
 * Deterministic emoji fallback mapping for common ingredients
 * Used when AI enrichment doesn't provide emojis or needs validation
 */

export const INGREDIENT_EMOJI_MAP: Record<string, string> = {
  // Proteins
  "chicken": "🐔",
  "beef": "🥩",
  "pork": "🥓",
  "lamb": "🐑",
  "turkey": "🦃",
  "duck": "🦆",
  "salmon": "🐟",
  "tuna": "🐟",
  "shrimp": "🦐",
  "lobster": "🦞",
  "crab": "🦀",
  "fish": "🐠",
  "bacon": "🥓",
  "sausage": "🌭",
  "ham": "🍖",
  "steak": "🥩",
  "egg": "🥚",
  "eggs": "🥚",
  
  // Vegetables
  "tomato": "🍅",
  "tomatoes": "🍅",
  "onion": "🧅",
  "onions": "🧅",
  "garlic": "🧄",
  "carrot": "🥕",
  "carrots": "🥕",
  "potato": "🥔",
  "potatoes": "🥔",
  "bell pepper": "🫑",
  "pepper": "🌶️",
  "peppers": "🌶️",
  "chili": "🌶️",
  "broccoli": "🥦",
  "cauliflower": "🥬",
  "lettuce": "🥬",
  "spinach": "🥬",
  "kale": "🥬",
  "cabbage": "🥬",
  "cucumber": "🥒",
  "eggplant": "🍆",
  "zucchini": "🥒",
  "corn": "🌽",
  "peas": "🫛",
  "mushroom": "🍄",
  "mushrooms": "🍄",
  "avocado": "🥑",
  
  // Fruits
  "apple": "🍎",
  "apples": "🍎",
  "banana": "🍌",
  "bananas": "🍌",
  "orange": "🍊",
  "oranges": "🍊",
  "lemon": "🍋",
  "lemons": "🍋",
  "lime": "🍋",
  "limes": "🍋",
  "strawberry": "🍓",
  "strawberries": "🍓",
  "blueberry": "🫐",
  "blueberries": "🫐",
  "grape": "🍇",
  "grapes": "🍇",
  "watermelon": "🍉",
  "peach": "🍑",
  "peaches": "🍑",
  "cherry": "🍒",
  "cherries": "🍒",
  "pineapple": "🍍",
  "mango": "🥭",
  "coconut": "🥥",
  "kiwi": "🥝",
  
  // Dairy
  "milk": "🥛",
  "cheese": "🧀",
  "butter": "🧈",
  "cream": "🥛",
  "yogurt": "🥛",
  "ice cream": "🍦",
  
  // Grains & Bread
  "bread": "🍞",
  "rice": "🍚",
  "pasta": "🍝",
  "noodles": "🍜",
  "flour": "🌾",
  "wheat": "🌾",
  "oats": "🌾",
  "quinoa": "🌾",
  "bagel": "🥯",
  "croissant": "🥐",
  "tortilla": "🫓",
  
  // Legumes & Nuts
  "peanut": "🥜",
  "peanuts": "🥜",
  "almond": "🌰",
  "almonds": "🌰",
  "walnut": "🌰",
  "walnuts": "🌰",
  "cashew": "🥜",
  "cashews": "🥜",
  "pistachio": "🥜",
  "pistachios": "🥜",
  "bean": "🫘",
  "beans": "🫘",
  "lentil": "🫘",
  "lentils": "🫘",
  
  // Herbs & Spices
  "basil": "🌿",
  "parsley": "🌿",
  "cilantro": "🌿",
  "mint": "🌿",
  "rosemary": "🌿",
  "thyme": "🌿",
  "oregano": "🌿",
  "sage": "🌿",
  "dill": "🌿",
  "chives": "🌿",
  "ginger": "🫚",
  "cinnamon": "🌰",
  "vanilla": "🌰",
  
  // Condiments & Sauces
  "salt": "🧂",
  "sugar": "🍚",
  "honey": "🍯",
  "oil": "🛢️",
  "olive oil": "🫒",
  "vinegar": "🍶",
  "soy sauce": "🥫",
  "ketchup": "🍅",
  "mustard": "🌭",
  "mayonnaise": "🥫",
  "hot sauce": "🌶️",
  
  // Beverages
  "water": "💧",
  "wine": "🍷",
  "beer": "🍺",
  "coffee": "☕",
  "tea": "🍵",
  "juice": "🧃",
  
  // Baking
  "chocolate": "🍫",
  "cocoa": "🍫",
  "baking powder": "🥄",
  "baking soda": "🥄",
  "yeast": "🥄",
  
  // Other
  "tofu": "🧈",
  "seaweed": "🌿",
  "pickle": "🥒",
  "pickles": "🥒",
  "olive": "🫒",
  "olives": "🫒",
  "capers": "🫒",
};

/**
 * Get emoji for an ingredient with fallback logic
 * @param ingredientName - The ingredient name (from normalizedIngredient.item)
 * @param aiProvidedEmoji - Optional emoji from AI enrichment
 * @returns Single emoji character or empty string
 */
export function getIngredientEmoji(ingredientName: string, aiProvidedEmoji?: string): string {
  // If AI provided a valid emoji, use it
  if (aiProvidedEmoji && isValidEmoji(aiProvidedEmoji)) {
    return aiProvidedEmoji;
  }
  
  // Normalize ingredient name for lookup (lowercase, trim)
  const normalized = ingredientName.toLowerCase().trim();
  
  // Direct match
  if (INGREDIENT_EMOJI_MAP[normalized]) {
    return INGREDIENT_EMOJI_MAP[normalized];
  }
  
  // Try to find partial match (e.g., "red onion" contains "onion")
  for (const [key, emoji] of Object.entries(INGREDIENT_EMOJI_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return emoji;
    }
  }
  
  // No match found - return empty string
  return "";
}

/**
 * Validate that a string is a single emoji character
 * @param str - String to validate
 * @returns true if the string is a single emoji
 */
export function isValidEmoji(str: string): boolean {
  if (!str || str.length === 0) return false;
  
  // Simple validation: check if string is short (1-4 chars for emoji variations)
  // and contains common emoji patterns
  if (str.length > 8) return false;
  
  // Check if it's in common emoji ranges (simplified check)
  const codePoint = str.codePointAt(0);
  if (!codePoint) return false;
  
  // Common emoji ranges
  const isEmoji = (
    (codePoint >= 0x1F300 && codePoint <= 0x1F9FF) || // Misc Symbols and Pictographs
    (codePoint >= 0x2600 && codePoint <= 0x26FF) ||   // Misc symbols
    (codePoint >= 0x2700 && codePoint <= 0x27BF) ||   // Dingbats
    (codePoint >= 0x1F600 && codePoint <= 0x1F64F) || // Emoticons
    (codePoint >= 0x1F680 && codePoint <= 0x1F6FF) || // Transport
    (codePoint >= 0x1F900 && codePoint <= 0x1F9FF) || // Supplemental Symbols
    (codePoint >= 0x1FA00 && codePoint <= 0x1FA6F)    // Extended symbols
  );
  
  return isEmoji;
}

/**
 * Apply emoji fallback to all ingredients in a recipe
 * @param ingredients - Array of normalized ingredients
 * @returns Array with emoji field populated for all ingredients
 */
export function applyEmojiDefaults<T extends { item: string; emoji?: string }>(
  ingredients: T[]
): T[] {
  return ingredients.map(ingredient => ({
    ...ingredient,
    emoji: getIngredientEmoji(ingredient.item, ingredient.emoji),
  }));
}
