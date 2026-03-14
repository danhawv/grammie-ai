import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Lock, Mail, User, AlertCircle } from "lucide-react";
import logoUrl from "@assets/IMG_0339_1767940282618.jpeg";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { SignIn } from "@clerk/react";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

const registerSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  email: z.string().email("Invalid email format"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type LoginFormValues = z.infer<typeof loginSchema>;
type RegisterFormValues = z.infer<typeof registerSchema>;

const hasClerkKey = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export default function Login() {
  const [, setLocation] = useLocation();
  const { login, localLogin, register, isLoggingIn, isRegistering, loginError, registerError, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [isLogin, setIsLogin] = useState(true);

  useEffect(() => {
    if (isAuthenticated) {
      setLocation("/");
    }
  }, [isAuthenticated, setLocation]);

  const loginForm = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    mode: "onSubmit",
    reValidateMode: "onSubmit",
    defaultValues: { username: "", password: "" },
  });

  const registerForm = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    mode: "onSubmit",
    reValidateMode: "onSubmit",
    defaultValues: { username: "", email: "", password: "", confirmPassword: "" },
  });

  const onLoginSubmit = (data: LoginFormValues) => {
    localLogin(data, {
      onSuccess: () => {
        toast({ title: "Welcome back!", description: "You've successfully logged in." });
        setLocation("/");
      },
      onError: (error: any) => {
        toast({
          variant: "destructive",
          title: "Login failed",
          description: error.message || "Invalid username or password",
        });
      },
    });
  };

  const onRegisterSubmit = (data: RegisterFormValues) => {
    register({ username: data.username, email: data.email, password: data.password }, {
      onSuccess: () => {
        toast({ title: "Account created!", description: "Welcome to Grammie." });
        setLocation("/");
      },
      onError: (error: any) => {
        toast({
          variant: "destructive",
          title: "Registration failed",
          description: error.message || "Failed to create account",
        });
      },
    });
  };

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
          <Tabs defaultValue="replit" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="replit" data-testid="tab-replit-auth">
                Replit Auth
              </TabsTrigger>
              <TabsTrigger value="local" data-testid="tab-local-auth">
                Username &amp; Password
              </TabsTrigger>
            </TabsList>

            <TabsContent value="replit" className="space-y-4">
              <div className="space-y-4 pt-4">
                <div className="text-sm text-center space-y-2">
                  <p className="text-muted-foreground">Single sign-on with your existing account</p>
                  <p className="text-xs text-muted-foreground">Supports Google, Apple, GitHub, and X</p>
                </div>
                <Button
                  onClick={() => login()}
                  className="w-full"
                  size="lg"
                  data-testid="button-replit-login"
                >
                  Continue with Replit
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="local" className="space-y-4">
              <LocalAuthForm
                isLogin={isLogin}
                setIsLogin={setIsLogin}
                loginForm={loginForm}
                registerForm={registerForm}
                onLoginSubmit={onLoginSubmit}
                onRegisterSubmit={onRegisterSubmit}
                isLoggingIn={isLoggingIn}
                isRegistering={isRegistering}
                loginError={loginError}
                registerError={registerError}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function LocalAuthForm({
  isLogin,
  setIsLogin,
  loginForm,
  registerForm,
  onLoginSubmit,
  onRegisterSubmit,
  isLoggingIn,
  isRegistering,
  loginError,
  registerError,
}: any) {
  return isLogin ? (
    <Form {...loginForm}>
      <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-4 pt-4">
        <FormField
          control={loginForm.control}
          name="username"
          render={({ field }: any) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input {...field} placeholder="Enter your username" className="pl-10" data-testid="input-username" />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={loginForm.control}
          name="password"
          render={({ field }: any) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input {...field} type="password" placeholder="Enter your password" className="pl-10" data-testid="input-password" />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {loginError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription data-testid="text-login-error">
              {(loginError as any)?.message || "Invalid username or password"}
            </AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="w-full" disabled={isLoggingIn} data-testid="button-login">
          {isLoggingIn ? "Logging in..." : "Log In"}
        </Button>
        <div className="text-center">
          <button
            type="button"
            onClick={() => { registerForm.reset(); registerForm.clearErrors(); setIsLogin(false); }}
            className="text-sm text-primary hover:underline"
            data-testid="link-register"
          >
            Don't have an account? Register
          </button>
        </div>
      </form>
    </Form>
  ) : (
    <Form {...registerForm}>
      <form onSubmit={registerForm.handleSubmit(onRegisterSubmit)} className="space-y-4 pt-4">
        <FormField
          control={registerForm.control}
          name="username"
          render={({ field }: any) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input {...field} placeholder="Choose a username" className="pl-10" autoComplete="username" data-testid="input-register-username" />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={registerForm.control}
          name="email"
          render={({ field }: any) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input {...field} type="email" placeholder="your.email@example.com" className="pl-10" autoComplete="email" data-testid="input-register-email" />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={registerForm.control}
          name="password"
          render={({ field }: any) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input {...field} type="password" placeholder="At least 8 characters" className="pl-10" autoComplete="new-password" data-testid="input-register-password" />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={registerForm.control}
          name="confirmPassword"
          render={({ field }: any) => (
            <FormItem>
              <FormLabel>Confirm Password</FormLabel>
              <FormControl>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input {...field} type="password" placeholder="Confirm your password" className="pl-10" autoComplete="new-password" data-testid="input-register-confirm-password" />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {registerError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription data-testid="text-register-error">
              {(registerError as any)?.message || "Failed to create account"}
            </AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="w-full" disabled={isRegistering} data-testid="button-register">
          {isRegistering ? "Creating account..." : "Create Account"}
        </Button>
        <div className="text-center">
          <button
            type="button"
            onClick={() => { loginForm.reset(); loginForm.clearErrors(); setIsLogin(true); }}
            className="text-sm text-primary hover:underline"
            data-testid="link-login"
          >
            Already have an account? Log in
          </button>
        </div>
      </form>
    </Form>
  );
}
