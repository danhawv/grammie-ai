import { describe, expect, it } from "vitest";
import { appliancesIn, normalizeAppliance } from "./equipment";

describe("appliance names", () => {
  it("normalizes spellings the walkthrough and recipes use", () => {
    expect(normalizeAppliance("Instant Pot")).toBe("instant pot");
    expect(normalizeAppliance("6-qt pressure cooker")).toBe("instant pot");
    expect(normalizeAppliance("Slow cooker")).toBe("slow cooker");
    expect(normalizeAppliance("Crock-Pot")).toBe("slow cooker");
    expect(normalizeAppliance("Air Fryer")).toBe("air fryer");
    expect(normalizeAppliance("Rice cooker")).toBe("rice cooker");
    expect(normalizeAppliance("Outdoor grill")).toBe("grill");
    expect(normalizeAppliance("High-speed blender")).toBe("blender");
  });

  it("never counts basic kitchen gear", () => {
    for (const t of ["Oven", "stove", "Skillet", "Large pot", "Dutch oven", "Grill pan", "Pastry blender", "Baking sheet", "Wok", "Broiler"]) {
      expect(normalizeAppliance(t)).toBeNull();
    }
  });

  it("lists distinct kinds in a fixed order", () => {
    expect(appliancesIn(["Blender", "Slow Cooker", "blender", null, "Knife"])).toEqual(["slow cooker", "blender"]);
  });
});
