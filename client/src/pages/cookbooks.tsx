import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { BookOpen, Lock, Plus, Printer, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-states";
import { CreateCookbookDialog } from "@/components/create-cookbook-dialog";
import { useAuth } from "@/hooks/useAuth";
import { ownerDisplayName, type CookbookOwner } from "@/lib/cookbook-owner";
import { orderStatusLabel } from "@shared/print-checkout";
import type { CookbookPrintProject } from "@shared/schema";

// The Cookbooks destination (docs/DESIGN_PRINCIPLES.md §3): your cookbooks,
// cookbooks other people shared with you, and one way to start a new one.

interface CookbookListItem {
  id: number;
  name: string;
  description: string | null;
  coverImage: string | null;
  isPublic: boolean;
  ownerUserId: string;
  recipeCount?: number;
  owner?: CookbookOwner;
}

export default function CookbooksPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [createOpen, setCreateOpen] = useState(false);

  const mine = useQuery<CookbookListItem[]>({ queryKey: ["/api/cookbooks"], enabled: !!user });
  const shared = useQuery<CookbookListItem[]>({ queryKey: ["/api/cookbooks", { scope: "shared" }], enabled: !!user });
  // Printed-book orders, to show "Printing" / "Shipped" on the cookbook
  const projects = useQuery<CookbookPrintProject[]>({ queryKey: ["/api/print-projects"], enabled: !!user });
  const orderByCookbook = new Map(
    (projects.data ?? []).filter((p) => p.luluOrderId).map((p) => [p.cookbookId, p.luluOrderStatus]),
  );

  const newButton = (
    <Button onClick={() => setCreateOpen(true)} data-testid="button-new-cookbook">
      <Plus aria-hidden /> New cookbook
    </Button>
  );

  if (!authLoading && !user) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-6">
        <PageHeader title="Cookbooks" />
        <EmptyState
          icon={BookOpen}
          title="Sign in to see your cookbooks"
          description="Cookbooks collect your family's recipes in one place, and you can print them as a real book."
          action={<Button asChild><a href="/login">Sign in</a></Button>}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-6">
      <PageHeader
        title="Cookbooks"
        description="Collect recipes into books you can share with family or print."
        primaryAction={newButton}
      />

      <section aria-labelledby="my-cookbooks" className="space-y-4">
        <h2 id="my-cookbooks" className="text-xl font-semibold">Your cookbooks</h2>
        {mine.isLoading || authLoading ? (
          <LoadingState variant="cards" rows={3} label="Loading your cookbooks" />
        ) : mine.isError ? (
          <ErrorState title="Couldn't load your cookbooks" onRetry={() => mine.refetch()} />
        ) : !mine.data?.length ? (
          <EmptyState
            icon={BookOpen}
            title="No cookbooks yet"
            description="Make a cookbook for a holiday, a family branch, or Grandma's recipes. You can add recipes to it from any recipe page."
            action={newButton}
          />
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mine.data.map((c) => (
              <li key={c.id}>
                <CookbookTile cookbook={c} orderStatus={orderByCookbook.get(c.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Only shown when someone has shared a cookbook (or while loading/failing) */}
      {(shared.isLoading || shared.isError || (shared.data?.length ?? 0) > 0) && (
        <section aria-labelledby="shared-cookbooks" className="mt-10 space-y-4">
          <h2 id="shared-cookbooks" className="text-xl font-semibold">Shared with you</h2>
          {shared.isLoading ? (
            <LoadingState variant="cards" rows={2} label="Loading shared cookbooks" />
          ) : shared.isError ? (
            <ErrorState title="Couldn't load shared cookbooks" onRetry={() => shared.refetch()} />
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shared.data!.map((c) => (
                <li key={c.id}>
                  <CookbookTile cookbook={c} byline={`by ${ownerDisplayName(c.owner, false)}`} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <CreateCookbookDialog open={createOpen} onOpenChange={setCreateOpen} onSuccess={(id) => navigate(`/cookbook/${id}`)} />
    </div>
  );
}

function CookbookTile({ cookbook, byline, orderStatus }: { cookbook: CookbookListItem; byline?: string; orderStatus?: string | null }) {
  const count = cookbook.recipeCount ?? 0;
  return (
    <Link
      href={`/cookbook/${cookbook.id}`}
      className="group flex h-full gap-4 rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={`cookbook-tile-${cookbook.id}`}
    >
      <div className="flex h-24 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-primary/10">
        {cookbook.coverImage ? (
          <img src={cookbook.coverImage} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <BookOpen className="h-8 w-8 text-primary" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-serif text-lg font-semibold leading-snug break-words">{cookbook.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {count} recipe{count === 1 ? "" : "s"}
          {byline ? ` · ${byline}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {!cookbook.isPublic && (
            <span className="inline-flex items-center gap-1"><Lock className="h-4 w-4" aria-hidden /> Private</span>
          )}
          {byline && (
            <span className="inline-flex items-center gap-1"><Users className="h-4 w-4" aria-hidden /> Shared</span>
          )}
          {orderStatus !== undefined && (
            <span className="inline-flex items-center gap-1 text-foreground">
              <Printer className="h-4 w-4" aria-hidden /> Printed book: {orderStatusLabel(orderStatus)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
