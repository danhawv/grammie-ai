import { describe, expect, it } from "vitest";
import { mealPrepFit } from "./prep-fit";
import type { StorageRecipe } from "./facts";

const line = (quantity: number, unit: string, item: string) => ({ raw: `${quantity} ${unit} ${item}`, quantity, unit, item });
const recipe = (over: Partial<StorageRecipe> & { title: string }): StorageRecipe =>
  ({ normalizedIngredients: [], mealType: ["Dinner"], cookingMethods: ["Simmering"], tips: [], ...over });

describe("mealPrepFit", () => {
  it("chili: friendly, keeps 4 days, freezes", () => {
    const fit = mealPrepFit(recipe({
      title: "Hearty Beef and Bean Chili", mealType: ["Dinner", "Lunch"], cookingMethods: ["Browning", "Simmering", "Slow Cooking"],
      normalizedIngredients: [line(2, "lb", "ground beef"), line(2, "can", "black beans"), line(1, "can", "diced tomatoes")],
    }));
    expect(fit).toEqual({ friendly: true, keepsDays: 4, freezes: true, note: "keeps 4 days in the fridge · freezes well" });
  });

  it("smash burger: not (built to eat right away)", () => {
    const fit = mealPrepFit(recipe({ title: "Smash Burgers", cookingMethods: ["Searing", "Toasting"], normalizedIngredients: [line(1, "lb", "ground beef")] }));
    expect(fit.friendly).toBe(false);
    expect(fit.note).toMatch(/^best eaten fresh · build it right before eating$/);
  });

  it("fried chicken tenders: not (lose their crunch), even air-fried", () => {
    const fit = mealPrepFit(recipe({ title: "Lemon Garlic Chicken Tenders", mealType: ["Dinner", "Snack"], cookingMethods: ["Air Frying", "Marinating"], normalizedIngredients: [line(1, "lb", "chicken breast")] }));
    expect(fit.friendly).toBe(false);
    expect(fit.note).toBe("best eaten fresh · fried foods lose their crunch");
    expect(mealPrepFit(recipe({ title: "Buttermilk Fried Chicken", cookingMethods: ["Frying"] })).friendly).toBe(false);
  });

  it("overnight oats: friendly 4 days, doesn't freeze", () => {
    const fit = mealPrepFit(recipe({
      title: "Peanut Butter Overnight Oats", mealType: ["Breakfast"], cookingMethods: ["No-Cook", "Mixing", "Chilling"],
      normalizedIngredients: [line(1, "cup", "rolled oats"), line(1, "cup", "greek yogurt"), line(1, "cup", "milk")],
      tips: [{ type: "storage", text: "Keeps in the fridge up to 4 days. Do not freeze." }],
    }));
    expect(fit).toEqual({ friendly: true, keepsDays: 4, freezes: false, note: "keeps 4 days in the fridge · doesn't freeze" });
  });

  it("protein ice cream and smoothies: not", () => {
    expect(mealPrepFit(recipe({ title: "Rocky Road Protein Ice Cream", mealType: [], cookingMethods: [] })).note).toBe("best eaten fresh · frozen treats don't keep as a meal");
    expect(mealPrepFit(recipe({ title: "Berry Protein Smoothie", mealType: ["Breakfast"], cookingMethods: ["Blending"] })).note).toBe("best eaten fresh · drinks are best made fresh");
    expect(mealPrepFit(recipe({ title: "Morning Glow", mealType: ["Beverage"], cookingMethods: ["Blending"] })).friendly).toBe(false);
  });

  it("a green salad wilts; a chicken salad keeps", () => {
    const greens = mealPrepFit(recipe({
      title: "Spinach & Strawberry Salad", mealType: ["Salad"], cookingMethods: ["Whisking", "No-Cook"],
      normalizedIngredients: [line(5, "oz", "spinach"), line(1, "cup", "strawberries")],
    }));
    expect(greens).toMatchObject({ friendly: false, note: "best eaten fresh · dressed greens go limp by the next day" });
    const chicken = mealPrepFit(recipe({
      title: "Shredded Chicken Salad", mealType: ["Lunch"], cookingMethods: ["No-cook", "Mixing"],
      normalizedIngredients: [line(2, "cup", "chicken breast"), line(2, "tbsp", "mayonnaise")],
    }));
    expect(chicken).toMatchObject({ friendly: true, keepsDays: 3, freezes: false });
  });

  it("sauces, dips, snacks, breads and desserts aren't meals; a dinner that happens to be tagged 'sauce' is", () => {
    expect(mealPrepFit(recipe({ title: "Volcano Sauce", mealType: ["Sauce", "Dip"], cookingMethods: ["No-Cook", "Mixing"] })).note).toBe("best eaten fresh · a side, not a meal");
    expect(mealPrepFit(recipe({ title: "Fudgy Brownies", mealType: ["Dessert"], cookingMethods: ["Baking"] })).note).toBe("best eaten fresh · a treat, not a meal");
    expect(mealPrepFit(recipe({ title: "Spicy Pecans", mealType: [], cookingMethods: ["Toasting"] })).note).toBe("best eaten fresh · a side, not a meal");
    expect(mealPrepFit(recipe({ title: "Crack Dip", mealType: [], cookingMethods: ["Baking"] })).friendly).toBe(false);
    expect(mealPrepFit(recipe({ title: "Energy Balls", mealType: ["Snack"], cookingMethods: ["No-Cook"] })).note).toBe("best eaten fresh · a snack, not a meal");
    expect(mealPrepFit(recipe({ title: "Spicy Peanut Sauce", mealType: ["Dinner", "Sauce"], cookingMethods: ["Simmering"] })).friendly).toBe(false);
    expect(mealPrepFit(recipe({ title: "Nonna's Bolognese", mealType: ["Sauce", "Dinner"], cookingMethods: ["Simmering"] })).friendly).toBe(true);
    expect(mealPrepFit(recipe({ title: "Pumpkin Bread", mealType: [], cookingMethods: ["Baking"] })).friendly).toBe(false);
    expect(mealPrepFit(recipe({ title: "Protein Raspberry Cheesecake", mealType: ["Snack"], cookingMethods: ["Baking", "Chilling"] })).note).toBe("best eaten fresh · a treat, not a meal");
    expect(mealPrepFit(recipe({ title: "Chili Pie", mealType: [], cookingMethods: ["Baking"] })).friendly).toBe(true);
    expect(mealPrepFit(recipe({ title: "Egg Muffins", mealType: ["Breakfast"], cookingMethods: ["Baking"] })).friendly).toBe(true);
    // Unknown tags don't count against it
    expect(mealPrepFit(recipe({ title: "Smoked Beef Short Rib Pastrami", mealType: ["Entertaining"], cookingMethods: ["Smoking", "Resting"] })).friendly).toBe(true);
  });

  it("pan-frying, searing and a crisped finish on a braise are fine; only a fried crust isn't", () => {
    expect(mealPrepFit(recipe({ title: "Spicy Lamb Meatballs", cookingMethods: ["Mixing", "Pan-searing", "Pan-frying"] })).friendly).toBe(true);
    expect(mealPrepFit(recipe({ title: "Roasted Vegetables", mealType: ["Side Dish", "Dinner"], cookingMethods: ["Roasting", "Air Frying", "Tossing"] })).friendly).toBe(true);
    expect(mealPrepFit(recipe({ title: "Instant Pot Duck Carnitas", cookingMethods: ["Pressure Cook", "Slow Cook", "Crisp"] })).friendly).toBe(true);
    expect(mealPrepFit(recipe({ title: "Honey Pistachio Brie Bites", mealType: [], cookingMethods: ["Air Frying", "Pan-Frying"] })).friendly).toBe(false);
    expect(mealPrepFit(recipe({ title: "Cocktail Olives", mealType: ["Appetizer"], cookingMethods: ["Marinating"] })).note).toBe("best eaten fresh · a side, not a meal");
  });

  it("respects a 'best eaten fresh' tip and short fridge windows", () => {
    expect(mealPrepFit(recipe({ title: "Baked Cod", tips: [{ type: "serving", text: "Best served immediately." }] })).friendly).toBe(false);
    expect(mealPrepFit(recipe({ title: "Pan Roasted Salmon", cookingMethods: ["Roasting"], tips: [{ type: "storage", text: "Keeps for 2 days in the fridge." }] })).note).toBe("best eaten fresh · keeps 2 days in the fridge");
    expect(mealPrepFit(recipe({ title: "Salmon Tartare", cookingMethods: ["No-Cook"] })).note).toBe("best eaten fresh · raw fish is for the day it's made");
  });

  it("judges an untagged recipe by title and methods alone", () => {
    expect(mealPrepFit({ title: "Smoked Beef and Brisket Chili", normalizedIngredients: null, mealType: null, cookingMethods: ["Simmering"], tips: null })).toMatchObject({ friendly: true, keepsDays: 4, freezes: true });
  });
});
