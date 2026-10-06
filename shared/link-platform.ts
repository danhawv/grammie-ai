// Which importer handles a pasted link. Shared so the Add recipe sheet and
// the server agree (they used to disagree on TikTok short links).

export type LinkPlatform = "instagram" | "tiktok" | "youtube" | "web";

/** Adds https:// when missing; null if it can't be a web address */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    return u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\.|^m\./, "");
  } catch {
    return "";
  }
}

export function detectLinkPlatform(input: string): LinkPlatform | null {
  const url = normalizeUrl(input);
  if (!url) return null;
  const host = hostOf(url);
  if (host === "instagram.com" || host === "instagr.am") return "instagram";
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (host === "youtube.com" || host === "youtu.be" || host === "music.youtube.com") return "youtube";
  return "web";
}

/**
 * Instagram post/reel shortcode from any of the link shapes the app shares:
 * /p/CODE, /reel/CODE, /reels/CODE, /tv/CODE, /username/p/CODE
 */
export function instagramShortcode(url: string): { kind: "p" | "reel"; code: string } | null {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const i = parts.findIndex((p) => ["p", "reel", "reels", "tv"].includes(p));
    if (i === -1 || !parts[i + 1] || !/^[A-Za-z0-9_-]+$/.test(parts[i + 1])) return null;
    return { kind: parts[i] === "p" || parts[i] === "tv" ? "p" : "reel", code: parts[i + 1] };
  } catch {
    return null;
  }
}

/** TikTok links that need a redirect followed first: vm./vt. hosts and /t/ */
export function isTikTokShortLink(url: string): boolean {
  const host = hostOf(url);
  if (host === "vm.tiktok.com" || host === "vt.tiktok.com") return true;
  try {
    return /^\/t\//.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** YouTube video id from watch, shorts, live, embed and youtu.be links */
export function youtubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = hostOf(url);
    if (host === "youtu.be") return u.pathname.split("/")[1] || null;
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = u.pathname.match(/^\/(shorts|live|embed)\/([A-Za-z0-9_-]{6,})/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}
