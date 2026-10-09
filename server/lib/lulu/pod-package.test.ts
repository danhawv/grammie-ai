import { describe, it, expect } from "vitest";
import { buildPodPackageId, unsupportedBookReason } from "./pod-package";

const base = { trimSize: "0600X0900", colorType: "FC", printQuality: "STD", bindingType: "PB", paperType: "080CW444", coverFinish: "M", linenColor: "X", foilType: "X" } as const;

describe("Lulu product codes", () => {
  it("uses premium color for full-color saddle stitch (Lulu has no standard one)", () => {
    expect(buildPodPackageId({ ...base, bindingType: "SS" } as any)).toBe("0600X0900FCPRESS080CW444MXX");
    expect(buildPodPackageId({ ...base, bindingType: "SS", colorType: "BW" } as any)).toBe("0600X0900BWSTDSS080CW444MXX");
  });
  it("refuses combinations Lulu doesn't make", () => {
    expect(unsupportedBookReason({ ...base, paperType: "060UC444" } as any)).toMatch(/Cream paper/);
    expect(unsupportedBookReason({ ...base, colorType: "BW", paperType: "060UC444" } as any)).toBeNull();
    expect(unsupportedBookReason({ ...base, bindingType: "LW", paperType: "060UW444" } as any)).toMatch(/Linen/);
    expect(unsupportedBookReason(base as any)).toBeNull();
  });
});
