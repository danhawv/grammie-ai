import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { BookOpen, ChefHat, CircleUser, Home, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertsButton } from "@/components/alerts-button";
import { PendingInvitationsPopover } from "@/components/pending-invitations-popover";
import { UserHeader } from "@/components/user-header";
import { useAuth } from "@/hooks/useAuth";
import { useAddRecipe } from "@/contexts/AddRecipeContext";
import { cn } from "@/lib/utils";

// The one app shell (docs/DESIGN_PRINCIPLES.md §3).
// Desktop: a header with the five destinations, labeled.
// Phone: a slim top bar plus a bottom tab bar. New features go inside one of
// these areas, never as another header icon.

const NAV = [
  { href: "/", label: "Recipes", icon: Home, match: (p: string) => p === "/" || p.startsWith("/recipe") },
  {
    href: "/kitchen",
    label: "Kitchen",
    icon: ChefHat,
    match: (p: string) => /^\/(kitchen|grocery-list|pantry|meal-plans|what-can-i-make)/.test(p),
  },
  { href: "/cookbooks", label: "Cookbooks", icon: BookOpen, match: (p: string) => p.startsWith("/cookbook") },
] as const;

const ME = { href: "/settings", label: "Me", icon: CircleUser, match: (p: string) => /^\/(settings|profile)/.test(p) };

/** Pages that render without the app chrome */
const BARE = [/^\/login/, /^\/grocery-list\/shared\//];

export function AppShell() {
  const [location] = useLocation();
  const { user } = useAuth();
  const { openAddRecipe } = useAddRecipe();
  const bare = BARE.some((r) => r.test(location));

  // Reserve space for the phone tab bar
  useEffect(() => {
    document.body.classList.toggle("has-tab-bar", !bare);
    return () => document.body.classList.remove("has-tab-bar");
  }, [bare]);

  if (bare) return null;

  return (
    <>
      <header
        className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 md:px-6">
          <Link href="/" className="mr-2 font-serif text-2xl font-bold" aria-label="Grammie home">
            Grammie
          </Link>

          {/* Desktop destinations */}
          <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((item) => {
              const active = item.match(location);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
                    active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <item.icon className="h-5 w-5" aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            {user && (
              <Button className="hidden md:inline-flex" onClick={() => openAddRecipe()} data-testid="button-add-recipe-header">
                <Plus aria-hidden /> Add recipe
              </Button>
            )}
            {user && <PendingInvitationsPopover />}
            <AlertsButton />
            <UserHeader />
          </div>
        </div>
      </header>

      {/* Phone tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        aria-label="Main"
      >
        <div className="grid h-[4.5rem] grid-cols-5">
          {[NAV[0], NAV[1]].map((item) => (
            <TabLink key={item.href} item={item} active={item.match(location)} />
          ))}
          <button
            type="button"
            onClick={() => (user ? openAddRecipe() : (window.location.href = "/login"))}
            className="flex flex-col items-center justify-center gap-1 text-xs font-medium text-primary"
            aria-label="Add recipe"
            data-testid="tab-add-recipe"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
              <Plus className="h-6 w-6" aria-hidden />
            </span>
            Add
          </button>
          <TabLink item={NAV[2]} active={NAV[2].match(location)} />
          <TabLink item={ME} active={ME.match(location)} />
        </div>
      </nav>
    </>
  );
}

function TabLink({ item, active }: { item: { href: string; label: string; icon: typeof Home }; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex flex-col items-center justify-center gap-1 text-xs font-medium",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <item.icon className="h-6 w-6" aria-hidden />
      {item.label}
    </Link>
  );
}
