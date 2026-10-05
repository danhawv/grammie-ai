import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BookOpen, Globe, Heart, HeartOff, MoreHorizontal, Plus, Printer, Share2 } from "lucide-react";
import { pluralize } from "@shared/format";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-states";
import { CreateCookbookDialog } from "@/components/create-cookbook-dialog";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

// The Cookbooks tab (/cookbooks): your cookbooks, ones you follow, and public
// ones to discover. Each card opens the cookbook page.

type Scope = "mine" | "following" | "public";

interface CookbookSummary {
  id: number;
  name: string;
  description?: string | null;
  ownerUserId: string;
  isPublic: boolean;
  recipeCount?: number;
}

const SCOPES: { value: Scope; label: string }[] = [
  { value: "mine", label: "Mine" },
  { value: "following", label: "Following" },
  { value: "public", label: "Discover" },
];

export function CookbooksBrowser() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [scope, setScope] = useState<Scope>("mine");
  const [createOpen, setCreateOpen] = useState(false);
  const effectiveScope: Scope = user ? scope : "public";

  const queryKey =
    effectiveScope === "mine" ? ["/api/cookbooks"] : ["/api/cookbooks", { scope: effectiveScope }];
  const { data: cookbooks = [], isLoading, isError, refetch } = useQuery<CookbookSummary[]>({ queryKey });

  const { data: followedIds = [] } = useQuery<number[]>({
    queryKey: ["/api/cookbooks/following/ids"],
    enabled: !!user,
    retry: false,
  });
  const followed = useMemo(() => new Set(followedIds), [followedIds]);

  const followMutation = useMutation({
    mutationFn: async ({ id, following }: { id: number; following: boolean }) => {
      await apiRequest(following ? "DELETE" : "POST", `/api/cookbooks/${id}/follow`);
    },
    onMutate: async ({ id, following }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/cookbooks/following/ids"] });
      const previous = queryClient.getQueryData<number[]>(["/api/cookbooks/following/ids"]);
      queryClient.setQueryData<number[]>(["/api/cookbooks/following/ids"], (old = []) =>
        following ? old.filter((x) => x !== id) : [...old, id],
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["/api/cookbooks/following/ids"], ctx.previous);
      toast({ title: "Couldn't update. Check your connection and try again.", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cookbooks/following/ids"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cookbooks"] });
    },
  });

  const share = async (id: number) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/cookbook/${id}`);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Couldn't copy the link", variant: "destructive" });
    }
  };

  const emptyCopy: Record<Scope, { title: string; description: string }> = {
    mine: {
      title: "No cookbooks yet",
      description: "A cookbook gathers family recipes in one place, to share or to print as a real book.",
    },
    following: {
      title: "You're not following any cookbooks",
      description: "Follow a public cookbook from Discover and it will show up here.",
    },
    public: {
      title: "No public cookbooks yet",
      description: "Check back later for cookbooks other families have shared.",
    },
  };

  return (
    <div className="mx-auto max-w-7xl px-4 pb-20 pt-6 md:px-6 md:pb-10">
      <PageHeader
        title="Cookbooks"
        description={!isLoading && !isError ? pluralize(cookbooks.length, "cookbook") : undefined}
        primaryAction={
          user ? (
            <Button onClick={() => setCreateOpen(true)} data-testid="button-new-cookbook">
              <Plus aria-hidden /> New cookbook
            </Button>
          ) : undefined
        }
      />

      {user && (
        <div role="tablist" aria-label="Which cookbooks" className="mb-6 inline-flex rounded-lg border p-1">
          {SCOPES.map((s) => (
            <button
              key={s.value}
              role="tab"
              type="button"
              aria-selected={scope === s.value}
              onClick={() => setScope(s.value)}
              className={cn(
                "min-h-11 rounded-md px-4 text-sm font-medium transition-colors",
                scope === s.value ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent",
              )}
              data-testid={`button-cookbooks-${s.value}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <LoadingState variant="cards" rows={6} label="Loading cookbooks" />
      ) : isError ? (
        <ErrorState title="Couldn't load cookbooks" onRetry={() => refetch()} />
      ) : cookbooks.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={emptyCopy[effectiveScope].title}
          description={!user ? "Sign in to make your own cookbook." : emptyCopy[effectiveScope].description}
          action={
            user && effectiveScope === "mine" ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus aria-hidden /> New cookbook
              </Button>
            ) : user && effectiveScope === "following" ? (
              <Button variant="outline" onClick={() => setScope("public")}>
                Discover cookbooks
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 md:gap-6">
          {cookbooks.map((cookbook) => {
            const isOwn = cookbook.ownerUserId === user?.id;
            const isFollowing = followed.has(cookbook.id);
            const canFollow = !!user && !isOwn && cookbook.isPublic;
            return (
              <article
                key={cookbook.id}
                className="relative flex items-start gap-4 rounded-lg border border-card-border bg-card p-4 transition-shadow hover:shadow-md md:p-6"
                data-testid={`card-cookbook-${cookbook.id}`}
              >
                <BookOpen className="mt-1 h-8 w-8 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/cookbook/${cookbook.id}`}
                    className="font-serif text-xl font-bold leading-snug after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
                    data-testid={`link-cookbook-${cookbook.id}`}
                  >
                    {cookbook.name}
                  </Link>
                  {cookbook.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{cookbook.description}</p>
                  )}
                  <p className="mt-2 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span>{pluralize(cookbook.recipeCount || 0, "recipe")}</span>
                    {cookbook.isPublic && (
                      <span className="inline-flex items-center gap-1">
                        <Globe className="h-3.5 w-3.5" aria-hidden /> Public
                      </span>
                    )}
                    {isFollowing && (
                      <span className="inline-flex items-center gap-1">
                        <Heart className="h-3.5 w-3.5" aria-hidden /> Following
                      </span>
                    )}
                  </p>
                </div>
                {(cookbook.isPublic || isOwn || canFollow) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="relative z-10 -mr-2 -mt-2 shrink-0"
                        aria-label={`More actions for ${cookbook.name}`}
                        title="More actions"
                        data-testid={`button-more-cookbook-${cookbook.id}`}
                      >
                        <MoreHorizontal className="!h-5 !w-5" aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[12rem]">
                      {cookbook.isPublic && (
                        <DropdownMenuItem className="min-h-11" onSelect={() => share(cookbook.id)}>
                          <Share2 aria-hidden /> Copy link
                        </DropdownMenuItem>
                      )}
                      {canFollow && (
                        <DropdownMenuItem
                          className="min-h-11"
                          onSelect={() => followMutation.mutate({ id: cookbook.id, following: isFollowing })}
                          data-testid={`button-follow-cookbook-${cookbook.id}`}
                        >
                          {isFollowing ? <HeartOff aria-hidden /> : <Heart aria-hidden />}
                          {isFollowing ? "Unfollow" : "Follow"}
                        </DropdownMenuItem>
                      )}
                      {isOwn && (
                        <DropdownMenuItem
                          className="min-h-11"
                          onSelect={() => navigate(`/cookbook/${cookbook.id}/print`)}
                          data-testid={`button-print-cookbook-${cookbook.id}`}
                        >
                          <Printer aria-hidden /> Print as a book
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </article>
            );
          })}
        </div>
      )}

      {user && (
        <CreateCookbookDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSuccess={(id) => navigate(`/cookbook/${id}`)}
        />
      )}
    </div>
  );
}
