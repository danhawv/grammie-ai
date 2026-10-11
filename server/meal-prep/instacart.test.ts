import { describe, it, expect } from "vitest";
import { createInstacartClient, instacartConfig, instacartLineItems, INSTACART_PRODUCTION } from "./instacart";
import { FakeSessionBuilder, planFrom, sampleSetup } from "./testing/fakes";

describe("Instacart", () => {
  it("is off without an API key", () => {
    expect(instacartConfig({})).toBeNull();
    expect(instacartConfig({ INSTACART_API_KEY: "k" })).toEqual({ apiKey: "k", baseUrl: INSTACART_PRODUCTION });
  });

  it("sends what's left to buy as a shopping_list products link", async () => {
    const shopping = await new FakeSessionBuilder().shopping(planFrom(sampleSetup(), ["r1"], 80));
    const items = instacartLineItems(shopping);
    expect(items).toEqual([{ name: "sour cream", display_text: "sour cream, 1 tub (16 oz)", line_item_measurements: [{ quantity: 480, unit: "gram" }] }]);

    let seen: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ products_link_url: "https://www.instacart.com/store/shopping_lists/1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createInstacartClient({ apiKey: "secret", baseUrl: "https://connect.dev.instacart.tools" }, fakeFetch);
    expect(await client({ title: "Meal prep", items })).toBe("https://www.instacart.com/store/shopping_lists/1");
    expect(seen!.url).toBe("https://connect.dev.instacart.tools/idp/v1/products/products_link");
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    const body = JSON.parse(String(seen!.init.body));
    expect(body).toMatchObject({ title: "Meal prep", link_type: "shopping_list", line_items: items });
  });

  it("fails on errors and odd answers", async () => {
    const bad = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    await expect(createInstacartClient({ apiKey: "k", baseUrl: "x" }, bad)({ title: "t", items: [] })).rejects.toThrow(/401/);
    const odd = (async () => new Response(JSON.stringify({ products_link_url: "javascript:alert(1)" }), { status: 200 })) as unknown as typeof fetch;
    await expect(createInstacartClient({ apiKey: "k", baseUrl: "x" }, odd)({ title: "t", items: [] })).rejects.toThrow(/link/);
  });
});
