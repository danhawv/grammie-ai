import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ArrowLeft, Utensils } from "lucide-react";
import type { Recipe } from "@shared/schema";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-states";
import { RecipeIngredients } from "@/components/recipe/recipe-ingredients";
import { RecipeSteps } from "@/components/recipe/recipe-steps";
import { getDisplayIngredients, getDisplayInstructions } from "@/components/recipe/recipe-utils";
import { ConflictBadges } from "@/components/party/party-bits";
import { useAuth } from "@/hooks/useAuth";
import { useUnitSystem } from "@/hooks/use-unit-system";
import { mediaUrl } from "@/lib/platform";
import { PartyApiError, partyApi, partyErrorText, partyKeys } from "@/lib/party-api";
import { formatScale, guestPath, isImporting, scaleIngredient } from "@/lib/party-format";
import { PartyChrome } from "./party-guest";

// /p/:token/dish/:dishId — one dish's recipe, read-only, for anyone with the
// invite link (the take-home recipe cards' codes open this). Dinner-party
// dishes can show the amounts scaled for the whole table.

export default function PartyDishPage() {
  const { token, dishId } = useParams<{ token: string; dishId: string }>();
  const { user, isLoading: authLoading } = useAuth();
  const [unitSystem, setUnitSystem] = useUnitSystem();
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [scaled, setScaled] = useState(true);

  const party = useQuery({ queryKey: partyKeys.invite(token), queryFn: () => partyApi.byToken(token), enabled: !authLoading });
  const dish = party.data?.dishes.find((d) => d.id === dishId) ?? null;
  const recipeQuery = useQuery({
    queryKey: partyKeys.dishRecipe(token, dishId),
    queryFn: () => partyApi.dishRecipe(token, dishId),
    enabled: !authLoading,
    refetchInterval: () => (isImporting(dish?.recipe) ? 3000 : false),
  });
  const recipe = recipeQuery.data as Recipe | undefined;

  useEffect(() => {
    if (recipe?.title) document.title = `${recipe.title} · Grammie`;
  }, [recipe?.title]);

  const scale = party.data?.style === "dinner" && dish && dish.scale !== 1 ? dish.scale : 1;
  const ingredients = useMemo(() => {
    if (!recipe) return [];
    const list = getDisplayIngredients(recipe);
    return scaled && scale !== 1 ? list.map((i: any) => (typeof i === "object" ? scaleIngredient(i, scale) : i)) : list;
  }, [recipe, scaled, scale]);
  const instructions = useMemo(() => (recipe ? getDisplayInstructions(recipe) : []), [recipe]);

  const back = (
    <Button variant="ghost" asChild className="-ml-3">
      <Link href={guestPath(token)}><ArrowLeft aria-hidden /> {party.data?.title ?? "The party"}</Link>
    </Button>
  );

  const loading = authLoading || recipeQuery.isLoading;
  return (
    <PartyChrome signedIn={!!user} token={token}>
      {back}
      {loading ? (
        <LoadingState label="Opening the recipe" rows={6} className="mt-4" />
      ) : recipeQuery.error instanceof PartyApiError && recipeQuery.error.status === 404 ? (
        <EmptyState
          icon={Utensils}
          title="This recipe isn't here anymore"
          description="The dish may have come off the menu, or the party's link changed."
          className="mt-4"
        />
      ) : recipeQuery.isError || !recipe ? (
        <ErrorState title="Couldn't open the recipe" description={partyErrorText(recipeQuery.error)} onRetry={() => recipeQuery.refetch()} className="mt-4" />
      ) : (
        <article className="mt-4 space-y-8">
          <header className="space-y-3">
            {recipe.dishImage && <img src={mediaUrl(recipe.dishImage)} alt="" className="aspect-[4/3] w-full rounded-lg object-cover" />}
            <h1 className="font-serif text-3xl font-bold leading-tight break-words">{recipe.title}</h1>
            {dish && <p className="text-base text-muted-foreground">Brought by {dish.guestName}</p>}
            {recipe.description && <p className="text-lg">{recipe.description}</p>}
            {isImporting(dish?.recipe) && <p className="text-base text-muted-foreground" role="status">Grammie is still reading this recipe. It fills in by itself.</p>}
            {dish && <ConflictBadges dish={dish} />}
            {scale !== 1 && dish?.makeServings && (
              <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
                <Switch id="scaled" checked={scaled} onCheckedChange={setScaled} />
                <Label htmlFor="scaled" className="text-base">
                  Amounts for the party: {formatScale(scale)}× the recipe, enough for {dish.makeServings}
                </Label>
              </div>
            )}
            {(scale === 1 || !scaled) && recipe.servings ? <p className="text-base">Serves {recipe.servings}</p> : null}
          </header>
          <RecipeIngredients
            ingredients={ingredients}
            equipment={recipe.equipment}
            unitSystem={unitSystem}
            onUnitSystemChange={setUnitSystem}
            checked={checked}
            onToggle={(i) => setChecked((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })}
            onClearChecked={() => setChecked(new Set())}
          />
          {scaled && scale !== 1 && (
            <p className="text-sm text-muted-foreground">Lines without a measured amount (like “salt to taste”) aren't changed.</p>
          )}
          <RecipeSteps instructions={instructions} ingredients={ingredients} />
        </article>
      )}
    </PartyChrome>
  );
}
