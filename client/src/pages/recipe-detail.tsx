import { useCallback, useEffect, useState } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { Recipe } from "@shared/schema";
import { ArrowLeft, ChefHat, Loader2, Mic, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/page-states";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { RecipeImageManager } from "@/components/recipe-image-manager";
import { MakeYourOwnModal } from "@/components/make-your-own-modal";
import { CookbookSelect } from "@/components/cookbook-select";
import { VoiceAssistant } from "@/components/voice-assistant";
import { CookingMode, CookingTimerTray } from "@/components/cooking-mode";
import { useUnitSystem } from "@/hooks/use-unit-system";
import { useCookingTimers } from "@/hooks/use-cooking-session";
import { RecipeHero, RecipeStatus } from "@/components/recipe/recipe-hero";
import { RecipeKeyFacts } from "@/components/recipe/recipe-key-facts";
import { RecipeIngredients } from "@/components/recipe/recipe-ingredients";
import { RecipeSteps } from "@/components/recipe/recipe-steps";
import { RecipeNotes } from "@/components/recipe/recipe-notes";
import { RecipeExtras } from "@/components/recipe/recipe-extras";
import { RecipeActionsMenu } from "@/components/recipe/recipe-actions";
import { RecipePrintView } from "@/components/recipe/recipe-print-view";
import { getDisplayIngredients, getDisplayInstructions } from "@/components/recipe/recipe-utils";

// The recipe page, recipe first (docs/DESIGN_PRINCIPLES.md rule 1):
// title, a short photo and the key numbers; a big "Start cooking"; then
// ingredients, steps, notes and source; and finally one collapsed
// "More from Grammie" section with everything else.

/** Same width and order as the page, so nothing jumps when it loads */
function RecipeDetailSkeleton() {
  // Say what's happening if it takes more than a moment
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 2000);
    return () => clearTimeout(t);
  }, []);
  return (
    <main className="mx-auto max-w-3xl px-4 pb-12 pt-4 md:px-6 md:pt-6" role="status" aria-label="Loading recipe">
      {slow ? <p className="mb-3 h-6 text-sm text-muted-foreground">Opening the recipe…</p> : <Skeleton className="mb-3 h-6 w-24" />}
      <Skeleton className="mb-4 h-9 w-3/4" />
      <Skeleton className="h-[30vh] max-h-[26rem] min-h-[11rem] w-full rounded-lg sm:h-[35vh]" />
      <Skeleton className="mt-4 h-24 w-full rounded-lg" />
      <Skeleton className="mt-4 h-14 w-full rounded-md" />
      <div className="mt-10 space-y-3">
        <Skeleton className="h-8 w-40" />
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    </main>
  );
}

export default function RecipeDetail() {
  const [, params] = useRoute("/recipe/:id");
  const recipeId = params?.id;
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [recipeId]);

  const [servings, setServings] = useState<number>(1);
  const [checkedIngredients, setCheckedIngredients] = useState<Set<number>>(new Set());
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [modalImage, setModalImage] = useState<string>("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [imageManagerOpen, setImageManagerOpen] = useState(false);
  const [makeYourOwnOpen, setMakeYourOwnOpen] = useState(false);
  const [addToCookbookOpen, setAddToCookbookOpen] = useState(false);
  const [selectedCookbookId, setSelectedCookbookId] = useState<string | undefined>();
  const [cookingModeOpen, setCookingModeOpen] = useState(false);
  const [cookingStartStep, setCookingStartStep] = useState<number | null>(null);
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [unitSystem, setUnitSystem] = useUnitSystem();
  const timers = useCookingTimers(recipeId);

  const { data: recipe, isLoading, error, refetch, isFetching } = useQuery<Recipe>({
    queryKey: ["/api/recipes", recipeId],
    enabled: !!recipeId,
    refetchInterval: (query: any) => {
      const data = query.state.data;
      if (!data) return false;
      // Poll every 3s while enrichment, content enrichment or image generation
      // runs (the light status check below covers the first seconds)
      const busy =
        data.enrichmentStatus === "enriching" ||
        data.enrichmentStatus === "extracting" ||
        data.contentEnrichmentStatus === "enriching" ||
        data.imageGenerationStatus === "pending" ||
        data.imageGenerationStatus === "generating";
      return busy ? 3000 : false;
    },
  });

  // A new import opens here straight away. While it's being read, check the
  // light status endpoint every second (the full recipe carries photos) and
  // reload the recipe as soon as it moves on a step.
  const readingStage = recipe && (recipe.enrichmentStatus === "extracting" || recipe.enrichmentStatus === "enriching") ? recipe.enrichmentStatus : null;
  useQuery({
    queryKey: ["/api/recipe-imports/status", recipeId, "detail"],
    enabled: !!readingStage && !!user && user.id === recipe?.ownerUserId,
    refetchInterval: 1000,
    queryFn: async () => {
      const res = await fetch(`/api/recipe-imports/status?ids=${encodeURIComponent(recipeId ?? "")}`, { credentials: "include" });
      if (!res.ok) return null;
      const data = (await res.json()) as { items: Array<{ stage?: string }> };
      const stage = data.items[0]?.stage;
      if (stage && stage !== readingStage) queryClient.invalidateQueries({ queryKey: ["/api/recipes", recipeId] });
      return data;
    },
  });

  useEffect(() => {
    if (recipe) setServings(recipe.servings);
  }, [recipe]);

  // A different recipe starts with nothing checked and the extras closed
  useEffect(() => {
    setCheckedIngredients(new Set());
    setExtrasOpen(false);
  }, [recipeId]);

  const isOwner = !!(user && recipe && user.id === recipe.ownerUserId);
  const isAdmin = !!(user && (user as any).isAdmin);
  const showOwnerControls = isOwner || isAdmin;

  // Scaling isn't saved; the server returns the recipe at the new size
  const scaleMutation = useMutation({
    mutationFn: async (newServings: number) => {
      const response = await apiRequest("POST", `/api/recipes/${recipeId}/scale`, { servings: newServings });
      return await response.json();
    },
    onSuccess: (data: Recipe) => {
      queryClient.setQueryData(["/api/recipes", recipeId], data);
    },
    onError: () => {
      toast({ title: "Couldn't change the servings", description: "Check your connection and try again.", variant: "destructive" });
    },
  });

  const retryEnrichmentMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/recipes/${recipeId}/enrich`, {});
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes", recipeId] });
    },
  });

  const forceEnrichMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/recipes/${recipeId}/enrich?force=true`, {});
      return await response.json();
    },
    onSuccess: () => {
      toast({ title: "Enrichment queued", description: "Recipe enrichment has been queued and will complete shortly." });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes", recipeId] });
    },
    onError: (err: Error) => {
      toast({ title: "Enrichment failed", description: err.message || "Failed to queue enrichment", variant: "destructive" });
    },
  });

  const regenerateImageMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/recipes/${recipeId}/regenerate-image`, {});
      return await response.json();
    },
    onSuccess: () => {
      toast({ title: "Image generation queued", description: "New dish image generation has been queued." });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes", recipeId] });
    },
    onError: (err: Error) => {
      toast({ title: "Image generation failed", description: err.message || "Failed to queue image generation", variant: "destructive" });
    },
  });

  const addToGroceryListMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("AUTH_REQUIRED");
      return apiRequest("POST", `/api/grocery-list/recipes/${recipeId}`);
    },
    onSuccess: () => {
      toast({ title: "Added to grocery list", description: "Recipe ingredients added to your grocery list" });
      queryClient.invalidateQueries({ queryKey: ["/api/grocery-list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/grocery-list/by-aisle"] });
    },
    onError: (err: Error) => {
      if (err.message === "AUTH_REQUIRED" || err.message?.includes("401") || err.message?.includes("Unauthorized") || err.message?.includes("not authenticated")) {
        toast({
          title: "Sign in required",
          description: "You need to be logged in to use this feature",
          action: (
            <Button variant="outline" size="sm" onClick={() => setLocation("/auth")}>
              Sign In
            </Button>
          ),
        });
      } else {
        toast({ title: "Failed to add to grocery list", description: err.message || "An error occurred", variant: "destructive" });
      }
    },
  });

  const addToCookbookMutation = useMutation({
    mutationFn: async (cookbookId: string) => {
      const response = await apiRequest("POST", `/api/cookbooks/${cookbookId}/recipes`, { recipeId });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Recipe added to cookbook" });
      setAddToCookbookOpen(false);
      setSelectedCookbookId(undefined);
      queryClient.invalidateQueries({ queryKey: ["/api/cookbooks"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add recipe", description: err.message || "An error occurred", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/recipes/${recipeId}`),
    onSuccess: () => {
      toast({ title: "Recipe deleted successfully" });
      setDeleteDialogOpen(false);
      setLocation("/");
    },
    onError: async (err: any) => {
      let errorMessage = "An error occurred while deleting the recipe";
      if (err instanceof Response) {
        try {
          const errorData = await err.json();
          errorMessage = errorData.message || errorData.error || err.statusText;
        } catch {
          errorMessage = err.statusText || errorMessage;
        }
      } else if (err.message) {
        errorMessage = err.message;
      }
      toast({ title: "Failed to delete recipe", description: errorMessage, variant: "destructive" });
    },
  });

  const handleServingsChange = (newServings: number) => {
    if (newServings < 1) return;
    setServings(newServings);
    scaleMutation.mutate(newServings);
  };

  const toggleIngredient = useCallback((index: number) => {
    setCheckedIngredients((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const openCooking = useCallback((startStep: number | null = null) => {
    setCookingStartStep(startStep);
    setCookingModeOpen(true);
  }, []);
  const closeCooking = useCallback(() => setCookingModeOpen(false), []);

  const shareRecipe = async () => {
    const url = window.location.href;
    const title = recipe?.title || "Recipe";
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: "Paste it anywhere to share this recipe." });
    } catch (e: any) {
      if (e?.name === "AbortError") return; // closed the share sheet
      toast({ title: "Couldn't share", description: `Copy this link instead: ${url}`, variant: "destructive" });
    }
  };

  if (isLoading) return <RecipeDetailSkeleton />;

  if (!recipe) {
    const message = error instanceof Error ? error.message : "";
    const back = (
      <Button asChild>
        <Link href="/">Back to recipes</Link>
      </Button>
    );
    if (!error || message.startsWith("404")) {
      return (
        <main className="mx-auto max-w-3xl px-4 py-10">
          <EmptyState
            icon={ChefHat}
            title="Recipe not found"
            description="It may have been deleted, or the link may be wrong."
            action={back}
          />
        </main>
      );
    }
    if (message.startsWith("401") || message.startsWith("403")) {
      return (
        <main className="mx-auto max-w-3xl px-4 py-10">
          <EmptyState
            icon={ChefHat}
            title="This recipe is private"
            description={user ? "Ask the person who shared it to give you access." : "Sign in to see this recipe."}
            action={user ? back : <Button asChild><Link href="/login">Sign in</Link></Button>}
          />
        </main>
      );
    }
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <ErrorState
          title="Couldn't load this recipe"
          description={isFetching ? "Trying again…" : "Check your connection and try again. Nothing has been lost."}
          onRetry={() => refetch()}
        />
      </main>
    );
  }

  const displayIngredients = getDisplayIngredients(recipe);
  const displayInstructions = getDisplayInstructions(recipe);
  const runningTimer = timers.timers.find((t) => !t.done) ?? timers.timers[0];

  return (
    <>
      <main className="mx-auto max-w-3xl px-4 pb-12 pt-4 print:hidden md:px-6 md:pt-6">
        {/* Back and "More" share a row so the title and key numbers fit the first phone screen */}
        <div className="mb-2 flex items-center justify-between gap-2">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
            data-testid="button-back-to-recipes"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Recipes
          </Link>
          <RecipeActionsMenu
            recipeId={recipe.id}
            canEdit={isOwner}
            canManage={showOwnerControls}
            canDelete={showOwnerControls}
            signedIn={!!user}
            canMakeYourOwn={!!user && !recipe.derivedFromRecipeId}
            reEnrichDisabled={forceEnrichMutation.isPending || (recipe.enrichmentStatus !== "ready" && recipe.enrichmentStatus !== "failed")}
            reEnriching={forceEnrichMutation.isPending}
            deleting={deleteMutation.isPending}
            onAddToCookbook={() => setAddToCookbookOpen(true)}
            onShare={shareRecipe}
            onMakeYourOwn={() => setMakeYourOwnOpen(true)}
            onManageImages={() => setImageManagerOpen(true)}
            onReEnrich={() => forceEnrichMutation.mutate()}
            onDelete={() => setDeleteDialogOpen(true)}
          />
        </div>
        <PageHeader className="mb-4" title={<span data-testid="text-recipe-title">{recipe.title}</span>} />

        <div className="space-y-4">
          <RecipeHero recipe={recipe} />
          <RecipeStatus
            recipe={recipe}
            onRetryEnrichment={() => retryEnrichmentMutation.mutate()}
            retryingEnrichment={retryEnrichmentMutation.isPending}
            onRetryImage={() => regenerateImageMutation.mutate()}
            retryingImage={regenerateImageMutation.isPending}
          />
          <RecipeKeyFacts
            prepMinutes={recipe.prepTimeMinutes}
            cookMinutes={recipe.cookTimeMinutes}
            totalMinutes={recipe.totalTimeMinutes}
            servings={servings}
            onServingsChange={handleServingsChange}
            scaling={scaleMutation.isPending}
          />

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Button
              size="lg"
              className="min-h-14 w-full text-lg sm:w-auto"
              onClick={() => openCooking()}
              disabled={displayInstructions.length === 0}
              data-testid="button-start-cooking"
            >
              <ChefHat className="!size-5" aria-hidden />
              Start cooking
            </Button>
            <div className="flex flex-wrap gap-2 [&>*]:flex-auto sm:[&>*]:flex-none">
              <Button
                variant="outline"
                onClick={() => addToGroceryListMutation.mutate()}
                disabled={addToGroceryListMutation.isPending}
                data-testid="button-add-to-grocery-list"
              >
                {addToGroceryListMutation.isPending ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <ShoppingCart aria-hidden />}
                Add to grocery list
              </Button>
              <VoiceAssistant
                mode="cooking"
                recipeContext={{
                  name: recipe.title || "Recipe",
                  recipeId: recipe.id,
                  ingredients: recipe.normalizedIngredients?.map((ing: any) => ing.raw || ing.item) || [],
                  instructions: recipe.normalizedInstructions?.map((inst: any) => inst.text) || (Array.isArray(recipe.instructions) ? recipe.instructions : []),
                }}
                trigger={
                  <Button variant="outline" data-testid="button-cooking-assistant">
                    <Mic aria-hidden />
                    Talk to Grammie
                  </Button>
                }
              />
            </div>
          </div>
        </div>

        <div className="mt-10 space-y-12">
          <RecipeIngredients
            ingredients={displayIngredients}
            equipment={recipe.equipment}
            unitSystem={unitSystem}
            onUnitSystemChange={setUnitSystem}
            checked={checkedIngredients}
            onToggle={toggleIngredient}
            onClearChecked={() => setCheckedIngredients(new Set())}
          />
          <RecipeSteps
            instructions={displayInstructions}
            ingredients={displayIngredients}
            instructionsGenerated={recipe.instructionsGenerated}
            originalInstructions={recipe.originalInstructions}
          />
          <RecipeNotes
            recipe={recipe}
            onViewImage={(src) => {
              setModalImage(src);
              setImageModalOpen(true);
            }}
          />
          <RecipeExtras recipe={recipe} open={extrasOpen} onOpenChange={setExtrasOpen} />
        </div>

        {/* Room for the timer tray so it never covers the end of the page */}
        {timers.timers.length > 0 && !cookingModeOpen && <div className="h-28" aria-hidden />}
      </main>

      <Dialog open={imageModalOpen} onOpenChange={setImageModalOpen}>
        <DialogContent className="max-w-4xl p-0">
          <DialogTitle className="sr-only">Original recipe card</DialogTitle>
          <img src={modalImage} alt="Original recipe card, full size" className="h-auto w-full" data-testid="img-modal-full-size" />
        </DialogContent>
      </Dialog>

      {showOwnerControls && (
        <RecipeImageManager
          recipeId={recipeId || ""}
          dishImages={recipe.dishImages || []}
          currentImage={recipe.dishImage || null}
          isOwner={isOwner}
          recipeName={recipe.title || ""}
          onImagesChange={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/recipes", recipeId] });
          }}
          open={imageManagerOpen}
          onOpenChange={setImageManagerOpen}
          hideTrigger={true}
        />
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this recipe?</AlertDialogTitle>
            <AlertDialogDescription>
              "{recipe.title}" will be deleted. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Keep recipe</AlertDialogCancel>
            <AlertDialogAction
              className="border border-destructive-border bg-destructive text-destructive-foreground"
              onClick={(e) => {
                e.preventDefault();
                deleteMutation.mutate();
              }}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete recipe"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={addToCookbookOpen} onOpenChange={setAddToCookbookOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add to Cookbook</AlertDialogTitle>
            <AlertDialogDescription>Choose a cookbook to add this recipe to, or create a new one.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <CookbookSelect
              value={selectedCookbookId}
              onValueChange={setSelectedCookbookId}
              placeholder="Select a cookbook"
              allowNone={false}
              testId="select-add-to-cookbook"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedCookbookId(undefined)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedCookbookId) addToCookbookMutation.mutate(selectedCookbookId);
              }}
              disabled={!selectedCookbookId || addToCookbookMutation.isPending}
            >
              {addToCookbookMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 motion-safe:animate-spin" aria-hidden />
                  Adding…
                </>
              ) : (
                "Add to Cookbook"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {recipeId && (
        <MakeYourOwnModal open={makeYourOwnOpen} onOpenChange={setMakeYourOwnOpen} recipeId={recipeId} recipeTitle={recipe.title} />
      )}

      {!cookingModeOpen && (
        <CookingTimerTray timers={timers} onOpen={() => openCooking(runningTimer?.stepIndex ?? null)} />
      )}

      <CookingMode
        open={cookingModeOpen}
        onClose={closeCooking}
        recipeId={recipeId}
        title={recipe.title}
        instructions={displayInstructions}
        ingredients={displayIngredients}
        timers={timers}
        checkedIngredients={checkedIngredients}
        onToggleIngredient={toggleIngredient}
        initialStep={cookingStartStep}
      />

      <RecipePrintView recipe={recipe} ingredients={displayIngredients} instructions={displayInstructions} />
    </>
  );
}
