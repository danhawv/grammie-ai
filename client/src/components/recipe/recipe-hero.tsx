import { useEffect, useState } from "react";
import type { Recipe } from "@shared/schema";
import { AlertTriangle, ImageIcon, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecipeImageCarousel } from "@/components/recipe-image-manager";
import { isPlaceholderImage } from "./recipe-utils";
import grammieImage from "@assets/image_1763329917086.png";

// The dish photo, kept short (about a third of the screen) so the title, key
// numbers and "Start cooking" are visible on a phone without scrolling, plus
// plain-language status for background work on this recipe.

export function RecipeHero({ recipe }: { recipe: Recipe }) {
  const [displayImage, setDisplayImage] = useState<string | null>(null);

  // Show the thumbnail first, then swap in the full image once it has loaded
  useEffect(() => {
    setDisplayImage(recipe.dishImageThumbnail || recipe.dishImage || null);
  }, [recipe.id, recipe.dishImageThumbnail, recipe.dishImage]);

  useEffect(() => {
    if (!recipe.dishImage || recipe.dishImage === displayImage || isPlaceholderImage(recipe.dishImage)) return;
    let cancelled = false;
    const img = new Image();
    img.src = recipe.dishImage;
    img.onload = () => {
      if (!cancelled) setDisplayImage(recipe.dishImage);
    };
    return () => { cancelled = true; };
  }, [recipe.dishImage, displayImage]);

  const hasImages = (recipe.dishImages && recipe.dishImages.length > 0) || !!displayImage;

  if (!hasImages) {
    return (
      <div className="flex h-36 w-full items-center justify-center rounded-lg bg-muted sm:h-44">
        <img src={grammieImage} alt="" className="h-28 w-28 object-contain opacity-60" />
      </div>
    );
  }

  return (
    <div className="relative h-[30vh] max-h-[26rem] min-h-[11rem] sm:h-[35vh] w-full overflow-hidden rounded-lg bg-muted">
      <RecipeImageCarousel dishImages={recipe.dishImages || []} currentImage={displayImage} />
    </div>
  );
}

/** "Reading the recipe…", "Making a photo…", and failures with a Retry */
export function RecipeStatus({
  recipe,
  onRetryEnrichment,
  retryingEnrichment,
  onRetryImage,
  retryingImage,
}: {
  recipe: Recipe;
  onRetryEnrichment: () => void;
  retryingEnrichment: boolean;
  onRetryImage: () => void;
  retryingImage: boolean;
}) {
  const items: JSX.Element[] = [];
  const busy = (key: string, testId: string, text: string) => (
    <p key={key} role="status" className="flex items-center gap-2 text-sm text-muted-foreground" data-testid={testId}>
      <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
      {text}
    </p>
  );

  if (recipe.enrichmentStatus === "extracting") items.push(busy("extracting", "badge-extracting", "Reading the recipe…"));
  if (recipe.enrichmentStatus === "enriching") items.push(busy("enriching", "badge-enriching", "Adding details like times and nutrition…"));
  if (isPlaceholderImage(recipe.dishImage) || recipe.imageGenerationStatus === "generating") {
    items.push(busy("image", "badge-image-generating", "Making a photo of the dish…"));
  }

  if (recipe.enrichmentStatus === "failed") {
    items.push(
      <div key="enrich-failed" role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3" data-testid="badge-enrichment-failed">
        <p className="flex items-center gap-2 text-sm font-medium text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          Grammie couldn't finish adding details to this recipe.
        </p>
        {recipe.enrichmentError && (
          <p className="mt-1 text-sm text-muted-foreground" data-testid="text-enrichment-error">{recipe.enrichmentError}</p>
        )}
        <Button size="sm" variant="outline" className="mt-2 min-h-11" onClick={onRetryEnrichment} disabled={retryingEnrichment} data-testid="button-retry-enrichment">
          {retryingEnrichment ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
          {retryingEnrichment ? "Trying again…" : "Try again"}
        </Button>
      </div>,
    );
  }

  if (recipe.imageGenerationStatus === "failed") {
    items.push(
      <div key="image-failed" role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3" data-testid="badge-image-failed">
        <p className="flex items-center gap-2 text-sm font-medium text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          The dish photo couldn't be made.
        </p>
        {recipe.imageGenerationError && (
          <p className="mt-1 text-sm text-muted-foreground" data-testid="text-image-error">{recipe.imageGenerationError}</p>
        )}
        <Button size="sm" variant="outline" className="mt-2 min-h-11" onClick={onRetryImage} disabled={retryingImage} data-testid="button-retry-image">
          {retryingImage ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <ImageIcon aria-hidden />}
          {retryingImage ? "Trying again…" : "Try the photo again"}
        </Button>
      </div>,
    );
  }

  if (items.length === 0) return null;
  return <div className="space-y-2">{items}</div>;
}
