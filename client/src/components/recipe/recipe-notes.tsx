import { Link } from "wouter";
import type { Recipe } from "@shared/schema";
import { ArrowLeftRight, ExternalLink, Wand2, ZoomIn } from "lucide-react";
import { SiInstagram, SiTiktok, SiYoutube } from "react-icons/si";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

// Where the recipe came from: the family's notes, the original card image,
// the social post it was imported from, or the recipe it was adapted from.

function SourceAttribution({
  platform,
  sourceUrl,
  creatorUsername,
  creatorAvatar,
}: {
  platform: string;
  sourceUrl: string;
  creatorUsername?: string | null;
  creatorAvatar?: string | null;
}) {
  const config =
    platform === "instagram"
      ? { name: "Instagram", Icon: SiInstagram, iconClass: "text-white", bubble: "bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500" }
      : platform === "tiktok"
        ? { name: "TikTok", Icon: SiTiktok, iconClass: "text-foreground", bubble: "bg-muted" }
        : platform === "youtube"
          ? { name: "YouTube", Icon: SiYoutube, iconClass: "text-white", bubble: "bg-red-600" }
          : { name: "social media", Icon: ExternalLink, iconClass: "text-muted-foreground", bubble: "bg-muted" };
  const { Icon } = config;

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {creatorAvatar ? (
          <Avatar className="h-10 w-10 shrink-0 border-2 border-muted">
            <AvatarImage src={creatorAvatar} alt="" />
            <AvatarFallback><Icon className="h-5 w-5" /></AvatarFallback>
          </Avatar>
        ) : (
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${config.bubble}`}>
            <Icon className={`h-5 w-5 ${config.iconClass}`} aria-hidden />
          </div>
        )}
        <div className="flex min-w-0 flex-col">
          <span className="text-sm text-muted-foreground">Imported from {config.name}</span>
          {creatorUsername && (
            <span className="truncate font-medium" data-testid="text-source-creator">@{creatorUsername}</span>
          )}
        </div>
      </div>
      <Button variant="outline" asChild className="shrink-0 self-start sm:self-center" data-testid="button-view-original-post">
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink aria-hidden />
          View original post
        </a>
      </Button>
    </div>
  );
}

export function RecipeNotes({ recipe, onViewImage }: { recipe: Recipe; onViewImage: (src: string) => void }) {
  const hasSocial = !!(recipe.socialSourcePlatform && recipe.socialSourceUrl);
  const hasAnything = !!recipe.description || !!recipe.handwrittenImage || hasSocial || !!recipe.derivedFromRecipeId;
  if (!hasAnything) return null;

  return (
    <section aria-labelledby="notes-heading" className="space-y-4">
      <h2 id="notes-heading" className="font-serif text-2xl font-bold">Notes and source</h2>

      {recipe.description && (
        <div>
          <h3 className="mb-1 text-base font-semibold">Original Author's Notes</h3>
          <p className="max-w-prose whitespace-pre-line text-lg leading-relaxed" data-testid="text-recipe-description">
            {recipe.description}
          </p>
        </div>
      )}

      {recipe.derivedFromRecipeId && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Wand2 className="h-5 w-5 text-primary" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">Personalized variation</p>
            {recipe.variationNotes && (
              <p className="text-base font-medium" data-testid="text-variation-notes">{recipe.variationNotes}</p>
            )}
          </div>
          <Button variant="outline" asChild data-testid="button-view-original-recipe">
            <Link href={`/recipe/${recipe.derivedFromRecipeId}`}>
              <ArrowLeftRight aria-hidden />
              View original recipe
            </Link>
          </Button>
        </div>
      )}

      {hasSocial && (
        <SourceAttribution
          platform={recipe.socialSourcePlatform!}
          sourceUrl={recipe.socialSourceUrl!}
          creatorUsername={recipe.socialSourceCreatorUsername}
          creatorAvatar={recipe.socialSourceCreatorAvatar}
        />
      )}

      {recipe.handwrittenImage && (
        <div>
          <h3 className="mb-2 text-base font-semibold">Original recipe card</h3>
          <button
            type="button"
            onClick={() => onViewImage(recipe.handwrittenImage!)}
            className="group relative block w-full max-w-xl overflow-hidden rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="View the original recipe card full size"
            data-testid="button-view-handwritten"
          >
            <img src={recipe.handwrittenImage} alt="Original recipe card" className="h-auto w-full" />
            <span className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded-md bg-background/90 px-2.5 py-1.5 text-sm font-medium shadow">
              <ZoomIn className="h-4 w-4" aria-hidden />
              View full size
            </span>
          </button>
        </div>
      )}
    </section>
  );
}
