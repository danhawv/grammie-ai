import { useState } from "react";
import { Loader2 } from "lucide-react";
import { SiApple, SiGoogle } from "react-icons/si";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { signInWithProvider, type SocialProvider } from "./auth";

// Google and Apple sign-in for the app's sign-in page (they open the system
// browser; see auth.tsx). Email sign-in stays in Clerk's form below.

export default function NativeSocialSignIn() {
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async (provider: SocialProvider) => {
    setError(null);
    setBusy(provider);
    try {
      if (await signInWithProvider(provider)) navigate("/");
    } catch (err) {
      setError((err as Error)?.message || "Sign-in didn't work. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <Button type="button" size="lg" className="w-full min-h-12 text-base" disabled={!!busy} onClick={() => start("oauth_apple")} data-testid="button-sign-in-apple">
        {busy === "oauth_apple" ? <Loader2 className="animate-spin" aria-hidden /> : <SiApple aria-hidden />}
        Continue with Apple
      </Button>
      <Button type="button" size="lg" variant="outline" className="w-full min-h-12 text-base" disabled={!!busy} onClick={() => start("oauth_google")} data-testid="button-sign-in-google">
        {busy === "oauth_google" ? <Loader2 className="animate-spin" aria-hidden /> : <SiGoogle aria-hidden />}
        Continue with Google
      </Button>
      {error && (
        <p role="alert" className="text-base text-destructive">
          {error}
        </p>
      )}
      <p className="text-center text-base text-muted-foreground">or sign in with your email</p>
    </div>
  );
}
