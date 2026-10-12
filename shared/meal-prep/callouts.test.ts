import { describe, expect, it } from "vitest";
import { bottles, deltaText, productName, shakeText, swapChip, swapLabelNote, swapUseText } from "./callouts";

describe("swap words", () => {
  it("names the kind of swap for chips and labels", () => {
    expect(swapChip("lighter")).toBe("Lighter swap");
    expect(swapChip("protein")).toBe("More protein swap");
    expect(swapLabelNote({ goal: "lighter", title: "Greek yogurt instead of sour cream" })).toBe("Made lighter: Greek yogurt instead of sour cream");
  });

  it("says what a swap did per serving", () => {
    expect(deltaText({ kcal: -94, protein: 14 })).toBe("+14 g protein, 95 fewer calories per serving");
    expect(deltaText({ kcal: 0, protein: 0 })).toBe("about the same numbers");
  });

  it("tells the cook what to use, scaled", () => {
    const change = { lineIndex: 2, from: "1 cup sour cream", to: { id: "gy", name: "Nonfat Greek yogurt", aisle: "Dairy & Eggs" as const }, toGrams: 245, toDisplay: "1 cup nonfat Greek yogurt" };
    expect(swapUseText(change, 1, "Sour cream")).toBe("Use nonfat Greek yogurt instead of sour cream (1 cup)");
    expect(swapUseText(change, 2, null)).toBe("Use nonfat Greek yogurt instead of sour cream (2⅛ cups, 490 g)");
  });
});

describe("shakes", () => {
  const shake = { id: "s", name: "Protein shake", topUp: "shake" as const, product: "Fairlife Core Power 26g", unitGrams: 414, proteinPerUnit: 26 };
  it("counts whole bottles and names the product without the grams", () => {
    expect(bottles(414, 414)).toBe(1);
    expect(bottles(800, 414)).toBe(2);
    expect(productName(shake)).toBe("Fairlife Core Power");
    expect(shakeText(shake, 414)).toBe("1 bottle Fairlife Core Power (26 g protein)");
    expect(shakeText(shake, 828)).toBe("2 bottles Fairlife Core Power (26 g protein each)");
  });
});
