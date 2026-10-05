import { Link } from "wouter";
import {
  BookPlus,
  Images,
  Loader2,
  MoreHorizontal,
  Pencil,
  Printer,
  RefreshCw,
  Share2,
  Trash2,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// The recipe page's "…" menu: everything that isn't cooking from the recipe.

const ITEM = "min-h-11 text-base";

export function RecipeActionsMenu({
  recipeId,
  canEdit,
  canManage,
  canDelete,
  signedIn,
  canMakeYourOwn,
  reEnrichDisabled,
  reEnriching,
  deleting,
  onAddToCookbook,
  onShare,
  onMakeYourOwn,
  onManageImages,
  onReEnrich,
  onDelete,
}: {
  recipeId: string;
  canEdit: boolean;
  canManage: boolean;
  canDelete: boolean;
  signedIn: boolean;
  canMakeYourOwn: boolean;
  reEnrichDisabled: boolean;
  reEnriching: boolean;
  deleting: boolean;
  onAddToCookbook: () => void;
  onShare: () => void;
  onMakeYourOwn: () => void;
  onManageImages: () => void;
  onReEnrich: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" data-testid="button-recipe-actions" aria-label="More recipe actions">
          <MoreHorizontal aria-hidden />
          More
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {canEdit && (
          <DropdownMenuItem asChild className={ITEM} data-testid="menu-edit-recipe">
            <Link href={`/recipe/${recipeId}/edit`}>
              <Pencil aria-hidden />
              Edit recipe
            </Link>
          </DropdownMenuItem>
        )}
        {signedIn && (
          <DropdownMenuItem onClick={onAddToCookbook} className={ITEM} data-testid="menu-add-to-cookbook">
            <BookPlus aria-hidden />
            Add to cookbook
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onShare} className={ITEM} data-testid="menu-share-recipe">
          <Share2 aria-hidden />
          Share
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.print()} className={ITEM} data-testid="menu-print-recipe">
          <Printer aria-hidden />
          Print recipe
        </DropdownMenuItem>
        {canMakeYourOwn && (
          <DropdownMenuItem onClick={onMakeYourOwn} className={ITEM} data-testid="button-make-your-own">
            <Wand2 aria-hidden />
            Make your own version
          </DropdownMenuItem>
        )}
        {canManage && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onManageImages} className={ITEM} data-testid="menu-manage-images">
              <Images aria-hidden />
              Manage photos
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onReEnrich} disabled={reEnrichDisabled} className={ITEM} data-testid="menu-re-enrich">
              {reEnriching ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
              Re-enrich
            </DropdownMenuItem>
          </>
        )}
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              disabled={deleting}
              className={`${ITEM} text-destructive focus:text-destructive`}
              data-testid="menu-delete-recipe"
            >
              {deleting ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              Delete recipe
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
