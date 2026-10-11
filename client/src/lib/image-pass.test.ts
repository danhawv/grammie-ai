import { afterEach, describe, expect, it, vi } from "vitest";
import { privateImageUrl } from "./image-pass";
import { mediaUrl, PUBLIC_ORIGIN } from "./platform";

describe("picture URLs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("stay as they are in a browser", () => {
    expect(privateImageUrl("/api/cookbook-photos/p1", null)).toBe("/api/cookbook-photos/p1");
    expect(mediaUrl("/media/ab.jpg")).toBe("/media/ab.jpg");
    expect(mediaUrl("data:image/png;base64,AA")).toBe("data:image/png;base64,AA");
    expect(mediaUrl(null)).toBeUndefined();
    expect(mediaUrl("")).toBeUndefined();
  });

  it("point at the server, with a pass, in the app", () => {
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true });
    expect(mediaUrl("/media/ab.jpg")).toBe(`${PUBLIC_ORIGIN}/media/ab.jpg`);
    expect(mediaUrl("https://img.example/x.jpg")).toBe("https://img.example/x.jpg");
    expect(privateImageUrl("/api/cookbook-photos/p1", "a.b.c")).toBe(`${PUBLIC_ORIGIN}/api/cookbook-photos/p1?pass=a.b.c`);
    expect(privateImageUrl("/api/cookbooks/1/original-cards/r?v=2", "a.b.c")).toBe(`${PUBLIC_ORIGIN}/api/cookbooks/1/original-cards/r?v=2&pass=a.b.c`);
  });
});
