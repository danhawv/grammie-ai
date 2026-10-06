import { describe, expect, it } from "vitest";
import { detectLinkPlatform, instagramShortcode, isTikTokShortLink, normalizeUrl, youtubeVideoId } from "./link-platform";

describe("detectLinkPlatform", () => {
  it.each([
    ["https://www.instagram.com/reel/Dd6ZrQNhv3t/?igsh=abc", "instagram"],
    ["instagram.com/p/Dd6ZrQNhv3t", "instagram"],
    ["https://www.instagram.com/share/reel/BAEXmZ8wsT/", "instagram"],
    ["https://www.tiktok.com/@derekkchen/video/7480603318859861291?lang=en", "tiktok"],
    ["https://vm.tiktok.com/ZMh1Abcde/", "tiktok"],
    ["https://www.tiktok.com/t/ZP8ySsfwK/", "tiktok"],
    ["https://youtu.be/FSFTqzmuzy8", "youtube"],
    ["https://www.youtube.com/shorts/FSFTqzmuzy8", "youtube"],
    ["https://sallysbakingaddiction.com/chewy-chocolate-chip-cookies/", "web"],
    ["https://notinstagram.com.example.org/p/x", "web"],
  ])("%s -> %s", (url, platform) => {
    expect(detectLinkPlatform(url)).toBe(platform);
  });

  it("rejects things that aren't links", () => {
    expect(detectLinkPlatform("chocolate cake")).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
  });
});

describe("instagramShortcode", () => {
  it("reads posts, reels and username-prefixed links", () => {
    expect(instagramShortcode("https://www.instagram.com/reel/Dd6ZrQNhv3t/")).toEqual({ kind: "reel", code: "Dd6ZrQNhv3t" });
    expect(instagramShortcode("https://www.instagram.com/reels/Dd6ZrQNhv3t/")).toEqual({ kind: "reel", code: "Dd6ZrQNhv3t" });
    expect(instagramShortcode("https://www.instagram.com/kalejunkie/p/Dd6ZrQNhv3t/")).toEqual({ kind: "p", code: "Dd6ZrQNhv3t" });
    expect(instagramShortcode("https://www.instagram.com/kalejunkie/")).toBeNull();
  });
});

describe("TikTok and YouTube links", () => {
  it("spots TikTok share links that need a redirect", () => {
    expect(isTikTokShortLink("https://vm.tiktok.com/ZMh1Abcde/")).toBe(true);
    expect(isTikTokShortLink("https://www.tiktok.com/t/ZP8ySsfwK/")).toBe(true);
    expect(isTikTokShortLink("https://www.tiktok.com/@a/video/123")).toBe(false);
  });

  it("finds the YouTube video id", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=FSFTqzmuzy8&t=30s")).toBe("FSFTqzmuzy8");
    expect(youtubeVideoId("https://youtu.be/FSFTqzmuzy8?si=x")).toBe("FSFTqzmuzy8");
    expect(youtubeVideoId("https://www.youtube.com/shorts/FSFTqzmuzy8")).toBe("FSFTqzmuzy8");
    expect(youtubeVideoId("https://www.youtube.com/@JoshuaWeissman")).toBeNull();
  });
});
