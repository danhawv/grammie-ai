// Instacart Developer Platform "products link" (link_type shopping_list):
// POST {base}/idp/v1/products/products_link with a Bearer API key returns
// {products_link_url}, a page where the family picks a store and fills a
// cart. Off unless INSTACART_API_KEY is set. Docs:
// https://docs.instacart.com/developer_platform_api/api/products/create_shopping_list_page

import type { ShoppingList } from "@shared/meal-prep/contract";

export const INSTACART_PRODUCTION = "https://connect.instacart.com";
export const INSTACART_DEVELOPMENT = "https://connect.dev.instacart.tools";

export interface InstacartLineItem {
  name: string;
  display_text: string;
  line_item_measurements: Array<{ quantity: number; unit: string }>;
}

/** What's left to buy, in the units Instacart matches on (grams or each) */
export function instacartLineItems(shopping: ShoppingList): InstacartLineItem[] {
  const items: InstacartLineItem[] = [];
  for (const group of shopping.byAisle) {
    for (const item of group.items) {
      if (item.have) continue;
      const grams = item.neededGrams != null && item.neededGrams > 0 ? Math.ceil(item.neededGrams) : null;
      items.push({
        name: item.ingredient.name,
        display_text: item.buy ? `${item.ingredient.name}, ${item.buy}` : `${item.ingredient.name}, ${item.display}`,
        line_item_measurements: [grams ? { quantity: grams, unit: "gram" } : { quantity: 1, unit: "each" }],
      });
    }
  }
  return items;
}

export interface InstacartConfig {
  apiKey: string;
  baseUrl: string;
}

/** null = not configured (the route answers 501) */
export function instacartConfig(env: NodeJS.ProcessEnv = process.env): InstacartConfig | null {
  if (!env.INSTACART_API_KEY) return null;
  return { apiKey: env.INSTACART_API_KEY, baseUrl: env.INSTACART_API_BASE || INSTACART_PRODUCTION };
}

export type InstacartClient = (request: {
  title: string;
  items: InstacartLineItem[];
  linkbackUrl?: string;
}) => Promise<string>;

export function createInstacartClient(config: InstacartConfig, fetchImpl: typeof fetch = fetch): InstacartClient {
  return async ({ title, items, linkbackUrl }) => {
    const res = await fetchImpl(`${config.baseUrl}/idp/v1/products/products_link`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        title,
        link_type: "shopping_list",
        expires_in: 14,
        line_items: items,
        ...(linkbackUrl ? { landing_page_configuration: { partner_linkback_url: linkbackUrl } } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Instacart answered ${res.status}`);
    const body = await res.json() as { products_link_url?: unknown };
    if (typeof body.products_link_url !== "string" || !/^https:\/\//.test(body.products_link_url)) {
      throw new Error("Instacart didn't return a link");
    }
    return body.products_link_url;
  };
}
