import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { withPageMeta } from "./page-meta";
import { jsonLdScriptTag } from "@shared/recipe-jsonld";

const INDEX = readFileSync(join(import.meta.dirname, "..", "..", "client", "index.html"), "utf-8");

describe("withPageMeta", () => {
  it("escapes user text in every tag and keeps $ patterns literal", () => {
    const html = withPageMeta(INDEX, {
      title: `Mom's "Best" <script>alert(1)</script> $& Pie | Grammie`,
      description: `Sweet & tart"><img src=x onerror=alert(1)> $1`,
      image: "https://grammie.ai/og-image/recipe/1",
      url: "https://grammie.ai/recipe/1",
      type: "article",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain(`"><img`);
    expect(html).toContain(`<title>Mom&#39;s &quot;Best&quot; &lt;script&gt;alert(1)&lt;/script&gt; $&amp; Pie | Grammie</title>`);
    expect(html).toContain(`<meta property="og:description" content="Sweet &amp; tart&quot;&gt;&lt;img src=x onerror=alert(1)&gt; $1" />`);
    expect(html).toContain(`<meta property="og:type" content="article" />`);
    expect(html).toContain(`<meta property="og:url" content="https://grammie.ai/recipe/1" />`);
  });

  it("adds head markup once, before </head>", () => {
    const tag = jsonLdScriptTag({ "@type": "Recipe", name: "</script>" });
    const html = withPageMeta(INDEX, { title: "A", description: "B", image: "", url: "", type: "article", head: tag });
    expect(html.split("application/ld+json").length).toBe(2);
    expect(html.indexOf(tag)).toBeLessThan(html.indexOf("</head>"));
    expect(html.indexOf(tag)).toBeGreaterThan(0);
  });
});
