import { describe, expect, it } from "vitest";
import {
  CREDIT_COSTS, CREDIT_PACKS, WELCOME_CREDITS, MONTHLY_FREE_CREDITS, formatCredits, formatPrice,
  historyLabel, monthKey, needCreditsMessage, packByAppleProduct, packById,
} from "./credits";

describe("credits config", () => {
  it("has the agreed packs, prices and App Store ids", () => {
    expect(CREDIT_PACKS.map((p) => [p.id, p.priceCents, p.credits])).toEqual([
      ["starter", 499, 40], ["family", 999, 90], ["cookbook", 1999, 200], ["heirloom", 4999, 550],
    ]);
    for (const p of CREDIT_PACKS) {
      expect(packById(p.id)).toBe(p);
      expect(packByAppleProduct(`ai.grammie.app.credits.${p.id}`)).toBe(p);
    }
    expect(packById("gold")).toBeUndefined();
  });

  it("has the agreed costs and free allowance", () => {
    expect(CREDIT_COSTS).toEqual({ recipe_import: 1, dish_photo: 1, meal_prep_plan: 2 });
    expect(WELCOME_CREDITS).toBe(50);
    expect(MONTHLY_FREE_CREDITS).toBe(3);
  });

  it("formats plainly", () => {
    expect(formatCredits(1)).toBe("1 credit");
    expect(formatCredits(40)).toBe("40 credits");
    expect(formatPrice(499)).toBe("$4.99");
    expect(monthKey(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
    expect(needCreditsMessage("meal_prep_plan", 1)).toBe("A new meal-prep plan uses 2 credits, and you have 1 credit left. Add credits to keep going.");
    expect(historyLabel("purchase", { pack: "family" })).toBe("Family pack");
    expect(historyLabel("spend", { action: "dish_photo" })).toBe("New dish photo");
  });
});
