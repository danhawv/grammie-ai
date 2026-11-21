import { describe, expect, it } from "vitest";
import { inAppPath } from "./app-links";

describe("inAppPath", () => {
  it("turns grammie.ai links into app routes", () => {
    expect(inAppPath("https://grammie.ai/recipe/12")).toBe("/recipe/12");
    expect(inAppPath("https://www.grammie.ai/cookbook/3/print-editor?step=order&order=9")).toBe(
      "/cookbook/3/print-editor?step=order&order=9",
    );
  });

  it("turns grammie:// links into app routes", () => {
    expect(inAppPath("grammie://share")).toBe("/share");
    expect(inAppPath("grammie://sso-callback?rotating_token_nonce=abc")).toBe("/sso-callback?rotating_token_nonce=abc");
    expect(inAppPath("grammie://recipe/5")).toBe("/recipe/5");
  });

  it("ignores other sites and nonsense", () => {
    expect(inAppPath("https://example.com/recipe/1")).toBeNull();
    expect(inAppPath("http://grammie.ai/recipe/1")).toBeNull();
    expect(inAppPath("not a url")).toBeNull();
  });
});
