import { useState, type ReactNode } from "react";
import { Clerk } from "@clerk/clerk-js/no-rhc";
import { ui } from "@clerk/ui/no-rhc";
import { ClerkProvider } from "@clerk/react";
import { Preferences } from "@capacitor/preferences";
import { Browser } from "@capacitor/browser";
import { PUBLIC_ORIGIN } from "@/lib/platform";
import { reportBack, waitForSsoCallback } from "./returns";

// Sign-in inside the iPhone/iPad app (Clerk "Native API" mode).
//
// The page runs on capacitor://localhost, so Clerk's cookies can't work.
// Instead, like Clerk's Expo and Chrome-extension SDKs, every request to
// Clerk carries the "client" token in an Authorization header, and Clerk
// sends back the new one in the response; it's kept in Preferences so
// people stay signed in between launches. Clerk's code and sign-in screens
// are bundled (no scripts loaded from the internet).
//
// Google and Apple can't sign in inside a web view, so those buttons open the
// system browser and come back through https://grammie.ai/sso-callback (a
// universal link) or grammie://sso-callback. See docs/MOBILE_APP.md (sign-in
// spike) for what must be checked on a phone and set in the Clerk dashboard.

const CLIENT_JWT_KEY = "grammie.clerk.client-jwt";
const SSO_REDIRECT = `${PUBLIC_ORIGIN}/sso-callback?app=1`;

let cachedJwt: string | null | undefined;

async function readJwt(): Promise<string | null> {
  if (cachedJwt === undefined) {
    cachedJwt = (await Preferences.get({ key: CLIENT_JWT_KEY })).value;
  }
  return cachedJwt;
}

async function saveJwt(value: string): Promise<void> {
  if (value === cachedJwt) return;
  cachedJwt = value;
  await Preferences.set({ key: CLIENT_JWT_KEY, value });
}

let instance: Clerk | null = null;

function nativeClerk(publishableKey: string): Clerk {
  if (instance) return instance;
  const clerk = new Clerk(publishableKey);
  clerk.__internal_onBeforeRequest(async (request) => {
    request.credentials = "omit";
    request.url?.searchParams.append("_is_native", "1");
    const headers = request.headers as Headers;
    headers.set("authorization", (await readJwt()) || "");
  });
  clerk.__internal_onAfterResponse(async (_request, response) => {
    const header = (response as Response | undefined)?.headers?.get("authorization");
    if (header) await saveJwt(header);
  });
  instance = clerk;
  // AuthTokenBridge (App.tsx) hands the session token to lib/platform.ts
  return clerk;
}

// Google and Apple buttons are drawn by the app (NativeSocialSignIn); the
// ones inside Clerk's screens would try to sign in inside the web view
const nativeAppearance = {
  elements: {
    socialButtonsRoot: { display: "none" },
    dividerRow: { display: "none" },
  },
};

export default function NativeClerkProvider({ publishableKey, children }: { publishableKey: string; children: ReactNode }) {
  const [clerk] = useState(() => nativeClerk(publishableKey));
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      Clerk={clerk}
      ui={ui}
      standardBrowser={false}
      signInUrl="/login"
      signUpUrl="/login"
      appearance={nativeAppearance as any}
    >
      {children}
    </ClerkProvider>
  );
}

export type SocialProvider = "oauth_google" | "oauth_apple";

/**
 * Signs in with Google or Apple in the system browser. Resolves true when
 * signed in, false when the person closed the browser.
 */
export async function signInWithProvider(strategy: SocialProvider): Promise<boolean> {
  const clerk = instance;
  if (!clerk?.client) throw new Error("Sign-in isn't ready yet. Try again in a moment.");
  const signIn = clerk.client.signIn;
  await signIn.create({ strategy, redirectUrl: SSO_REDIRECT });
  const external = signIn.firstFactorVerification.externalVerificationRedirectURL;
  if (!external) throw new Error("Couldn't start sign-in. Try again in a moment.");

  const returned = waitForSsoCallback();
  await Browser.open({ url: external.toString(), presentationStyle: "popover" });
  const url = await returned;
  if (!url) return false;
  Browser.close().catch(() => {});
  reportBack();

  const nonce = new URL(url).searchParams.get("rotating_token_nonce") ?? "";
  await signIn.reload({ rotatingTokenNonce: nonce });
  let sessionId = signIn.createdSessionId;
  // First time with this Google/Apple account: finish by creating the account
  if (signIn.firstFactorVerification.status === "transferable") {
    const signUp = await clerk.client.signUp.create({ transfer: true });
    sessionId = signUp.createdSessionId;
  }
  if (!sessionId) throw new Error("Sign-in didn't finish. Try again.");
  await clerk.setActive({ session: sessionId });
  return true;
}
