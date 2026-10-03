import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// Google Fonts is a runtime dependency of PDF generation: if the fetch inside
// Puppeteer is slow or fails, books silently print in the fallback font. This
// module downloads the font CSS once, inlines the font files as data URLs, and
// caches the result on disk so subsequent generations never touch the network.

const CACHE_DIR = path.join(os.tmpdir(), 'grammie-font-cache');

// A modern browser UA makes Google serve compact woff2 instead of ttf
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function cacheKey(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 24);
}

/**
 * Fetch a Google Fonts CSS URL and return the stylesheet with every font file
 * inlined as a base64 data URL. Results are cached on disk keyed by URL.
 * Returns null on failure — callers should fall back to a plain <link> tag.
 */
export async function buildEmbeddedFontCss(cssUrl: string): Promise<string | null> {
  const cssCachePath = path.join(CACHE_DIR, `${cacheKey(cssUrl)}.css`);
  try {
    return await fs.readFile(cssCachePath, 'utf8');
  } catch {
    // not cached yet
  }

  try {
    const cssRes = await fetch(cssUrl, { headers: { 'User-Agent': CHROME_UA } });
    if (!cssRes.ok) return null;
    let css = await cssRes.text();

    const fontUrls = Array.from(new Set(
      Array.from(css.matchAll(/url\((https:\/\/[^)]+)\)/g), (m) => m[1])
    ));

    await fs.mkdir(CACHE_DIR, { recursive: true });

    for (const fontUrl of fontUrls) {
      const fontCachePath = path.join(CACHE_DIR, `${cacheKey(fontUrl)}.bin`);
      let buf: Buffer;
      try {
        buf = await fs.readFile(fontCachePath);
      } catch {
        const fontRes = await fetch(fontUrl);
        if (!fontRes.ok) return null;
        buf = Buffer.from(await fontRes.arrayBuffer());
        await fs.writeFile(fontCachePath, buf);
      }
      const mime = fontUrl.includes('.woff2') ? 'font/woff2' : 'font/ttf';
      css = css.split(fontUrl).join(`data:${mime};base64,${buf.toString('base64')}`);
    }

    await fs.writeFile(cssCachePath, css);
    return css;
  } catch (err) {
    console.error('[font-cache] Failed to build embedded font CSS, falling back to network fonts', err);
    return null;
  }
}

/**
 * Replace a `<link href="https://fonts.googleapis.com/...">` tag in generated
 * HTML with an inline <style> of embedded fonts. Leaves the HTML untouched
 * (network fallback) if the fonts can't be resolved.
 */
export async function inlineGoogleFonts(html: string): Promise<string> {
  const linkMatch = html.match(/<link href="(https:\/\/fonts\.googleapis\.com\/[^"]+)" rel="stylesheet">/);
  if (!linkMatch) return html;
  const css = await buildEmbeddedFontCss(linkMatch[1]);
  if (!css) return html;
  return html.replace(linkMatch[0], `<style>\n${css}\n</style>`);
}
