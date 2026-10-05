import { useMemo, useState, useRef } from "react";
import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  Clock,
  Users,
  Heart,
  HeartOff,
  Share2,
  Lock,
  Loader2,
  Printer,
  UserPlus,
  ImageIcon,
  Sparkles,
  Upload,
  Trash2,
  MoreHorizontal,
  Eye,
  Package,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-states";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { downscaleImage } from "@/lib/images";
import { ownerDisplayName, ownerInitials, type CookbookOwner } from "@/lib/cookbook-owner";
import { CookbookCollaboratorsDialog } from "@/components/cookbook-collaborators-dialog";
import { orderStatusLabel } from "@shared/print-checkout";
import type { CookbookPrintProject } from "@shared/schema";
import grammieImage from "@assets/image_1763329917086.png";

interface CookbookWithOwner {
  id: number;
  name: string;
  description: string | null;
  isPublic: boolean;
  ownerUserId: string;
  coverImage: string | null;
  owner?: CookbookOwner;
  recipeCount?: number;
}

interface RecipeSummary {
  id: string;
  title: string;
  dishImageThumbnail: string | null;
  totalTimeMinutes: number | null;
  servings: number | null;
  cuisineType: string | null;
  difficulty: string | null;
}

interface CookbookRecipesResponse {
  recipes: RecipeSummary[];
  hasMore: boolean;
  total: number;
}

const formatTime = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0 && mins > 0) return `${hours} hr ${mins} min`;
  if (hours > 0) return `${hours} hr`;
  return `${mins} min`;
};

export default function CookbookViewPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const cookbookId = parseInt(id || "0");
  const [collaboratorsOpen, setCollaboratorsOpen] = useState(false);

  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleCoverUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploadingCover(true);
    try {
      const formData = new FormData();
      formData.append("image", await downscaleImage(file), file.name.replace(/\.\w+$/, "") + ".jpg");

      const response = await fetch(`/api/cookbooks/${cookbookId}/cover-image`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) throw new Error("upload failed");

      queryClient.invalidateQueries({ queryKey: ["/api/cookbooks", cookbookId] });
      toast({ title: "Cover updated" });
    } catch {
      toast({
        title: "Couldn't upload the cover",
        description: "Try a JPG or PNG photo, or try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setIsUploadingCover(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleGenerateCover = async () => {
    setIsGeneratingCover(true);
    try {
      await apiRequest("POST", `/api/cookbooks/${cookbookId}/generate-cover`);
      queryClient.invalidateQueries({ queryKey: ["/api/cookbooks", cookbookId] });
      toast({ title: "New cover made", description: "Grammie drew a cover from your recipes. You can replace it any time." });
    } catch {
      toast({ title: "Couldn't make a cover", description: "Try again in a moment.", variant: "destructive" });
    } finally {
      setIsGeneratingCover(false);
    }
  };

  const handleDeleteCover = async () => {
    try {
      await apiRequest("DELETE", `/api/cookbooks/${cookbookId}/cover-image`);
      queryClient.invalidateQueries({ queryKey: ["/api/cookbooks", cookbookId] });
      toast({ title: "Cover removed" });
    } catch {
      toast({ title: "Couldn't remove the cover", description: "Try again in a moment.", variant: "destructive" });
    }
  };

  const { data: cookbook, isLoading: cookbookLoading, error: cookbookError, refetch } = useQuery<CookbookWithOwner>({
    queryKey: ["/api/cookbooks", cookbookId],
    queryFn: async () => {
      const response = await fetch(`/api/cookbooks/${cookbookId}`, { credentials: "include" });
      if (!response.ok) {
        if (response.status === 404) throw new Error("This cookbook doesn't exist, or it's private.");
        throw new Error("Check your connection and try again.");
      }
      return response.json();
    },
    enabled: cookbookId > 0,
  });

  const {
    data: recipesData,
    isLoading: recipesLoading,
    isError: recipesError,
    refetch: refetchRecipes,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<CookbookRecipesResponse>({
    queryKey: ["/api/cookbooks", cookbookId, "recipes"],
    queryFn: async ({ pageParam = 1 }) => {
      const response = await fetch(`/api/cookbooks/${cookbookId}/recipes?page=${pageParam}&limit=24`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load recipes");
      return response.json();
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => (lastPage.hasMore ? pages.length + 1 : undefined),
    enabled: cookbookId > 0 && !!cookbook,
    placeholderData: (previousData) => previousData,
  });

  const recipes = useMemo(() => recipesData?.pages.flatMap((page) => page.recipes) || [], [recipesData]);
  const totalRecipes = recipesData?.pages[0]?.total ?? cookbook?.recipeCount ?? 0;

  const { data: followedCookbookIds = [] } = useQuery<number[]>({
    queryKey: ["/api/cookbooks/following/ids"],
    enabled: !!user,
  });

  const isFollowing = followedCookbookIds.includes(cookbookId);
  const isOwner = !!user && user.id === cookbook?.ownerUserId;

  // The printed-book order, if one was placed, so it's visible here
  const { data: printProjects } = useQuery<CookbookPrintProject[]>({
    queryKey: ["/api/cookbooks", cookbookId, "print-projects"],
    enabled: isOwner,
  });
  const order = printProjects?.find((p) => p.luluOrderId);

  const followMutation = useMutation({
    mutationFn: async () => {
      if (isFollowing) {
        await apiRequest("DELETE", `/api/cookbooks/${cookbookId}/follow`);
      } else {
        await apiRequest("POST", `/api/cookbooks/${cookbookId}/follow`);
      }
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["/api/cookbooks/following/ids"] });
      const previousFollowing = queryClient.getQueryData<number[]>(["/api/cookbooks/following/ids"]);
      queryClient.setQueryData<number[]>(["/api/cookbooks/following/ids"], (old = []) =>
        isFollowing ? old.filter((id) => id !== cookbookId) : [...old, cookbookId],
      );
      return { previousFollowing };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousFollowing) {
        queryClient.setQueryData(["/api/cookbooks/following/ids"], context.previousFollowing);
      }
      toast({ title: "Couldn't update follow", description: "Try again in a moment.", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cookbooks/following/ids"] });
    },
  });

  const handleShare = async () => {
    const url = `${window.location.origin}/cookbook/${cookbookId}`;
    try {
      if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
        await navigator.share({ title: cookbook?.name, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast({
        title: "Link copied",
        description: cookbook?.isPublic
          ? "Anyone with the link can see this cookbook."
          : "This cookbook is private. Add people as collaborators so they can open it.",
      });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      toast({ title: "Couldn't copy the link", description: url, variant: "destructive" });
    }
  };

  const handleFollow = () => {
    if (!user) {
      toast({ title: "Sign in to follow cookbooks" });
      return;
    }
    followMutation.mutate();
  };

  const container = "mx-auto max-w-5xl px-4 py-6 md:px-6";

  if (cookbookLoading) {
    return (
      <div className={container}>
        <LoadingState variant="cards" rows={6} label="Loading cookbook" />
      </div>
    );
  }

  if (cookbookError || !cookbook) {
    return (
      <div className={container}>
        <PageHeader title="Cookbook" back={{ href: "/cookbooks", label: "Cookbooks" }} />
        <ErrorState
          title="Can't open this cookbook"
          description={cookbookError instanceof Error ? cookbookError.message : "This cookbook doesn't exist, or it's private."}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const ownerName = ownerDisplayName(cookbook.owner, isOwner);
  const initials = ownerInitials(cookbook.owner);
  const busyCover = isUploadingCover || isGeneratingCover;

  const coverImage = (
    <div className="relative flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-primary/10 sm:h-24 sm:w-20">
      {cookbook.coverImage ? (
        <img src={cookbook.coverImage} alt="" className="h-full w-full object-cover" />
      ) : (
        <BookOpen className="h-8 w-8 text-primary" aria-hidden />
      )}
      {busyCover && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <Loader2 className="h-6 w-6 animate-spin text-white" aria-label="Updating cover" />
        </div>
      )}
    </div>
  );

  const leading = isOwner ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Change cover"
          data-testid="button-cover-menu"
        >
          {coverImage}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => fileInputRef.current?.click()} disabled={busyCover} data-testid="menu-upload-cover">
          <Upload className="mr-2 h-4 w-4" aria-hidden /> Upload a cover photo
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleGenerateCover} disabled={busyCover} data-testid="menu-generate-cover">
          <Sparkles className="mr-2 h-4 w-4" aria-hidden /> Make a cover with AI
        </DropdownMenuItem>
        {cookbook.coverImage && (
          <DropdownMenuItem onClick={handleDeleteCover} className="text-destructive" data-testid="menu-remove-cover">
            <Trash2 className="mr-2 h-4 w-4" aria-hidden /> Remove cover
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : (
    coverImage
  );

  const byline = (
    <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
      <Link
        href={`/profile/${cookbook.ownerUserId}`}
        className="inline-flex min-h-11 items-center gap-2 rounded-md hover:underline"
        data-testid="link-cookbook-owner"
      >
        <Avatar className="h-7 w-7">
          <AvatarImage src={cookbook.owner?.avatar || undefined} alt="" />
          <AvatarFallback className="text-xs">{initials || <BookOpen className="h-4 w-4" aria-hidden />}</AvatarFallback>
        </Avatar>
        <span>by {ownerName}</span>
      </Link>
      <span>
        {totalRecipes} recipe{totalRecipes !== 1 ? "s" : ""}
      </span>
      {!cookbook.isPublic && (
        <span className="inline-flex items-center gap-1">
          <Lock className="h-4 w-4" aria-hidden /> Private
        </span>
      )}
    </span>
  );

  const primaryAction = isOwner ? (
    <Button asChild className="w-full sm:w-auto" data-testid="button-print-cookbook">
      <Link href={`/cookbook/${cookbookId}/print-editor`}>
        <Printer aria-hidden /> Create Physical Cookbook
      </Link>
    </Button>
  ) : cookbook.isPublic ? (
    <Button
      variant={isFollowing ? "outline" : "default"}
      onClick={handleFollow}
      disabled={followMutation.isPending}
      data-testid="button-follow-cookbook"
    >
      {isFollowing ? <><HeartOff aria-hidden /> Unfollow</> : <><Heart aria-hidden /> Follow</>}
    </Button>
  ) : undefined;

  const secondaryActions = (
    <>
      <Button variant="outline" onClick={handleShare} data-testid="button-share-cookbook">
        <Share2 aria-hidden /> Share
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="More actions" title="More actions" data-testid="button-cookbook-more">
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild data-testid="button-preview-cookbook">
            <Link href={`/cookbook/${cookbookId}/print`}>
              <Eye className="mr-2 h-4 w-4" aria-hidden /> Preview as a book
            </Link>
          </DropdownMenuItem>
          {isOwner && (
            <DropdownMenuItem onClick={() => setCollaboratorsOpen(true)} data-testid="button-manage-collaborators">
              <UserPlus className="mr-2 h-4 w-4" aria-hidden /> Collaborators
            </DropdownMenuItem>
          )}
          {isOwner && (
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()} disabled={busyCover}>
              <ImageIcon className="mr-2 h-4 w-4" aria-hidden /> Change cover
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  return (
    <div className={container}>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleCoverUpload}
        accept="image/*"
        className="hidden"
        data-testid="input-cover-upload"
      />

      <PageHeader
        back={{ href: "/cookbooks", label: "Cookbooks" }}
        leading={leading}
        title={<span data-testid="text-cookbook-name">{cookbook.name}</span>}
        description={
          <>
            {cookbook.description && <span className="block" data-testid="text-cookbook-description">{cookbook.description}</span>}
            {byline}
          </>
        }
        primaryAction={primaryAction}
        secondaryActions={secondaryActions}
      />

      {order && (
        <Link
          href={`/cookbook/${cookbookId}/print-editor?step=order`}
          className="mb-6 flex min-h-11 items-center gap-3 rounded-lg border bg-primary/5 p-4 hover:bg-primary/10"
          data-testid="link-print-order-status"
        >
          <Package className="h-5 w-5 shrink-0 text-primary" aria-hidden />
          <span className="text-sm">
            <span className="font-medium">Printed book order #{order.luluOrderId}</span>
            {" · "}
            {orderStatusLabel(order.luluOrderStatus)}
          </span>
          <span className="ml-auto text-sm font-medium text-primary">See order</span>
        </Link>
      )}

      <h2 className="sr-only">Recipes</h2>
      {recipesLoading ? (
        <LoadingState variant="cards" rows={6} label="Loading recipes" />
      ) : recipesError ? (
        <ErrorState title="Couldn't load the recipes" onRetry={() => refetchRecipes()} />
      ) : recipes.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No recipes in this cookbook yet"
          description={
            isOwner
              ? "Open any recipe and choose this cookbook to add it here."
              : "When recipes are added, they'll show up here."
          }
          action={
            isOwner ? (
              <Button asChild>
                <Link href="/">Go to your recipes</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {recipes.map((recipe) => (
              <li key={recipe.id}>
                <Link
                  href={`/recipe/${recipe.id}`}
                  className="flex h-full flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid={`card-recipe-${recipe.id}`}
                >
                  <div className="relative aspect-[4/3] bg-muted">
                    {recipe.dishImageThumbnail && !recipe.dishImageThumbnail.startsWith("data:image/svg") ? (
                      <img
                        src={recipe.dishImageThumbnail}
                        alt=""
                        loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <img src={grammieImage} alt="" className="h-16 w-16 object-contain opacity-50" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 p-3">
                    <h3 className="line-clamp-2 text-base font-medium leading-snug" data-testid={`text-recipe-title-${recipe.id}`}>
                      {recipe.title}
                    </h3>
                    {(recipe.totalTimeMinutes || recipe.servings) && (
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        {!!recipe.totalTimeMinutes && (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-4 w-4" aria-hidden />
                            {formatTime(recipe.totalTimeMinutes)}
                          </span>
                        )}
                        {!!recipe.servings && (
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-4 w-4" aria-hidden />
                            Serves {recipe.servings}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {hasNextPage && (
            <div className="mt-6 flex justify-center">
              <Button
                variant="outline"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                data-testid="button-load-more-recipes"
              >
                {isFetchingNextPage ? (
                  <><Loader2 className="animate-spin" aria-hidden /> Loading…</>
                ) : (
                  `Show more (${recipes.length} of ${totalRecipes})`
                )}
              </Button>
            </div>
          )}
        </>
      )}

      <CookbookCollaboratorsDialog
        cookbookId={cookbookId}
        cookbookName={cookbook.name}
        isOwner={isOwner}
        open={collaboratorsOpen}
        onOpenChange={setCollaboratorsOpen}
      />
    </div>
  );
}
