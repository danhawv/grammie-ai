import { describe, expect, it } from "vitest";
import { stepFromParam } from "../components/print/types";

describe("stepFromParam", () => {
  it("accepts the four steps", () => {
    expect(stepFromParam("book")).toBe("book");
    expect(stepFromParam("order")).toBe("order");
  });

  it("maps the old five-step names so saved links and Stripe's return still work", () => {
    expect(stepFromParam("recipes")).toBe("pages");
    expect(stepFromParam("look")).toBe("book");
    expect(stepFromParam("personalize")).toBe("cover");
    expect(stepFromParam("review")).toBe("order");
  });

  it("ignores anything else", () => {
    expect(stepFromParam("nope")).toBeNull();
    expect(stepFromParam(null)).toBeNull();
  });
});
