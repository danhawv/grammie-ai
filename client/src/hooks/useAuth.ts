import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryClient, apiRequest, getQueryFn } from "@/lib/queryClient";

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
    mutationFn: async () => {
      if (hasClerk) {
        window.location.href = "/login";
      } else {
        window.location.href = "/api/login";
      }
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      if (!hasClerk) {
        window.location.href = "/api/logout";
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
