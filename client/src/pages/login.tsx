import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import logoUrl from "@assets/IMG_0339_1767940282618.jpeg";
import { SignIn } from "@clerk/react";

const hasClerkKey = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export default function Login() {
  const [, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      setLocation("/");
    }
  }, [isAuthenticated, setLocation]);

  if (hasClerkKey) {
    return (
      <div className="container flex items-center justify-center min-h-[calc(100vh-3.5rem)] py-8">
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
              Sign in to save and manage your recipes
            </p>
          </div>
          <div className="flex justify-center">
            <SignIn routing="hash" {...{ afterSignInUrl: "/", afterSignUpUrl: "/" } as any} />
          </div>
        </div>
      </div>
    );
  }

  // Clerk is the only sign-in method; this renders when the publishable key
  // is missing from the environment
  return (
    <div className="container flex items-center justify-center min-h-[calc(100vh-3.5rem)] py-8">
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
