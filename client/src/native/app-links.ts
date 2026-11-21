// Which links belong to the app (pure, so it can be tested without a phone)
import { PUBLIC_ORIGIN } from "@/lib/platform";

/** "/recipe/12?x=1" for a link the app should handle; null for anything else */
export function inAppPath(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol === "grammie:") {
    // grammie://share → host "share"; grammie:///recipe/1 → path "/recipe/1"
    const path = `/${u.host}${u.pathname}`.replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1");
    return `${path}${u.search}${u.hash}`;
  }
  const site = new URL(PUBLIC_ORIGIN);
  const host = u.hostname.replace(/^www\./, "");
  if (u.protocol === "https:" && host === site.hostname.replace(/^www\./, "")) {
    return `${u.pathname}${u.search}${u.hash}`;
  }
  return null;
}
