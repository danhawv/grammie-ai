import { App, type URLOpenListenerEvent } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { navigate } from "wouter/use-browser-location";
import { inAppPath } from "./app-links";
import { reportBack, reportSsoCallback } from "./returns";

// Links that open the app: universal links (https://grammie.ai/recipe/12,
// the Stripe return to /cookbook/..., /sso-callback) and the grammie://
// scheme (grammie://share from the Share Extension, grammie://sso-callback
// as the sign-in fallback). Each becomes a route inside the app.

export function handleAppUrl(url: string): void {
  const path = inAppPath(url);
  if (!path) return;
  // Whatever brought them back, the in-app browser has done its job
  Browser.close().catch(() => {});
  if (path.startsWith("/sso-callback")) {
    // auth.ts finishes the sign-in that opened the browser
    reportSsoCallback(url);
    reportBack();
    return;
  }
  reportBack();
  // grammie://share: the share plugin delivers the content (share-intake.ts)
  if (path === "/share" || path.startsWith("/share?")) return;
  navigate(path);
}

export async function startLinkHandling(): Promise<void> {
  await App.addListener("appUrlOpen", (event: URLOpenListenerEvent) => handleAppUrl(event.url));
  // The person closed the in-app browser themselves (Done, or swiped it away)
  await Browser.addListener("browserFinished", () => {
    reportSsoCallback(null);
    reportBack();
  });
  // Opened from a link while the app wasn't running
  const launch = await App.getLaunchUrl().catch(() => undefined);
  if (launch?.url) handleAppUrl(launch.url);
}
