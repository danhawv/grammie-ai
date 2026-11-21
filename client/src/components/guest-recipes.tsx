import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import type { PaginatedRecipes } from "@shared/schema";
import type { GuestStatus } from "@shared/guest";
import { Button } from "@/components/ui/button";
import { RecipeCard, RECIPE_GRID_CLASS } from "@/components/recipe-card";
import { apiFetch } from "@/lib/platform";
import { fetchGuestStatus, guestSignInPath, guestToken } from "@/lib/guest";

// The Recipes tab for someone who added recipes without an account: their
// own recipes (private, only this device sees them) above everything else,
// and a gentle nudge to make a free account so they're kept.
export function GuestRecipes() {
  const hasToken = !!guestToken();
  const { data: status } = useQuery<GuestStatus>({
    queryKey: ["/api/guest/me"],
    queryFn: fetchGuestStatus,
    enabled: hasToken,
  });
  const { data } = useQuery<PaginatedRecipes>({
    queryKey: ["/api/recipes", { scope: "my", limit: "24", guest: "1" }],
    enabled: hasToken && !!status?.isGuest,
    queryFn: async () => {
      const res = await apiFetch("/api/recipes?scope=my&limit=24");
      if (!res.ok) throw new Error("We couldn't load your recipes.");
      return res.json();
    },
    // Keep checking while Grammie is still reading one
    refetchInterval: (q) =>
      q.state.data?.recipes.some((r) => r.enrichmentStatus === "extracting" || r.enrichmentStatus === "enriching") ? 3000 : false,
  });

  const recipes = data?.recipes ?? [];
  if (!status?.isGuest || recipes.length === 0) return null;
  const left = Math.max(0, status.limit - status.recipeCount);

  return (
    <section className="mb-8 space-y-4" aria-labelledby="guest-recipes-title" data-testid="section-guest-recipes">
      <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
        <h2 id="guest-recipes-title" className="font-serif text-2xl font-bold">Your recipes</h2>
        <p className="text-base">
          {left > 0
            ? `They're saved on this device only. You can add ${left} more without an account. Make a free account to keep them safe and add as many as you like.`
            : "They're saved on this device only. Make a free account to keep them safe and add more — your recipes come with you."}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild className="h-11 text-base"><Link href={guestSignInPath("signup")}>Sign up — it's free</Link></Button>
          <Button asChild variant="outline" className="h-11 text-base"><Link href={guestSignInPath("signin")}>Sign in</Link></Button>
        </div>
      </div>
      <div className={RECIPE_GRID_CLASS}>
        {recipes.map((recipe) => (
          <RecipeCard key={recipe.id} recipe={recipe} viewerId={recipe.owner?.id ?? null} />
        ))}
      </div>
    </section>
  );
}
