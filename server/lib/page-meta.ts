import { escapeHtml } from "@shared/recipe-jsonld";

// Server-rendered link previews: the public recipe and cookbook pages send
// index.html with their own title, description and image (server/routes/social.ts).

export interface PageMeta {
  title: string;
  description: string;
  image: string;
  url: string;
  type: 'website' | 'article';
  /** Extra markup for <head>, already safe (e.g. a JSON-LD script tag) */
  head?: string;
}

/**
 * Puts a page's own title, description and preview image into index.html.
 * Every value is HTML-escaped (recipe and cookbook text is user-written), and
 * replacements use a function so "$&" and friends in the text stay literal.
 */
export function withPageMeta(html: string, meta: PageMeta): string {
  const title = escapeHtml(meta.title);
  const ogDescription = escapeHtml(meta.description.substring(0, 200));
  const description = escapeHtml(meta.description.substring(0, 160));
  const image = escapeHtml(meta.image);
  const url = escapeHtml(meta.url);
  const set = (pattern: RegExp, tag: string) => {
    html = html.replace(pattern, () => tag);
  };

  set(/<title>.*?<\/title>/, `<title>${title}</title>`);
  set(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${title}" />`);
  set(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${ogDescription}" />`);
  set(/<meta property="og:image" content="[^"]*" \/>/, `<meta property="og:image" content="${image}" />`);
  set(/<meta property="og:type" content="[^"]*" \/>/, `<meta property="og:type" content="${meta.type}" />`);
  set(/<meta property="og:site_name" content="[^"]*" \/>/, `<meta property="og:url" content="${url}" />\n    <meta property="og:site_name" content="Grammie" />`);
  set(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${title}" />`);
  set(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${ogDescription}" />`);
  set(/<meta name="twitter:image" content="[^"]*" \/>/, `<meta name="twitter:image" content="${image}" />`);
  set(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${description}" />`);
  if (meta.head) set(/<\/head>/, `  ${meta.head}\n  </head>`);
  return html;
}
