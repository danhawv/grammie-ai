import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { navigate } from "wouter/use-browser-location";
import { queryClient, apiRequest, getQueryFn } from "@/lib/queryClient";
import { apiFetch } from "@/lib/platform";
import { useEffect } from "react";
import { useAuth as useClerkAuth } from "@clerk/react";

export interface User {
  id: string;
  email: string;
  username: string | null;
  firstName?: string | null;
  lastName?: string | null;
  avatar?: string | null;
  bio?: string | null;
  defaultRecipeVisibility?: "public" | "private";
  autoEnrichRecipes?: boolean;
  createdAt: Date;
}

const hasClerk = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

/** Clerk's own view of sign-in; without Clerk there's nothing to wait for */
const useClerkState: () => { isLoaded: boolean; isSignedIn: boolean | undefined } = hasClerk
  ? useClerkAuth
  : () => ({ isLoaded: true, isSignedIn: undefined });

export function useAuth() {
  const qc = useQueryClient();

  const { data: user, isLoading, isFetching, error } = useQuery<User | null>({
    queryKey: ["/api/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: hasClerk ? 5000 : Infinity,
  });

  // On a fresh page load Clerk can still be setting its session cookie when
  // /api/user is first asked, which answers "signed out". Until Clerk has
  // loaded, and while Clerk says signed in but we have no user yet, report
  // loading and ask again, so pages don't show "Sign in" to someone who is.
  const clerk = useClerkState();
  const waitingForClerk = hasClerk && (!clerk.isLoaded || (clerk.isSignedIn === true && !user && isFetching));
  useEffect(() => {
    if (hasClerk && clerk.isLoaded) void qc.invalidateQueries({ queryKey: ["/api/user"] });
  }, [qc, clerk.isLoaded, clerk.isSignedIn]);

  const loginMutation = useMutation({
    // Both the Clerk and the older sign-in use the /login page (the server's
    // /api/login only redirected there); no reload, so it works in the app too
    mutationFn: async () => {
      navigate("/login");
    },
  });

  const logoutMutation = useMutation({
    // With Clerk, signing out goes through Clerk (settings / UserButton).
    // The older sign-in ends the server session, then goes home.
    mutationFn: async () => {
      if (!hasClerk) {
        await apiFetch("/api/logout").catch(() => undefined);
        qc.clear();
        navigate("/");
      }
    },
  });

  return {
    user: user ?? null,
    isLoading: isLoading || waitingForClerk,
    isAuthenticated: !!user,
    hasClerk,
    login: loginMutation.mutate,
    logout: logoutMutation.mutate,
    error,
  };
}
