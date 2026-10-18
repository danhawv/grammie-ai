import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Copy, Globe, Loader2, Lock } from "lucide-react";
import type { Recipe } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { haptic, publicUrl } from "@/lib/platform";

// "Log in a tracker": neither MyFitnessPal nor Cronometer lets other apps add
// recipes, but both can import a recipe from its web link. The public recipe
// page carries the recipe data they read (server/routes/social.ts), so this
// sheet copies that link and says where to paste it. The numbers per serving
// are here too, for a quick manual entry instead.

type TrackerRecipe = Pick<Recipe, "id" | "title" | "isPublic" | "servings" | "calories" | "protein" | "carbohydrates" | "fat">;

const TRACKERS: { name: string; note?: string; steps: string[] }[] = [
  {
    name: "MyFitnessPal",
    steps: [
      "Open MyFitnessPal and go to Recipes, then Create a Recipe.",
      "Choose Add From Web and paste the link.",
      "Check each matched ingredient, set the servings, and save.",
    ],
  },
  {
    name: "Cronometer",
    note: "Importing recipes needs Cronometer Gold.",
    steps: [
      "Open Cronometer and start a new recipe.",
      "Choose Import Recipe and paste the link.",
      "Check each matched ingredient, set the servings, and save.",
    ],
  },
];

function round(n: number | null | undefined): number | null {
  return n != null && Number.isFinite(n) ? Math.round(n) : null;
}

export function RecipeTrackerSheet({
  recipe,
  open,
  onOpenChange,
  canMakePublic,
}: {
  recipe: TrackerRecipe;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The owner can switch a private recipe to public from here */
  canMakePublic: boolean;
}) {
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const link = publicUrl(`/recipe/${recipe.id}`);

  const makePublic = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/recipes/${recipe.id}`, { isPublic: true });
      return (await res.json()) as Recipe;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["/api/recipes", recipe.id], updated);
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      haptic("success");
      toast({ title: "Recipe is now public", description: "Anyone with the link can see it, and trackers can read it." });
    },
    onError: () => {
      toast({ title: "Couldn't make it public", description: "Check your connection and try again.", variant: "destructive" });
    },
  });

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      haptic("light");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast({ title: "Couldn't copy the link", description: `Copy it by hand: ${link}`, variant: "destructive" });
    }
  };

  const facts = [
    { label: "Calories", value: round(recipe.calories), unit: "" },
    { label: "Protein", value: round(recipe.protein), unit: " g" },
    { label: "Carbs", value: round(recipe.carbohydrates), unit: " g" },
    { label: "Fat", value: round(recipe.fat), unit: " g" },
  ].filter((f) => f.value != null);

  const servings = recipe.servings > 0 ? recipe.servings : null;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) setCopied(false); onOpenChange(o); }}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 pb-[env(safe-area-inset-bottom)] sm:max-w-lg md:max-h-none"
        data-testid="sheet-log-in-tracker"
      >
        <SheetHeader className="border-b px-4 py-4 pr-14 text-left">
          <SheetTitle className="font-serif text-2xl">Log in a tracker</SheetTitle>
          <SheetDescription className="text-base">
            Add {recipe.title} to MyFitnessPal or Cronometer from its link.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5">
          {recipe.isPublic ? (
            <section aria-labelledby="tracker-link" className="space-y-2">
              <h3 id="tracker-link" className="text-lg font-semibold">1. Copy the recipe link</h3>
              <p className="break-all rounded-md border bg-muted/40 px-3 py-2 text-sm" data-testid="text-tracker-link">{link}</p>
              <Button className="min-h-11 w-full sm:w-auto" onClick={copyLink} data-testid="button-copy-tracker-link">
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? "Link copied" : "Copy link"}
              </Button>
            </section>
          ) : (
            <section aria-labelledby="tracker-private" className="space-y-3 rounded-lg border bg-card p-4">
              <h3 id="tracker-private" className="flex items-center gap-2 text-lg font-semibold">
                <Lock className="h-5 w-5" aria-hidden />
                This recipe is private
              </h3>
              <p className="text-base">
                Trackers can only read recipes that are public. {canMakePublic
                  ? "Make it public to get a link that works, or enter the numbers below by hand."
                  : "Only the person who owns it can make it public. You can still enter the numbers below by hand."}
              </p>
              {canMakePublic && (
                <>
                  <p className="text-sm text-muted-foreground">Public recipes can be seen by anyone with the link and may show up in Grammie's recipe list.</p>
                  <Button
                    className="min-h-11 w-full sm:w-auto"
                    onClick={() => makePublic.mutate()}
                    disabled={makePublic.isPending}
                    data-testid="button-tracker-make-public"
                  >
                    {makePublic.isPending ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Globe aria-hidden />}
                    Make public
                  </Button>
                </>
              )}
            </section>
          )}

          <section aria-labelledby="tracker-steps" className="space-y-4">
            <h3 id="tracker-steps" className="text-lg font-semibold">{recipe.isPublic ? "2. Paste it in your tracker" : "Then paste it in your tracker"}</h3>
            {TRACKERS.map((t) => (
              <div key={t.name} className="rounded-lg border bg-card p-4">
                <p className="text-base font-semibold">{t.name}</p>
                {t.note && <p className="text-sm text-muted-foreground">{t.note}</p>}
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-base">
                  {t.steps.map((s) => <li key={s}>{s}</li>)}
                </ol>
              </div>
            ))}
            {servings && (
              <p className="text-base">
                This recipe makes <span className="font-semibold">{servings} {servings === 1 ? "serving" : "servings"}</span>. Use the same number in your tracker so each serving matches.
              </p>
            )}
          </section>

          {facts.length > 0 && (
            <section aria-labelledby="tracker-quick-add" className="space-y-2">
              <h3 id="tracker-quick-add" className="text-lg font-semibold">Or quick add</h3>
              <p className="text-base text-muted-foreground">Grammie's estimate for one serving:</p>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {facts.map((f) => (
                  <div key={f.label} className="rounded-md border px-3 py-2">
                    <dt className="text-sm text-muted-foreground">{f.label}</dt>
                    <dd className="text-lg font-semibold tabular-nums" data-testid={`text-tracker-${f.label.toLowerCase()}`}>{f.value}{f.unit}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
