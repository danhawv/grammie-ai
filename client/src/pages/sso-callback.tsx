import { useEffect } from "react";
import { AuthenticateWithRedirectCallback } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/page-states";
import { isNativeApp } from "@/lib/platform";

// Where Google and Apple sign-in come back to.
//
// For the iPhone/iPad app (?app=1) this address is a universal link, so
// normally the app opens and finishes signing in (native/auth.tsx) without
// this page ever showing. If iOS shows the page in the sign-in browser
// instead, it sends the same answer on to the app through grammie:// and
// offers a button in case that needs a tap.
//
// On the website, Clerk finishes its own Google/Apple sign-in here.

const hasClerkKey = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export default function SsoCallback() {
  const params = new URLSearchParams(window.location.search);
  const forApp = !isNativeApp() && (params.get("app") === "1" || params.has("rotating_token_nonce"));
  const appLink = `grammie://sso-callback${window.location.search}`;

  useEffect(() => {
    if (forApp) window.location.href = appLink;
  }, [forApp, appLink]);

  if (forApp) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">Almost done</h1>
        <p className="text-base text-muted-foreground">Go back to the Grammie app to finish signing in.</p>
        <Button asChild size="lg" className="min-h-12 text-base">
          <a href={appLink}>Open Grammie</a>
        </Button>
      </div>
    );
  }

  if (!hasClerkKey || isNativeApp()) return <LoadingState variant="spinner" label="Signing you in…" />;
  return (
    <>
      <LoadingState variant="spinner" label="Signing you in…" />
      <AuthenticateWithRedirectCallback />
    </>
  );
}
