import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChefHat, Clock, Lightbulb, Loader2, Package, ShoppingCart, Sparkles, Users } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { ToastAction } from "@/components/ui/toast";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-states";
import { useToast } from "@/hooks/use-toast";
import grammieImage from "@assets/image_1763329917086.png";

// Recipes ranked by how much of each your pantry covers. Matching rules live
// in shared/pantry-match.ts (server route: GET /api/recipes/what-can-i-make).

interface Suggestion {
  recipe: {
    id: string;
    title: string;
    image: string | null;
    totalTimeMinutes: number | null;
    servings: number | null;
    cuisine: string | null;
  };
  haveCount: number;
  total: number;
  have: { ingredient: string; pantryItem: string }[];
  missing: string[];
  staples: string[];
  expiringItemsUsed: number;
}

interface WhatCanIMakeResponse {
  pantryItemCount: number;
  recipesChecked: number;
  results: Suggestion[];
  appliedFilters?: { dietaryRestrictions: string[]; dislikedIngredients: string[] };
}

type Substitution = { ingredient: string; suggestions: string[]; notes?: string };

function CoverageBar({ have, total }: { have: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((have / total) * 100);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  );
}

function SuggestionCard({ s }: { s: Suggestion }) {
  const { toast } = useToast();
  const [subs, setSubs] = useState<Substitution[] | null>(null);
  const missingCount = s.missing.length;

  const addMissing = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/recipes/${s.recipe.id}/add-missing-to-grocery`, { missingIngredients: s.missing }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/grocery-list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/grocery-list/by-aisle"] });
      toast({
        title: `Added ${missingCount} item${missingCount === 1 ? "" : "s"} to your grocery list`,
        action: (
          <ToastAction altText="Open grocery list" asChild>
            <Link href="/kitchen?tab=grocery">Open list</Link>
          </ToastAction>
        ),
      });
    },
  });

  const getSubs = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/recipes/substitutions", { ingredients: s.missing })).json() as Promise<{ substitutions: Substitution[] }>,
    onSuccess: (data) => setSubs(data.substitutions || []),
  });

  return (
    <li className="overflow-hidden rounded-lg border bg-card" data-testid={`recipe-card-${s.recipe.id}`}>
      <Link
        href={`/recipe/${s.recipe.id}`}
        className="flex gap-4 p-4 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {s.recipe.image && !s.recipe.image.startsWith("data:image/svg") ? (
          <img src={s.recipe.image} alt="" className="h-20 w-20 shrink-0 rounded-md object-cover sm:h-24 sm:w-24" loading="lazy" />
        ) : (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md bg-muted sm:h-24 sm:w-24">
            <img src={grammieImage} alt="" className="h-10 w-10 object-contain opacity-50" />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <h3 className="text-lg font-semibold leading-snug">{s.recipe.title}</h3>
          <p className="text-base font-medium">
            You have {s.haveCount} of {s.total}
            {missingCount === 0 && <span className="text-green-800 dark:text-green-300"> · Ready to cook</span>}
          </p>
          <CoverageBar have={s.haveCount} total={s.total} />
          <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
            {s.recipe.totalTimeMinutes ? (
              <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" aria-hidden />{s.recipe.totalTimeMinutes} min</span>
            ) : null}
            {s.recipe.servings ? (
              <span className="inline-flex items-center gap-1"><Users className="h-4 w-4" aria-hidden />Serves {s.recipe.servings}</span>
            ) : null}
            {s.expiringItemsUsed > 0 && (
              <span className="font-medium text-amber-900 dark:text-amber-200">
                Uses {s.expiringItemsUsed} item{s.expiringItemsUsed === 1 ? "" : "s"} to use soon
              </span>
            )}
          </p>
        </div>
      </Link>

      <div className="space-y-3 border-t px-4 py-3">
        <p className="text-sm">
          <span className="font-medium">From your pantry: </span>
          <span className="text-muted-foreground">{s.have.map((h) => h.ingredient).join(", ")}</span>
        </p>
        {missingCount > 0 && (
          <>
            <p className="text-sm">
              <span className="font-medium">You'd need: </span>
              {s.missing.join(", ")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => addMissing.mutate()} disabled={addMissing.isPending || addMissing.isSuccess}>
                {addMissing.isPending ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <ShoppingCart aria-hidden />}
                {addMissing.isSuccess ? "Added to grocery list" : `Add ${missingCount} to grocery list`}
              </Button>
              {!subs && (
                <Button variant="ghost" onClick={() => getSubs.mutate()} disabled={getSubs.isPending}>
                  {getSubs.isPending ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Lightbulb aria-hidden />}
                  Ideas for swaps
                </Button>
              )}
            </div>
          </>
        )}
        {addMissing.isError && (
          <p role="alert" className="text-sm text-destructive">Couldn't add to your grocery list. Check your connection and try again.</p>
        )}
        {getSubs.isError && (
          <p role="alert" className="text-sm text-destructive">Couldn't get swap ideas right now. Try again in a moment.</p>
        )}
        {subs && (
          <div className="space-y-1 rounded-md bg-muted/50 p-3">
            <p className="flex items-center gap-1 text-sm font-medium text-primary">
              <Sparkles className="h-4 w-4" aria-hidden /> Suggested by Grammie — check they suit the recipe
            </p>
            {subs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No good swaps for these.</p>
            ) : (
              subs.map((sub, i) => (
                <p key={i} className="text-sm">
                  <span className="font-medium">{sub.ingredient}:</span> {sub.suggestions.join(", ")}
                  {sub.notes && <span className="text-muted-foreground"> ({sub.notes})</span>}
                </p>
              ))
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function Section({ title, description, items }: { title: string; description?: string; items: Suggestion[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-3" aria-label={title}>
      <div>
        <h2 className="text-xl font-semibold">
          {title} <span className="text-muted-foreground">({items.length})</span>
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <ul className="space-y-3">
        {items.map((s) => (
          <SuggestionCard key={s.recipe.id} s={s} />
        ))}
      </ul>
    </section>
  );
}

export default function WhatCanIMakePage() {
  const [quickOnly, setQuickOnly] = useState(false);
  const [useSoonOnly, setUseSoonOnly] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<WhatCanIMakeResponse>({
    queryKey: ["/api/recipes/what-can-i-make"],
    staleTime: 60_000,
  });

  const results = data?.results ?? [];
  const anyUseSoon = results.some((r) => r.expiringItemsUsed > 0);
  const filtered = useMemo(
    () =>
      results.filter(
        (r) =>
          (!quickOnly || (r.recipe.totalTimeMinutes != null && r.recipe.totalTimeMinutes <= 30)) &&
          (!useSoonOnly || r.expiringItemsUsed > 0),
      ),
    [results, quickOnly, useSoonOnly],
  );
  const ready = filtered.filter((r) => r.missing.length === 0);
  const close = filtered.filter((r) => r.missing.length > 0 && r.missing.length <= 2);
  const more = filtered.filter((r) => r.missing.length > 2);
  const diet = data?.appliedFilters?.dietaryRestrictions ?? [];

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <PageHeader
        title="What can I make?"
        back={{ href: "/kitchen?tab=pantry", label: "Pantry" }}
        description={
          data && data.pantryItemCount > 0 ? (
            <>
              Using the {data.pantryItemCount} item{data.pantryItemCount === 1 ? "" : "s"} in your pantry. Salt, pepper, oil,
              water, flour, sugar and common spices count as on hand.
              {diet.length > 0 && <> Only showing {diet.join(", ")} recipes, from your food preferences.</>}
            </>
          ) : undefined
        }
      />

      {isLoading ? (
        <LoadingState label="Checking your recipes against your pantry" rows={4} />
      ) : isError ? (
        <ErrorState title="Couldn't check your recipes" description="Check your connection and try again." onRetry={() => refetch()} />
      ) : !data || data.pantryItemCount === 0 ? (
        <EmptyState
          icon={Package}
          title="Add what you have first"
          description="Tell Grammie what's in your fridge and cupboards, and she'll rank your recipes by how much you already have."
          action={
            <Button asChild>
              <Link href="/kitchen?tab=pantry">Go to Pantry</Link>
            </Button>
          }
        />
      ) : results.length === 0 ? (
        <EmptyState
          icon={ChefHat}
          title="None of your recipes use these items yet"
          description={`We checked ${data.recipesChecked} recipes. Add a few more things you have, like onions, rice or cheese, and try again.`}
          action={
            <Button asChild>
              <Link href="/kitchen?tab=pantry">Add to pantry</Link>
            </Button>
          }
          secondaryAction={
            <Button asChild variant="outline">
              <Link href="/recipe-creator">Create a recipe with Grammie</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filters">
            <Button variant={quickOnly ? "secondary" : "outline"} aria-pressed={quickOnly} onClick={() => setQuickOnly(!quickOnly)}>
              30 minutes or less
            </Button>
            {anyUseSoon && (
              <Button variant={useSoonOnly ? "secondary" : "outline"} aria-pressed={useSoonOnly} onClick={() => setUseSoonOnly(!useSoonOnly)}>
                Uses items to use soon
              </Button>
            )}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={ChefHat}
              title="No recipes match these filters"
              action={
                <Button variant="outline" onClick={() => { setQuickOnly(false); setUseSoonOnly(false); }}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <>
              <Section title="Ready to cook" description="You have everything these need." items={ready} />
              <Section title="Need 1 or 2 things" items={close} />
              <Section title="Need a few more things" items={more} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
