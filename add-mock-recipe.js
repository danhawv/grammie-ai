import fs from 'fs';
import { randomUUID } from 'crypto';

const comprehensiveMockRecipe = {
  id: randomUUID(),
  title: "Mediterranean Grilled Salmon with Quinoa and Roasted Vegetables",
  description: "A nutritious, heart-healthy meal combining omega-3 rich salmon with protein-packed quinoa and colorful roasted vegetables. This dish showcases Mediterranean flavors with lemon, garlic, and fresh herbs, perfect for a sophisticated yet accessible dinner.",
  
  prepTime: "20 minutes",
  cookTime: "25 minutes",
  totalTime: "45 minutes",
  coolingTime: "5 minutes",
  prepTimeMinutes: 20,
  cookTimeMinutes: 25,
  totalTimeMinutes: 45,
  
  servings: 4,
  servingUnit: "portions",
  yield: "4 complete dinner plates",
  
  ingredients: [
    "4 6-oz salmon fillets, skin-on",
    "2 cups quinoa, rinsed",
    "3 cups low-sodium vegetable broth",
    "2 large zucchini, cut into 1-inch pieces",
    "2 red bell peppers, cut into strips",
    "1 medium red onion, cut into wedges",
    "1 pint cherry tomatoes, halved",
    "4 cloves garlic, minced",
    "1/3 cup extra virgin olive oil",
    "2 lemons (juice and zest)",
    "2 tablespoons fresh oregano, chopped",
    "2 tablespoons fresh parsley, chopped",
    "1 tablespoon fresh dill, chopped",
    "1 teaspoon sea salt",
    "1/2 teaspoon black pepper",
    "1/4 teaspoon red pepper flakes (optional)",
    "Cooking spray for grill"
  ],
  
  normalizedIngredients: [
    {
      raw: "4 6-oz salmon fillets, skin-on",
      quantity: 4,
      unit: "fillets",
      item: "salmon fillets",
      preparation: "skin-on, 6-oz each",
      isOptional: false,
      isToolOrConsumable: false,
      nutrition: { calories: 180, protein: 25, carbohydrates: 0, fat: 8, fiber: 0 },
      groceryMapping: { name: "Salmon Fillets", aisle: "Seafood", packageSize: "1.5 lbs", category: "Fresh Fish" }
    },
    {
      raw: "2 cups quinoa, rinsed",
      quantity: 2,
      unit: "cups",
      item: "quinoa",
      preparation: "rinsed",
      isOptional: false,
      isToolOrConsumable: false,
      nutrition: { calories: 120, protein: 4, carbohydrates: 21, fat: 2, fiber: 3 },
      groceryMapping: { name: "Quinoa", aisle: "Grains & Rice", packageSize: "1 lb", category: "Whole Grains" }
    },
    {
      raw: "3 cups low-sodium vegetable broth",
      quantity: 3,
      unit: "cups",
      item: "vegetable broth",
      preparation: "low-sodium",
      isOptional: false,
      isToolOrConsumable: false,
      nutrition: { calories: 10, protein: 0, carbohydrates: 2, fat: 0, fiber: 0 },
      groceryMapping: { name: "Low-Sodium Vegetable Broth", aisle: "Soups & Broths", packageSize: "32 oz", category: "Broth" }
    }
  ],
  
  instructions: [
    "Preheat oven to 425°F and lightly oil two large baking sheets",
    "Rinse quinoa under cold water, then combine with vegetable broth in a medium saucepan",
    "Bring quinoa to a boil, reduce heat to low, cover and simmer for 15 minutes until liquid is absorbed",
    "While quinoa cooks, prepare vegetables by cutting zucchini, bell peppers, onion, and halving tomatoes",
    "In a large bowl, toss vegetables with 3 tablespoons olive oil, half the garlic, salt, and pepper",
    "Spread vegetables in a single layer on prepared baking sheets and roast for 20-25 minutes, stirring halfway",
    "Meanwhile, preheat grill or grill pan to medium-high heat (about 400°F)",
    "Pat salmon fillets dry with paper towels and brush both sides with remaining olive oil",
    "Season salmon with lemon zest, remaining garlic, oregano, salt, and pepper",
    "Place salmon skin-side down on the grill and cook for 4-5 minutes without moving",
    "Carefully flip salmon and grill for another 3-4 minutes until internal temperature reaches 145°F",
    "Remove salmon from grill and let rest for 3-5 minutes",
    "Fluff cooked quinoa with a fork and stir in fresh herbs, lemon juice, and a drizzle of olive oil",
    "Plate quinoa as a base, top with roasted vegetables, and place salmon fillet alongside",
    "Garnish with fresh dill and lemon wedges, serve immediately while hot"
  ],
  
  normalizedInstructions: [
    {
      stepNumber: 1,
      text: "Preheat oven to 425°F and lightly oil two large baking sheets",
      ingredients: [],
      tools: ["Oven", "2 large baking sheets", "Cooking spray"],
      timeMinutes: 10,
      temperature: { value: 425, scale: "F" },
      stepType: "preheat"
    },
    {
      stepNumber: 2,
      text: "Rinse quinoa under cold water, then combine with vegetable broth in a medium saucepan",
      ingredients: ["quinoa", "vegetable broth"],
      tools: ["Medium saucepan"],
      timeMinutes: 2,
      stepType: "prep"
    },
    {
      stepNumber: 10,
      text: "Place salmon skin-side down on the grill and cook for 4-5 minutes without moving",
      ingredients: ["salmon fillets"],
      tools: ["Grill", "Tongs"],
      timeMinutes: 5,
      timeRange: { min: 4, max: 5 },
      temperature: { value: 400, scale: "F" },
      stepType: "cook",
      donenessCue: "Salmon develops grill marks and releases easily from grates"
    }
  ],
  
  skillLevel: "Intermediate",
  skillLevelExplanation: "Requires managing multiple cooking methods simultaneously (grilling, roasting, simmering) and proper fish grilling technique to avoid overcooking. Timing coordination is important but forgiving.",
  
  isVegetarian: false,
  isVegan: false,
  isPescatarian: true,
  isGlutenFree: true,
  isDairyFree: true,
  isKeto: false,
  isPaleo: false,
  isLowCarb: false,
  isHighProtein: true,
  isLowCalorie: false,
  isHighFiber: true,
  isLactoVegetarian: false,
  isMediterranean: true,
  isOvoVegetarian: false,
  isOvoLactoVegetarian: false,
  isFlexitarian: true,
  isCarnivore: false,
  isKosher: false,
  isHalal: false,
  isHindu: false,
  
  isLowFat: false,
  isLowSodium: true,
  isLowSugar: true,
  
  allergens: ["Fish"],
  allergenFreeTags: ["Shellfish-Free", "Gluten-Free", "Dairy-Free", "Peanut-Free", "Tree Nut-Free", "Soy-Free", "Egg-Free", "Sesame-Free", "Mustard-Free", "Sulfite-Free"],
  
  cuisines: ["Mediterranean", "Greek", "Middle Eastern", "European"],
  cuisine: "Mediterranean",
  
  mealType: ["Dinner", "Main Course", "Lunch"],
  dietType: ["Pescatarian", "Mediterranean", "Gluten-Free", "Dairy-Free"],
  cookingMethods: ["Grilling", "Roasting", "Simmering"],
  seasonTags: ["Summer", "Spring", "Year-Round"],
  occasionTags: ["Date Night", "Weeknight Dinner", "Healthy Eating", "Meal Prep"],
  
  timeConvenienceTags: ["Under 1 hour"],
  
  calories: 520,
  protein: 42.5,
  carbohydrates: 48.0,
  fat: 18.5,
  fiber: 8.2,
  sugar: 6.5,
  sodium: 380,
  cholesterol: 85,
  
  healthScore: 92,
  totalCost: 28.50,
  costExcludingStaples: 22.00,
  priceCategory: "Moderate",
  
  equipment: ["Grill or grill pan", "Oven", "2 large baking sheets", "Medium saucepan with lid", "Large mixing bowl", "Cutting board", "Sharp knife", "Tongs", "Basting brush", "Fork"],
  standardEquipment: ["Cutting board", "Sharp knife", "Large mixing bowl", "Medium saucepan with lid", "Fork", "Tongs"],
  specializedEquipment: ["Grill or grill pan", "2 large baking sheets", "Basting brush"],
  groceryAisleTags: ["Seafood", "Grains & Rice", "Produce", "Oils & Vinegars", "Spices & Herbs"],
  
  tips: [
    {
      type: "technique",
      text: "Pat salmon completely dry before grilling to achieve crispy skin and prevent sticking"
    },
    {
      type: "storage",
      text: "Store leftovers in separate containers (salmon, quinoa, vegetables) for up to 3 days"
    },
    {
      type: "makeAhead",
      text: "Roast vegetables and cook quinoa up to 2 days ahead; grill salmon fresh for best results"
    },
    {
      type: "serving",
      text: "Pair with a crisp white wine like Sauvignon Blanc or a light rosé"
    }
  ],
  
  variations: [
    {
      type: "protein",
      title: "Chicken Alternative",
      description: "Substitute grilled chicken breast for salmon, adjusting cook time to 6-8 minutes per side"
    },
    {
      type: "ingredient",
      title: "Grain Swap",
      description: "Use brown rice, farro, or couscous instead of quinoa"
    },
    {
      type: "flavor",
      title: "Asian Fusion",
      description: "Replace lemon and oregano with ginger, soy sauce, and sesame oil for an Asian-inspired version"
    }
  ],
  
  servingSuggestions: [
    "Serve with a side of tzatziki sauce for dipping",
    "Garnish with crumbled feta cheese (if not dairy-free)",
    "Add a Greek salad on the side for a complete Mediterranean feast"
  ],
  
  validationWarnings: [],
  
  enrichmentStatus: "ready",
  aiEnriched: true,
  aiEnrichmentFields: ["normalizedIngredients", "normalizedInstructions", "skillLevel", "dietaryFlags", "allergens", "nutrition", "healthScore", "cost", "tips", "variations"],
  enrichmentRetryCount: 0,
  createdAt: new Date().toISOString()
};

// Read existing recipes
const data = JSON.parse(fs.readFileSync('recipes-data.json', 'utf8'));

// Add recipe using its ID as the key
data.recipes[comprehensiveMockRecipe.id] = comprehensiveMockRecipe;

// Write back
fs.writeFileSync('recipes-data.json', JSON.stringify(data, null, 2));

console.log('Added comprehensive mock recipe with ID:', comprehensiveMockRecipe.id);
console.log('Title:', comprehensiveMockRecipe.title);
