import type { ReactNode } from "react";
import { Link } from "wouter";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Check, ChefHat, Loader2, MoreHorizontal } from "lucide-react";
import { formatTimeAndServings } from "@shared/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// The one recipe card (docs/DESIGN_PRINCIPLES.md §4). Used on Recipes home;
// cookbook view, meal plans and search should adopt it too.
//
//   regular: photo on top, title, "45 min · 4 servings", contributor
//   compact: a row with a small thumbnail, for lists and pickers
//
// The whole card is one link (or one toggle in select mode). Everything else
// (favorite, share, delete…) lives in the 44px "…" menu, never on the photo.

export interface RecipeCardRecipe {
  id: string;
  title: string;
  dishImageThumbnail?: string | null;
  totalTimeMinutes?: number | null;
  servings?: number | null;
  enrichmentStatus?: string | null;
  owner?: {
    id: string;
    username?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  } | null;
}

export interface RecipeCardAction {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  destructive?: boolean;
  /** Draw a separator above this item */
  separated?: boolean;
  testId?: string;
}

export interface RecipeCardProps {
  recipe: RecipeCardRecipe;
  size?: "regular" | "compact";
  /** The signed-in user's id: the contributor is hidden on the viewer's own recipes */
  viewerId?: string | null;
  /** Where the card goes (default: the recipe page) */
  href?: string;
  /** Items for the "…" menu; no menu when empty */
  actions?: RecipeCardAction[];
  /** Select mode: the card becomes a toggle instead of a link */
  selectable?: boolean;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  /** Extra line under the meta (e.g. "Added by Mom") */
  footer?: ReactNode;
  className?: string;
}

/** "Jean Smith", or the username, or null */
export function contributorName(owner: RecipeCardRecipe["owner"]): string | null {
  if (!owner) return null;
  const full = [owner.firstName, owner.lastName].filter(Boolean).join(" ").trim();
  return full || owner.username || null;
}

const isPlaceholderImage = (url?: string | null) => !!url && url.startsWith("data:image/svg");

function StatusBadge({ status }: { status?: string | null }) {
  if (status === "extracting" || status === "enriching") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-background/95 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm">
        <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
        {status === "extracting" ? "Reading recipe…" : "Adding details…"}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-background/95 px-2.5 py-1 text-xs font-medium text-destructive shadow-sm">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        Details didn't finish
      </span>
    );
  }
  return null;
}

export function RecipeCard({
  recipe,
  size = "regular",
  viewerId,
  href,
  actions = [],
  selectable = false,
  selected = false,
  onSelectedChange,
  footer,
  className,
}: RecipeCardProps) {
  const compact = size === "compact";
  const meta = formatTimeAndServings(recipe.totalTimeMinutes, recipe.servings);
  const contributor = recipe.owner && recipe.owner.id !== viewerId ? contributorName(recipe.owner) : null;
  const placeholder = !recipe.dishImageThumbnail || isPlaceholderImage(recipe.dishImageThumbnail);
  const target = href ?? `/recipe/${recipe.id}`;

  // The title is the card's one link/toggle; its ::after stretches over the
  // whole card so the photo is tappable too, without nesting the menu button
  // inside a link.
  const stretch = "after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring";
  const titleClass = cn(
    "font-serif font-bold leading-snug text-foreground line-clamp-2 break-words",
    compact ? "text-base" : "text-base sm:text-lg",
  );
  const titleEl = selectable ? (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelectedChange?.(!selected)}
      className={cn(titleClass, stretch, "text-left")}
      data-testid={`toggle-select-recipe-${recipe.id}`}
    >
      {recipe.title}
    </button>
  ) : (
    <Link href={target} className={cn(titleClass, stretch)} data-testid={`link-recipe-${recipe.id}`}>
      {recipe.title}
    </Link>
  );

  const image = (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden bg-muted",
        compact ? "h-20 w-20 rounded-md" : "aspect-[4/3] w-full",
      )}
    >
      {placeholder ? (
        <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary" data-testid={`img-recipe-${recipe.id}`}>
          <ChefHat className={compact ? "h-8 w-8" : "h-12 w-12"} aria-hidden />
        </div>
      ) : (
        <img
          src={recipe.dishImageThumbnail!}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          data-testid={`img-recipe-${recipe.id}`}
        />
      )}
      {!compact && (
        <div className="absolute bottom-2 left-2 right-2">
          <StatusBadge status={recipe.enrichmentStatus} />
        </div>
      )}
      {selectable && (
        <span
          aria-hidden
          className={cn(
            "absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border-2 shadow-sm",
            selected ? "border-primary bg-primary text-primary-foreground" : "border-white bg-black/30 text-transparent",
          )}
        >
          <Check className="h-5 w-5" />
        </span>
      )}
    </div>
  );

  const menu =
    actions.length > 0 && !selectable ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "z-10 shrink-0 rounded-full",
              compact
                ? "relative -mr-1"
                : "!absolute right-2 top-2 border border-border bg-background/95 shadow-sm hover:bg-background",
            )}
            aria-label={`More actions for ${recipe.title}`}
            title="More actions"
            data-testid={`button-more-${recipe.id}`}
          >
            <MoreHorizontal className="!h-5 !w-5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[12rem]">
          {actions.map((action) => (
            <div key={action.label}>
              {action.separated && <DropdownMenuSeparator />}
              <DropdownMenuItem
                className={cn("min-h-11", action.destructive && "text-destructive focus:text-destructive")}
                onSelect={action.onSelect}
                data-testid={action.testId}
              >
                {action.icon && <action.icon aria-hidden />}
                {action.label}
              </DropdownMenuItem>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-lg border border-card-border bg-card text-card-foreground transition-shadow hover:shadow-md",
        selected && "ring-2 ring-primary",
        compact ? "flex items-center gap-3 p-2" : "flex flex-col",
        className,
      )}
      data-testid={`card-recipe-${recipe.id}`}
    >
      {image}
      <div className={cn("flex min-w-0 flex-1 items-start gap-1", compact ? "py-1" : "p-3 sm:p-4")}>
        <div className="min-w-0 flex-1">
          {titleEl}
          {meta && (
            <p className="mt-1 text-xs text-muted-foreground" data-testid={`text-recipe-meta-${recipe.id}`}>
              {meta}
            </p>
          )}
          {contributor && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground" data-testid={`text-recipe-contributor-${recipe.id}`}>
              From {contributor}
            </p>
          )}
          {compact && recipe.enrichmentStatus && (
            <div className="mt-1">
              <StatusBadge status={recipe.enrichmentStatus} />
            </div>
          )}
          {footer && <div className="relative z-10 mt-2">{footer}</div>}
        </div>
        {menu}
      </div>
    </article>
  );
}

/** Skeletons in the card's final shape (no layout shift) */
export function RecipeCardSkeleton({ size = "regular" }: { size?: "regular" | "compact" }) {
  if (size === "compact") {
    return (
      <div className="flex items-center gap-3 rounded-lg border p-2">
        <Skeleton className="h-20 w-20 rounded-md" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border">
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
      <div className="space-y-2 p-4">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}

/** The responsive grid recipe cards sit in */
// Two columns even on a 390px phone so several recipes fit on the first screen
export const RECIPE_GRID_CLASS = "grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4 md:gap-6";
