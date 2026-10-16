import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import logoUrl from "@assets/IMG_0339_1767940282618.jpeg";
import { SignIn, SignUp } from "@clerk/react";
import { safeNext } from "@/lib/party-format";

const hasClerkKey = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// ?next=/path comes back there after signing in (e.g. a party invite), and
// ?mode=signup opens on "Create an account" instead of "Sign in".
export default function Login() {
  const [, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();
  const params = new URLSearchParams(useSearch());
  const next = safeNext(params.get("next")) ?? "/";
  const signUp = params.get("mode") === "signup";
  const withNext = (mode?: "signup") => `/login?${mode ? "mode=signup&" : ""}next=${encodeURIComponent(next)}`;

  useEffect(() => {
    if (isAuthenticated) {
      setLocation(next);
    }
  }, [isAuthenticated, setLocation, next]);

  if (hasClerkKey) {
    return (
      <div className="container flex items-center justify-center min-h-[calc(100vh-3.5rem)] supports-[height:100dvh]:min-h-[calc(100dvh-3.5rem)] py-8">
        <div className="w-full max-w-md space-y-6">
          <div className="flex flex-col items-center space-y-2">
            <img
              src={logoUrl}
              alt="Grammie.AI Logo"
              className="h-24 w-auto"
              data-testid="img-login-logo"
            />
            <h1 className="text-2xl font-bold text-center">Welcome to Grammie</h1>
            <p className="text-sm text-muted-foreground text-center">
              {signUp ? "It takes one minute and is free" : "Sign in to save and manage your recipes"}
            </p>
          </div>
          <div className="flex justify-center">
            {signUp ? (
              <SignUp routing="hash" forceRedirectUrl={next} signInUrl={withNext()} signInForceRedirectUrl={next} />
            ) : (
              <SignIn
                routing="hash"
                {...(next === "/"
                  ? ({ afterSignInUrl: "/", afterSignUpUrl: "/" } as any)
                  : { forceRedirectUrl: next, signUpForceRedirectUrl: next, signUpUrl: withNext("signup") })}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  // Clerk is the only sign-in method; this renders when the publishable key
  // is missing from the environment
  return (
    <div className="container flex items-center justify-center min-h-[calc(100vh-3.5rem)] supports-[height:100dvh]:min-h-[calc(100dvh-3.5rem)] py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex justify-center mb-4">
            <img
              src={logoUrl}
              alt="Grammie.AI Logo"
              className="h-24 w-auto"
              data-testid="img-login-logo"
            />
          </div>
          <CardTitle className="text-2xl font-bold text-center">Welcome to Grammie</CardTitle>
          <CardDescription className="text-center">
            Sign in to save and manage your recipes
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-center text-muted-foreground py-4" data-testid="text-auth-unconfigured">
            Sign-in isn't configured on this server. Set VITE_CLERK_PUBLISHABLE_KEY and restart.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
