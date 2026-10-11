import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { navigate } from "wouter/use-browser-location";
import { apiFetch } from "./platform";

// Sends someone whose sign-in ran out to the sign-in page without reloading
// the app (a reload inside the iPhone app would restart it)
export function goToLogin() {
  if (window.location.pathname !== "/login") navigate("/login");
}

// Handle 401 errors by redirecting to login if it's a refresh failure
async function handle401AndThrow(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    
    // If 401 with "refresh failed", the user's session expired - redirect to login
    if (res.status === 401 && text.includes("refresh failed")) {
      console.log("Session expired, redirecting to login...");
      goToLogin();
      // The app stays loaded (no reload), so end this request instead of
      // leaving it waiting forever
      throw new Error("401: Your sign-in has ended. Please sign in again.");
    }
    
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  // Check if data is FormData - if so, don't set Content-Type (browser will set it with boundary)
  const isFormData = data instanceof FormData;
  
  const res = await apiFetch(url, {
    method,
    headers: isFormData ? {} : (data ? { "Content-Type": "application/json" } : {}),
    body: isFormData ? (data as FormData) : (data ? JSON.stringify(data) : undefined),
    credentials: "include",
  });

  await handle401AndThrow(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    // Build URL from queryKey
    // Supports: ['/api/path'], ['/api/path', id], ['/api/path', id, 'subpath'], 
    // ['/api/path', id, 'subpath', { query: 'params' }]
    let url = queryKey[0] as string;
    let queryParams: Record<string, string> | null = null;
    
    // Process remaining elements
    for (let i = 1; i < queryKey.length; i++) {
      const element = queryKey[i];
      
      // If it's a string or number, append as path segment
      if (typeof element === 'string' || typeof element === 'number') {
        url += `/${element}`;
      }
      // If it's an object, treat as query params (should be last element)
      else if (typeof element === 'object' && element !== null) {
        queryParams = element as Record<string, string>;
      }
    }
    
    // Append query params if present
    if (queryParams) {
      const params = new URLSearchParams(queryParams);
      const queryString = params.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }
    
    const res = await apiFetch(url);

    if (res.status === 401) {
      const text = await res.text();
      
      // If 401 with "refresh failed", redirect to login
      if (text.includes("refresh failed")) {
        console.log("Session expired, redirecting to login...");
        goToLogin();
        throw new Error("401: Your sign-in has ended. Please sign in again.");
      }
      
      if (unauthorizedBehavior === "returnNull") {
        return null;
      }
      
      throw new Error(`401: ${text}`);
    }

    if (!res.ok) {
      const text = (await res.text()) || res.statusText;
      throw new Error(`${res.status}: ${text}`);
    }
    
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: true,
      staleTime: 5 * 60 * 1000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
