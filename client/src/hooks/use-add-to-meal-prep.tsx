import { useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { errorText, mealPrepApi, mealPrepKeys, type ThisWeekAddResult } from "@/lib/meal-prep-api";

// "Add to this week's meal prep" from a recipe's "…" menu (recipe cards and
// the recipe page). The server decides what that means this week (pin it on
// the draft, buy it for the approved week, or start a plan); this hook turns
// the answer into one plain toast, or opens the walkthrough when the family
// hasn't set meal prep up yet.

export interface MealPrepRecipe {
  id: string;
  title: string;
}

/** The walkthrough's address with this recipe waiting to be pinned */
export const mealPrepPinHref = (recipeId: string) => `/meal-prep?pin=${encodeURIComponent(recipeId)}`;

export function useAddToMealPrep() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const mutation = useMutation({
    mutationFn: (recipe: MealPrepRecipe) => mealPrepApi.addToThisWeek(recipe.id),
    onSuccess: (result: ThisWeekAddResult, recipe) => {
      if (result.outcome === "needsSetup") {
        navigate(mealPrepPinHref(recipe.id));
        return;
      }
      queryClient.invalidateQueries({ queryKey: mealPrepKeys.plans });
      queryClient.invalidateQueries({ queryKey: mealPrepKeys.plan(result.planId) });
      queryClient.invalidateQueries({ queryKey: ["/api/grocery-list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/grocery-list/by-aisle"] });
      const viewPlan = (
        <ToastAction altText="View this week's plan" asChild>
          <Link href={`/meal-prep/${result.planId}`}>View plan</Link>
        </ToastAction>
      );
      if (result.outcome === "pinned") {
        toast({
          title: "Added to this week's meal prep",
          description: "Grammie is fitting it into the plan. The grocery list updates when you approve the plan.",
          action: viewPlan,
        });
      } else if (result.outcome === "created") {
        toast({ title: "Started this week's meal prep", description: `${recipe.title} will be in the plan.`, action: viewPlan });
      } else if (result.outcome === "already") {
        toast({ title: "It's already in this week's plan", action: viewPlan });
      } else if (result.outcome === "grocery") {
        toast({
          title: "Added to your grocery list",
          description: `This week's plan is already approved, so the ingredients went straight onto the list${result.calendarAdded ? " and your calendar" : ""}.`,
          action: (
            <ToastAction altText="Open the grocery list" asChild>
              <Link href="/kitchen?tab=grocery">Open list</Link>
            </ToastAction>
          ),
        });
      }
    },
    onError: (err) => {
      toast({
        title: "Couldn't add it to meal prep",
        description: errorText(err, "Check your connection and try again."),
        variant: "destructive",
      });
    },
  });

  return {
    add: (recipe: MealPrepRecipe) => mutation.mutate(recipe),
    /** true while this recipe's request runs (so its menu item can grey out) */
    isAdding: (recipeId: string) => mutation.isPending && mutation.variables?.id === recipeId,
    isPending: mutation.isPending,
  };
}
