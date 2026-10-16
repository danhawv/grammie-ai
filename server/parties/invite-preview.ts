// Link previews for the host's Partiful / Evite / Luma page: the page's
// og:title and og:image, nothing else. The fetch is stricter than the recipe
// importer's: every hop (the first address and each redirect) must be
// http(s) on the usual ports, and its host name must resolve only to public
// addresses. 5 seconds, 512 KB, HTML only. Never throws: nulls on failure.

import dns from "node:dns/promises";
import net from "node:net";
import { inviteSite, type InvitePreview } from "@shared/party";

const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 5000;

export interface PreviewDeps {
  fetchImpl?: typeof fetch;
  /** dns lookup (all addresses); swapped in tests */
  lookup?: (host: string) => Promise<string[]>;
  timeoutMs?: number;
}

/** Loopback, private, link-local, carrier-grade NAT, multicast and other non-public ranges */
export function isPrivateAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0)
      || (a === 198 && (b === 18 || b === 19));
  }
  if (v === 6) {
    const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (s === "::" || s === "::1") return true;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (s.startsWith("::ffff:")) return true;
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s) || s.startsWith("64:ff9b:") || s.startsWith("2001:db8");
  }
  return true;
}

async function defaultLookup(host: string): Promise<string[]> {
  const found = await dns.lookup(host, { all: true, verbatim: true });
  return found.map((a) => a.address);
}

/** The URL if it's safe to fetch, else null */
async function checkedUrl(raw: string, lookup: (host: string) => Promise<string[]>): Promise<URL | null> {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "443" && url.port !== "80") return null;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return null;
  if (net.isIP(host)) return isPrivateAddress(host) ? null : url;
  let addresses: string[];
  try { addresses = await lookup(host); } catch { return null; }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) return null;
  return url;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** og:title / og:image from a page's <meta> tags (either attribute order) */
export function readOgTags(html: string, pageUrl: string): { title: string | null; image: string | null } {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const found: Record<string, string> = {};
  for (const tag of tags) {
    const prop = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const content = tag.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/\bcontent\s*=\s*'([^']*)'/i)?.[1];
    if (!prop || content === undefined) continue;
    if ((prop === "og:title" || prop === "og:image" || prop === "og:image:secure_url") && !(prop in found)) found[prop] = content;
  }
  const title = found["og:title"] ? decodeEntities(found["og:title"]).replace(/\s+/g, " ").trim().slice(0, 200) || null : null;
  let image: string | null = null;
  const rawImage = found["og:image:secure_url"] ?? found["og:image"];
  if (rawImage) {
    try {
      const u = new URL(decodeEntities(rawImage).trim(), pageUrl);
      if (u.protocol === "https:" || u.protocol === "http:") image = u.toString().slice(0, 2000);
    } catch { /* not a usable address */ }
  }
  return { title, image };
}

export async function fetchInvitePreview(rawUrl: string, deps: PreviewDeps = {}): Promise<InvitePreview> {
  const site = inviteSite(rawUrl);
  const empty: InvitePreview = { site, title: null, image: null };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const lookup = deps.lookup ?? defaultLookup;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? TIMEOUT_MS);
  try {
    let next = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const url = await checkedUrl(next, lookup);
      if (!url) return empty;
      const res = await fetchImpl(url.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; GrammieBot/1.0; +https://grammie.ai)",
          Accept: "text/html,application/xhtml+xml;q=0.9",
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        res.body?.cancel().catch(() => {});
        if (!location) return empty;
        next = new URL(location, url).toString();
        continue;
      }
      const type = (res.headers.get("content-type") || "").toLowerCase();
      if (!res.ok || !(type.startsWith("text/html") || type.startsWith("application/xhtml+xml"))) {
        res.body?.cancel().catch(() => {});
        return empty;
      }
      const html = await readCapped(res);
      return { site, ...readOgTags(html, url.toString()) };
    }
    return empty;
  } catch {
    return empty;
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    chunks.push(value);
    // The tags are in <head>; stop at the cap or once the head is over
    if (total >= MAX_BYTES || /<\/head>/i.test(new TextDecoder().decode(value))) {
      reader.cancel().catch(() => {});
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks)).slice(0, MAX_BYTES);
}
