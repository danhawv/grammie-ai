import { describe, expect, it } from "vitest";
import { fetchInvitePreview, isPrivateAddress, readOgTags } from "./invite-preview";

const PAGE = `<html><head>
  <meta property="og:title" content="Sam&#39;s Fall Feast &amp; Potluck">
  <meta content="/img/cover.jpg" property="og:image">
  <meta name="description" content="ignored">
</head><body>secret stuff</body></html>`;

function htmlResponse(body: string, status = 200, headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" }) {
  return new Response(status >= 300 && status < 400 ? null : body, { status, headers });
}

describe("invite previews", () => {
  it("reads only og:title and og:image", () => {
    expect(readOgTags(PAGE, "https://partiful.com/e/abc")).toEqual({
      title: "Sam's Fall Feast & Potluck",
      image: "https://partiful.com/img/cover.jpg",
    });
    expect(readOgTags(`<meta property="og:image" content="javascript:alert(1)">`, "https://x.com/")).toEqual({ title: null, image: null });
  });

  it("knows private addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "151.101.1.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("fetches a public page", async () => {
    const preview = await fetchInvitePreview("https://partiful.com/e/abc", {
      lookup: async () => ["151.101.1.1"],
      fetchImpl: (async () => htmlResponse(PAGE)) as typeof fetch,
    });
    expect(preview).toEqual({ site: "partiful", title: "Sam's Fall Feast & Potluck", image: "https://partiful.com/img/cover.jpg" });
  });

  it("refuses private hosts, odd ports and redirects into the private network, without throwing", async () => {
    let fetched = 0;
    const fetchImpl = (async (url: string) => {
      fetched++;
      return url.startsWith("https://evil.example/") ? htmlResponse("", 302, { location: "http://169.254.169.254/latest/meta-data" }) : htmlResponse(PAGE);
    }) as unknown as typeof fetch;
    const lookup = async (host: string) => (host === "internal.example" ? ["10.0.0.5"] : ["93.184.216.34"]);
    const empty = (site = "other") => ({ site, title: null, image: null });
    expect(await fetchInvitePreview("http://localhost/x", { fetchImpl, lookup })).toEqual(empty());
    expect(await fetchInvitePreview("https://internal.example/x", { fetchImpl, lookup })).toEqual(empty());
    expect(await fetchInvitePreview("https://127.0.0.1/x", { fetchImpl, lookup })).toEqual(empty());
    expect(await fetchInvitePreview("https://good.example:8443/x", { fetchImpl, lookup })).toEqual(empty());
    expect(await fetchInvitePreview("file:///etc/passwd", { fetchImpl, lookup })).toEqual(empty());
    expect(fetched).toBe(0);
    expect(await fetchInvitePreview("https://evil.example/x", { fetchImpl, lookup })).toEqual(empty());
    expect(fetched).toBe(1);
    expect(await fetchInvitePreview("not a url", { fetchImpl, lookup })).toEqual(empty());
    const throwing = (async () => { throw new Error("boom"); }) as unknown as typeof fetch;
    expect(await fetchInvitePreview("https://good.example/x", { fetchImpl: throwing, lookup })).toEqual(empty());
    const notHtml = (async () => htmlResponse("{}", 200, { "content-type": "application/json" })) as unknown as typeof fetch;
    expect(await fetchInvitePreview("https://good.example/x", { fetchImpl: notHtml, lookup })).toEqual(empty());
  });
});

describe("invite titles", () => {
  it("drops the site name after the party name", () => {
    expect(readOgTags('<meta property="og:title" content="Potluck Party | Partiful">', "https://partiful.com/e/x").title).toBe("Potluck Party");
  });
});
