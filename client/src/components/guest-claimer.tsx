import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { claimGuestRecipes, guestToken } from "@/lib/guest";

// After someone who added recipes without an account signs up (or signs in)
// on this device, their recipes move to the account once, quietly, and the
// guest token is forgotten. Renders nothing.
export function GuestClaimer() {
  const { isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const tried = useRef(false);

  useEffect(() => {
    if (isLoading || !isAuthenticated || tried.current || !guestToken()) return;
    tried.current = true;
    claimGuestRecipes()
      .then(({ claimed, moved }) => {
        if (!claimed) return;
        queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/recipe") });
        queryClient.invalidateQueries({ queryKey: ["/api/guest/me"] });
        if (moved > 0) {
          toast({
            title: moved === 1 ? "Your recipe is in your account" : `Your ${moved} recipes are in your account`,
            description: "You'll find them under Recipes.",
          });
        }
      })
      // Keep the token and try again next time the app opens
      .catch((err) => console.warn("[Guest] Couldn't move guest recipes yet:", err));
  }, [isAuthenticated, isLoading, toast]);

  return null;
}
