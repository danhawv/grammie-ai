import { describe, expect, it } from "vitest";
import { parseModelJson } from "./model-json";

describe("parseModelJson", () => {
  it("reads a bare array (cutting at { and } used to break these)", () => {
    expect(parseModelJson('[{"raw":"1 egg"},{"raw":"2 cups flour"}]')).toHaveLength(2);
  });

  it("reads an object", () => {
    expect(parseModelJson('{"normalizedIngredients":[{"raw":"1 egg"}]}').normalizedIngredients).toHaveLength(1);
  });

  it("cuts JSON out of surrounding text", () => {
    expect(parseModelJson('Here you go:\n[{"a":1},{"a":2}]\nDone')).toEqual([{ a: 1 }, { a: 2 }]);
    expect(parseModelJson('Sure! {"a":{"b":1}} hope that helps')).toEqual({ a: { b: 1 } });
  });

  it("throws when there's no JSON", () => {
    expect(() => parseModelJson("no json here")).toThrow();
  });
});
