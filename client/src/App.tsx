import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { AppShell } from "@/components/app-shell";
import { AddRecipeProvider } from "@/contexts/AddRecipeContext";
import { UploadProgressProvider } from "@/contexts/UploadProgressContext";
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
const Kitchen = lazy(() => import("@/pages/kitchen"));
const SharedGroceryList = lazy(() => import("@/pages/shared-grocery-list"));
const Pantry = lazy(() => import("@/pages/pantry"));
const WhatCanIMake = lazy(() => import("@/pages/what-can-i-make"));
const Profile = lazy(() => import("@/pages/profile"));
const CookbookView = lazy(() => import("@/pages/cookbook-view"));
const CookbookPrint = lazy(() => import("@/pages/cookbook-print"));
const CookbookPrintEditor = lazy(() => import("@/pages/cookbook-print-editor"));
const Processing = lazy(() => import("@/pages/processing"));
const MealPlans = lazy(() => import("@/pages/meal-plans"));
const MealPlanDetail = lazy(() => import("@/pages/meal-plan-detail"));
const RecipeCreator = lazy(() => import("@/pages/recipe-creator"));
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
        <Route path="/kitchen" component={Kitchen} />
        <Route path="/cookbooks" component={Home} />
        <Route path="/grocery-list" component={GroceryList} />
        <Route path="/grocery-list/shared/:token" component={SharedGroceryList} />
        <Route path="/pantry" component={Pantry} />
        <Route path="/what-can-i-make" component={WhatCanIMake} />
        <Route path="/recipe-creator" component={RecipeCreator} />
        <Route path="/profile/:userId" component={Profile} />
        <Route path="/cookbook/:id" component={CookbookView} />
        <Route path="/cookbook/:id/print" component={CookbookPrint} />
        <Route path="/cookbook/:id/print-editor" component={CookbookPrintEditor} />
        <Route path="/meal-plans" component={MealPlans} />
        <Route path="/meal-plans/:id" component={MealPlanDetail} />
        <Route path="/processing" component={Processing} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function AppCore() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <UploadProgressProvider>
            <AddRecipeProvider>
              <AppShell />
              <Toaster />
              <main id="main">
                <Router />
              </main>
              <GrammieChat />
              <ShareHandler />
              <InstallPrompt />
            </AddRecipeProvider>
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
