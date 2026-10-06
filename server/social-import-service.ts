import * as cheerio from "cheerio";
import {
  detectLinkPlatform,
  instagramShortcode,
  isTikTokShortLink,
  youtubeVideoId,
  type LinkPlatform,
} from "@shared/link-platform";

// Reads the caption of an Instagram, TikTok or YouTube post.
//
// Each platform tries its free public route first (Instagram's embed page,
// TikTok's oEmbed API, the YouTube watch page): these answer in under a
// second. Apify is the fallback for Instagram and TikTok when the public
// route has no caption; it takes 10-60 seconds and costs per run.

const APIFY_API_KEY = process.env.APIFY_API_KEY;
const APIFY_TIMEOUT_SECS = 90;
const FETCH_TIMEOUT_MS = 12_000;
const UA = "Mozilla/5.0 (compatible; GrammieBot/1.0; +https://grammie.ai)";

export type SocialPlatform = Exclude<LinkPlatform, "web">;

export function detectPlatform(url: string): LinkPlatform {
  return detectLinkPlatform(url) ?? "web";
}

export function isValidSocialUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export const PLATFORM_NAMES: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
};

export interface SocialPost {
  platform: SocialPlatform;
  id: string;
  caption: string;
  creatorUsername?: string;
  creatorDisplayName?: string;
  creatorAvatarUrl?: string;
  url: string;
  coverImageUrl?: string;
  postDate?: Date;
  /** Web links in the caption ("full recipe at ...") to try if the caption isn't a recipe */
  links: string[];
}

export interface ScrapeResult {
  success: boolean;
  post?: SocialPost;
  error?: string;
}

async function timedFetch(url: string, init: RequestInit = {}, ms = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal, headers: { "User-Agent": UA, ...(init.headers || {}) } });
  } finally {
    clearTimeout(timer);
  }
}

/** Follows a share link's redirects and returns where it lands */
async function resolveRedirect(url: string): Promise<string> {
  try {
    const res = await timedFetch(url, { redirect: "follow" });
    res.body?.cancel().catch(() => {});
    return res.url || url;
  } catch {
    return url;
  }
}

const SOCIAL_HOSTS = /(^|\.)(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|facebook\.com|fb\.me|twitter\.com|x\.com|pinterest\.com|linktr\.ee|amzn\.to|amazon\.com|ltk\.app|liketk\.it|patreon\.com)$/i;

/** Recipe-site links from a caption, most likely first */
export function captionLinks(caption: string): string[] {
  const found = caption.match(/https?:\/\/[^\s"'<>)\]]+/g) || [];
  const links = found
    .map((l) => l.replace(/[.,!?;:]+$/, ""))
    .filter((l) => {
      try {
        return !SOCIAL_HOSTS.test(new URL(l).hostname);
      } catch {
        return false;
      }
    });
  return Array.from(new Set(links)).slice(0, 2);
}

// ============ Instagram ============

async function instagramFromEmbed(code: string, kind: "p" | "reel"): Promise<SocialPost | null> {
  const res = await timedFetch(`https://www.instagram.com/${kind}/${code}/embed/captioned/`);
  if (!res.ok) return null;
  const $ = cheerio.load(await res.text());
  const caption = $(".Caption").first();
  if (!caption.length) return null;
  caption.find(".CaptionUsername, .CaptionComments").remove();
  caption.find("br").replaceWith("\n");
  const text = caption.text().trim();
  if (!text) return null;
  return {
    platform: "instagram",
    id: code,
    caption: text,
    creatorUsername: $(".UsernameText").first().text().trim() || undefined,
    url: `https://www.instagram.com/${kind}/${code}/`,
    coverImageUrl: $(".EmbeddedMediaImage").attr("src") || undefined,
    links: captionLinks(text),
  };
}

async function instagramFromApify(url: string): Promise<SocialPost | null> {
  const items = await runApify("apify~instagram-scraper", {
    directUrls: [url],
    resultsLimit: 1,
    resultsType: "posts",
  });
  const post = items?.[0];
  if (!post?.caption) return null;
  return {
    platform: "instagram",
    id: post.shortCode,
    caption: post.caption,
    creatorUsername: post.ownerUsername,
    url: post.url || url,
    coverImageUrl: post.displayUrl,
    postDate: post.timestamp ? new Date(post.timestamp) : undefined,
    links: captionLinks(post.caption),
  };
}

async function scrapeInstagram(url: string): Promise<ScrapeResult> {
  let ref = instagramShortcode(url);
  // instagram.com/share/... links redirect to the post
  if (!ref) ref = instagramShortcode(await resolveRedirect(url));
  if (!ref) {
    return { success: false, error: "That Instagram link isn't a post or reel. Open the post, tap Share, then Copy link, and paste that." };
  }
  const canonical = `https://www.instagram.com/${ref.kind}/${ref.code}/`;

  const embedded = await instagramFromEmbed(ref.code, ref.kind).catch((err) => {
    console.warn(`[Instagram] Embed read failed: ${err?.message}`);
    return null;
  });
  if (embedded) return { success: true, post: embedded };

  const viaApify = APIFY_API_KEY ? await instagramFromApify(canonical).catch(() => null) : null;
  if (viaApify) return { success: true, post: viaApify };

  return {
    success: false,
    error: "We couldn't read that Instagram post. It may be private, deleted, or have no caption. You can copy the caption and use Paste text instead.",
  };
}

// ============ TikTok ============

async function tiktokFromOembed(url: string): Promise<SocialPost | null> {
  const res = await timedFetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    title?: string;
    author_unique_id?: string;
    author_name?: string;
    thumbnail_url?: string;
    embed_product_id?: string;
  };
  if (!data.title) return null;
  return {
    platform: "tiktok",
    id: data.embed_product_id || url,
    caption: data.title,
    creatorUsername: data.author_unique_id,
    creatorDisplayName: data.author_name,
    url,
    coverImageUrl: data.thumbnail_url,
    links: captionLinks(data.title),
  };
}

async function tiktokFromApify(url: string): Promise<SocialPost | null> {
  const items = await runApify("clockworks~tiktok-video-scraper", { postURLs: [url] });
  const post = items?.[0];
  if (!post?.text) return null;
  return {
    platform: "tiktok",
    id: post.id,
    caption: post.text,
    creatorUsername: post.authorMeta?.name,
    creatorDisplayName: post.authorMeta?.nickName,
    creatorAvatarUrl: post.authorMeta?.avatar,
    url: post.webVideoUrl || url,
    coverImageUrl: post.videoMeta?.coverUrl,
    postDate: post.createTime ? new Date(post.createTime * 1000) : undefined,
    links: captionLinks(post.text),
  };
}

async function scrapeTikTok(url: string): Promise<ScrapeResult> {
  let target = url;
  if (isTikTokShortLink(url)) target = await resolveRedirect(url);
  try {
    const u = new URL(target);
    target = `${u.origin}${u.pathname}`; // drop tracking params
  } catch {
    /* keep as is */
  }
  if (!/\/(video|photo)\/\d+/.test(target)) {
    return { success: false, error: "That TikTok link isn't a video. Open the video, tap Share, then Copy link, and paste that." };
  }

  const viaOembed = await tiktokFromOembed(target).catch((err) => {
    console.warn(`[TikTok] oEmbed failed: ${err?.message}`);
    return null;
  });
  if (viaOembed) return { success: true, post: viaOembed };

  const viaApify = APIFY_API_KEY ? await tiktokFromApify(target).catch(() => null) : null;
  if (viaApify) return { success: true, post: viaApify };

  return {
    success: false,
    error: "We couldn't read that TikTok. It may be private or deleted. You can copy the caption and use Paste text instead.",
  };
}

// ============ YouTube ============

function jsonString(html: string, key: string): string | undefined {
  const m = html.match(new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`));
  if (!m) return undefined;
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return undefined;
  }
}

async function scrapeYouTube(url: string): Promise<ScrapeResult> {
  const id = youtubeVideoId(url);
  if (!id) return { success: false, error: "That YouTube link isn't a video. Copy the video's link and paste that." };
  const watchUrl = `https://www.youtube.com/watch?v=${id}`;
  try {
    const res = await timedFetch(watchUrl, { headers: { "Accept-Language": "en-US,en;q=0.9" } });
    const html = res.ok ? await res.text() : "";
    const description = jsonString(html, "shortDescription") || "";
    const title = jsonString(html, "title") || "";
    const author = jsonString(html, "ownerChannelName") || jsonString(html, "author");
    if (!description && !title) {
      return { success: false, error: "We couldn't read that YouTube video. It may be private or removed." };
    }
    const caption = title ? `${title}\n\n${description}` : description;
    return {
      success: true,
      post: {
        platform: "youtube",
        id,
        caption,
        creatorUsername: author,
        url: url.includes("/shorts/") ? `https://www.youtube.com/shorts/${id}` : watchUrl,
        coverImageUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        links: captionLinks(description),
      },
    };
  } catch (err: any) {
    console.warn(`[YouTube] Read failed: ${err?.message}`);
    return { success: false, error: "We couldn't reach YouTube. Try again in a minute." };
  }
}

// ============ Apify fallback ============

async function runApify(actor: string, input: Record<string, unknown>): Promise<any[] | null> {
  if (!APIFY_API_KEY) return null;
  const started = Date.now();
  try {
    const res = await timedFetch(
      `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?timeout=${APIFY_TIMEOUT_SECS}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${APIFY_API_KEY}` },
        body: JSON.stringify(input),
      },
      (APIFY_TIMEOUT_SECS + 10) * 1000,
    );
    if (!res.ok) {
      console.error(`[Apify] ${actor} ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    const items = (await res.json()) as any[];
    console.log(`[Apify] ${actor} returned ${items?.length ?? 0} item(s) in ${Date.now() - started}ms`);
    return Array.isArray(items) ? items : null;
  } catch (err: any) {
    console.error(`[Apify] ${actor} failed after ${Date.now() - started}ms: ${err?.message}`);
    return null;
  }
}

// ============ Entry point ============

export async function scrapePost(url: string): Promise<ScrapeResult> {
  const started = Date.now();
  const platform = detectPlatform(url);
  let result: ScrapeResult;
  switch (platform) {
    case "instagram":
      result = await scrapeInstagram(url);
      break;
    case "tiktok":
      result = await scrapeTikTok(url);
      break;
    case "youtube":
      result = await scrapeYouTube(url);
      break;
    default:
      return { success: false, error: "Use the web importer for this link." };
  }
  console.log(`[Social] ${platform} read ${result.success ? "ok" : "failed"} in ${Date.now() - started}ms`);
  return result;
}
