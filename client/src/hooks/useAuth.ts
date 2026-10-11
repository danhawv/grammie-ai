import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { navigate } from "wouter/use-browser-location";
import { queryClient, apiRequest, getQueryFn } from "@/lib/queryClient";
import { apiFetch } from "@/lib/platform";

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

export function useAuth() {
  const qc = useQueryClient();

  const { data: user, isLoading, error } = useQuery<User | null>({
    queryKey: ["/api/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: hasClerk ? 5000 : Infinity,
  });

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
    isLoading,
    isAuthenticated: !!user,
    hasClerk,
    login: loginMutation.mutate,
    logout: logoutMutation.mutate,
    error,
  };
}
