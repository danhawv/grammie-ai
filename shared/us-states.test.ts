import { describe, it, expect } from "vitest";
import { normalizeUsState } from "./us-states";

describe("normalizeUsState", () => {
  it("accepts codes in any case and full names", () => {
    expect(normalizeUsState("oh")).toBe("OH");
    expect(normalizeUsState(" Ohio ")).toBe("OH");
    expect(normalizeUsState("new  york")).toBe("NY");
    expect(normalizeUsState("D.C.")).toBe("DC");
  });
  it("rejects unknown input", () => {
    expect(normalizeUsState("")).toBeNull();
    expect(normalizeUsState("ZZ")).toBeNull();
    expect(normalizeUsState("Ontario")).toBeNull();
  });
});
