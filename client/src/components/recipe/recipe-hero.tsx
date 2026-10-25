import { useEffect, useMemo, useState } from "react";
import type { Recipe } from "@shared/schema";
import { AlertTriangle, ImageIcon, Loader2, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreditNote } from "@/components/credits";
import { RecipeImageCarousel } from "@/components/recipe-image-manager";
import { heroImages, type HeroImage } from "@/lib/recipe-images";
import { CardViewer } from "./card-viewer";
import { isPlaceholderImage } from "./recipe-utils";
import grammieImage from "@assets/image_1763329917086.png";
import { mediaUrl } from "@/lib/platform";

// The dish photo, kept short (about a third of the screen) so the title, key
// numbers and "Start cooking" are visible on a phone without scrolling, plus
// plain-language status for background work on this recipe. When the recipe
// came from a handwritten card, a small snapshot of the card sits pinned over
// the photo's corner; tapping it opens the card full screen.

export function RecipeHero({
  recipe,
  onRemakePhoto,
  remakingPhoto = false,
  canRotateCard = false,
}: {
  recipe: Recipe;
  /** Owner only: make a new photo from the whole recipe */
  onRemakePhoto?: () => void;
  remakingPhoto?: boolean;
  /** Owner only: lets the full-screen viewer turn a sideways card */
  canRotateCard?: boolean;
}) {
  const [displayImage, setDisplayImage] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  // Dish photo first, the card second, then the other photos
  const images = useMemo(() => heroImages(recipe, displayImage), [recipe.dishImages, recipe.handwrittenImage, displayImage]);
  useEffect(() => { setIndex(0); }, [recipe.id]);
  const shownIndex = Math.min(index, Math.max(images.length - 1, 0));
  const card = images.find((img) => img.isCard) ?? null;
  const cardIndex = card ? images.indexOf(card) : -1;
  // The snapshot is shown over the primary photo only; not on the card
  // itself, and not while the "making a new photo" note covers the corner
  const showSnapshot = !!card && images.length > 1 && shownIndex === 0 && !remakingPhoto;

  const openViewer = (at: number) => {
    setViewerIndex(at);
    setViewerOpen(true);
  };

  // Show the thumbnail first, then swap in the full image once it has loaded
  useEffect(() => {
    setDisplayImage(recipe.dishImageThumbnail || recipe.dishImage || null);
  }, [recipe.id, recipe.dishImageThumbnail, recipe.dishImage]);

  useEffect(() => {
    if (!recipe.dishImage || recipe.dishImage === displayImage || isPlaceholderImage(recipe.dishImage)) return;
    let cancelled = false;
    const img = new Image();
    img.src = mediaUrl(recipe.dishImage);
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
      <RecipeImageCarousel images={images} index={shownIndex} onIndexChange={setIndex} arrowsRaised={showSnapshot} />
      {showSnapshot && card && <CardSnapshot card={card} onOpen={() => openViewer(cardIndex)} />}
      <CardViewer
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        images={images}
        initialIndex={viewerIndex}
        recipeId={recipe.id}
        canRotate={canRotateCard}
      />
      {onRemakePhoto && !isPlaceholderImage(recipe.dishImage) && (
        <Button
          size="sm"
          variant="secondary"
          className="absolute right-3 top-3 z-20 min-h-11 bg-background/85 backdrop-blur-sm"
          onClick={onRemakePhoto}
          disabled={remakingPhoto}
          title="Photo doesn't look right? Grammie makes a new one from the full recipe."
          data-testid="button-remake-photo"
        >
          {remakingPhoto ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Wand2 aria-hidden />}
          {remakingPhoto ? "Making…" : <>Remake photo<CreditNote action="dish_photo" /></>}
        </Button>
      )}
      {remakingPhoto && (
        <div role="status" className="absolute inset-x-0 bottom-0 z-20 bg-background/85 p-3 text-center text-sm backdrop-blur-sm" data-testid="status-remaking-photo">
          Making a new photo from the ingredients and steps. This takes about 10 seconds.
        </div>
      )}
    </div>
  );
}

/**
 * The handwritten card as a small tilted snapshot pinned over the photo's
 * bottom-right corner: a white polaroid-style border, a strip of tape at the
 * top and a soft shadow. About 36% of the hero's width on a phone, capped
 * at 150px on iPad and desktop so it never covers much of the photo.
 */
function CardSnapshot({ card, onOpen }: { card: HeroImage; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group absolute bottom-3 right-3 z-20 w-[36%] max-w-[150px] min-w-[7rem] -rotate-[7deg] rounded-[2px] bg-white p-1 pb-6 text-left shadow-[0_6px_18px_rgba(0,0,0,0.35)] motion-safe:transition-transform motion-safe:duration-200 hover:-rotate-[5deg] hover:scale-[1.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
      aria-label="See the original handwritten card"
      title="See the original handwritten card"
      data-testid="button-card-snapshot"
    >
      <img
        src={mediaUrl(card.thumbnailUrl || card.url)}
        alt=""
        draggable={false}
        className="aspect-[4/3] w-full bg-neutral-100 object-cover"
      />
      <span className="absolute inset-x-0 bottom-1 text-center font-serif text-xs italic leading-none text-neutral-500">
        the original
      </span>
      {/* Tape */}
      <span
        aria-hidden
        className="absolute -top-2 left-1/2 h-4 w-12 -translate-x-1/2 rotate-[4deg] rounded-[1px] bg-amber-50/75 shadow-[0_1px_2px_rgba(0,0,0,0.15)] backdrop-blur-[1px]"
      />
    </button>
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
  // Bulk imports: the photo is made in a Gemini batch, minutes to hours
  // later. Say so calmly instead of spinning.
  if (recipe.imageGenerationStatus === "queued") {
    items.push(
      <p key="image-queued" role="status" className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="badge-image-queued">
        <ImageIcon className="h-4 w-4" aria-hidden />
        Photo coming soon
      </p>,
    );
  } else if (isPlaceholderImage(recipe.dishImage) || recipe.imageGenerationStatus === "generating") {
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
