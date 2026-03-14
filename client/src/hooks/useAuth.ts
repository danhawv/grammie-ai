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

  const localLoginMutation = useMutation({
    mutationFn: async (credentials: { username: string; password: string }) => {
      const response = await apiRequest("POST", "/api/auth/login", credentials);
      return response;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/user"] });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: { username: string; email: string; password: string }) => {
      const response = await apiRequest("POST", "/api/auth/register", data);
      return response;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/user"] });
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
    localLogin: localLoginMutation.mutate,
    register: registerMutation.mutate,
    logout: logoutMutation.mutate,
    error,
    loginError: localLoginMutation.error,
    registerError: registerMutation.error,
    isLoggingIn: localLoginMutation.isPending,
    isRegistering: registerMutation.isPending,
  };
}
