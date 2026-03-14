import { Switch, Route, Link, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Settings as SettingsIcon, ShoppingCart } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { UserHeader } from "@/components/user-header";
import { Button } from "@/components/ui/button";
import { UploadProgressProvider } from "@/contexts/UploadProgressContext";
import { AlertsButton } from "@/components/alerts-button";
import { GrammieChat } from "@/components/grammie-chat";
import { ShareHandler } from "@/components/share-handler";
import { InstallPrompt } from "@/components/install-prompt";
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { ClerkProvider } from "@clerk/react";
import { ErrorBoundary } from "@/components/error-boundary";

const Home = lazy(() => import("@/pages/home"));
const RecipeDetail = lazy(() => import("@/pages/recipe-detail"));
const RecipeEdit = lazy(() => import("@/pages/recipe-edit"));
const Settings = lazy(() => import("@/pages/settings"));
const Login = lazy(() => import("@/pages/login"));
const GroceryList = lazy(() => import("@/pages/grocery-list"));
const SharedGroceryList = lazy(() => import("@/pages/shared-grocery-list"));
const Pantry = lazy(() => import("@/pages/pantry"));
const WhatCanIMake = lazy(() => import("@/pages/what-can-i-make"));
const Profile = lazy(() => import("@/pages/profile"));
const CookbookView = lazy(() => import("@/pages/cookbook-view"));
const CookbookPrint = lazy(() => import("@/pages/cookbook-print"));
const CookbookPrintEditor = lazy(() => import("@/pages/cookbook-print-editor"));
const Processing = lazy(() => import("@/pages/processing"));
const NotFound = lazy(() => import("@/pages/not-found"));

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/recipe/:id/edit" component={RecipeEdit} />
        <Route path="/recipe/:id" component={RecipeDetail} />
        <Route path="/settings" component={Settings} />
        <Route path="/login" component={Login} />
        <Route path="/grocery-list" component={GroceryList} />
        <Route path="/grocery-list/shared/:token" component={SharedGroceryList} />
        <Route path="/pantry" component={Pantry} />
        <Route path="/what-can-i-make" component={WhatCanIMake} />
        <Route path="/profile/:userId" component={Profile} />
        <Route path="/cookbook/:id" component={CookbookView} />
        <Route path="/cookbook/:id/print" component={CookbookPrint} />
        <Route path="/cookbook/:id/print-editor" component={CookbookPrintEditor} />
        <Route path="/processing" component={Processing} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function AppHeader() {
  const [location] = useLocation();
  
  if (location === "/") {
    return null;
  }
  
  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Link href="/">
            <h2 className="font-serif text-xl font-bold cursor-pointer hover-elevate">Recipe Collection</h2>
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/grocery-list">
            <Button variant="ghost" className="inline-flex items-center justify-center touch-target p-0" data-testid="button-grocery-list" aria-label="Grocery list">
              <ShoppingCart className="h-5 w-5" />
            </Button>
          </Link>
          <Link href="/settings">
            <Button variant="ghost" className="inline-flex items-center justify-center touch-target p-0" data-testid="button-settings" aria-label="Settings">
              <SettingsIcon className="h-5 w-5" />
            </Button>
          </Link>
          <AlertsButton />
          <UserHeader />
        </div>
      </div>
    </header>
  );
}

function AppCore() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <UploadProgressProvider>
            <AppHeader />
            <Toaster />
            <Router />
            <GrammieChat />
            <ShareHandler />
            <InstallPrompt />
          </UploadProgressProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function App() {
  if (CLERK_KEY) {
    return (
      <ErrorBoundary>
        <ClerkProvider publishableKey={CLERK_KEY}>
          <AppCore />
        </ClerkProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <AppCore />
    </ErrorBoundary>
  );
}

export default App;
