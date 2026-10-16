import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { CalendarX, Eye, ListChecks, Link2Off, MoreHorizontal, Pencil, Plus, Trash2, XCircle } from "lucide-react";
import type { PartyDish, PartySlot } from "@shared/party";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-states";
import { MenuBoard } from "@/components/party/menu-board";
import { BringDishSheet } from "@/components/party/bring-dish";
import { OwnDishActions } from "@/components/party/dish-actions";
import { PartyFacts, PartyHero } from "@/components/party/party-hero";
import { PartySettings, type SettingsView } from "@/components/party/party-settings";
import { CookbookLink, CoveragePanel, GuestList, InviteCard, PrintablesSection } from "@/components/party/host-sections";
import { StyleBadge } from "@/components/party/party-bits";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { PartyApiError, partyApi, partyErrorText, partyKeys } from "@/lib/party-api";
import { anyImporting, dishPath, guestPath, inviteTokenFrom } from "@/lib/party-format";

// /parties/:id — the host's page: invite, menu board, guests, "Everyone
// covered?", printables, the party cookbook and settings. A guest who opens
// a party from Kitchen → Parties is sent on to the invite-link page.

export default function PartyPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<SettingsView>(null);
  const [bringOpen, setBringOpen] = useState(false);
  const [bringSlot, setBringSlot] = useState<PartySlot | null>(null);
  const [removing, setRemoving] = useState<PartyDish | null>(null);

  const query = useQuery({
    queryKey: partyKeys.host(id),
    queryFn: () => partyApi.get(id),
    refetchInterval: (q) => (anyImporting(q.state.data) ? 3000 : 30_000), // guests' changes show up
  });
  const party = query.data;
  const token = inviteTokenFrom(party?.inviteUrl);

  useEffect(() => {
    if (party?.title) document.title = `${party.title} · Grammie`;
  }, [party?.title]);

  // Guests do everything from the invite link page
  useEffect(() => {
    if (party && party.role !== "host" && token) navigate(guestPath(token), { replace: true });
  }, [party?.role, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeDish = useMutation({
    mutationFn: (d: PartyDish) => partyApi.removeDishAsHost(id, d.id),
    onSuccess: (_r, d) => {
      queryClient.invalidateQueries({ queryKey: partyKeys.host(id) });
      toast({ title: `${d.title} is off the menu` });
    },
    onError: (err) => toast({ title: "Couldn't remove that dish", description: partyErrorText(err), variant: "destructive" }),
  });

  if (query.isLoading) return <Shell><LoadingState label="Opening the party" rows={5} /></Shell>;
  if (query.error instanceof PartyApiError && (query.error.status === 404 || query.error.status === 403)) {
    return (
      <Shell>
        <EmptyState
          icon={CalendarX}
          title="This party isn't here"
          description="It may have been cancelled, or it belongs to someone else."
          action={<Button asChild><Link href="/kitchen?tab=parties">See my parties</Link></Button>}
        />
      </Shell>
    );
  }
  if (query.isError || !party) {
    return <Shell><ErrorState title="Couldn't open the party" description={partyErrorText(query.error)} onRetry={() => query.refetch()} /></Shell>;
  }

  if (party.role !== "host") {
    // Shown only until the redirect above, or when the server didn't send the link
    return (
      <Shell>
        <div className="space-y-8">
          <PartyHero party={party} />
          <MenuBoard party={party} />
        </div>
      </Shell>
    );
  }

  const mine = (d: PartyDish) => d.guestId === party.youGuestId;
  const startBring = (slot: PartySlot | null) => { setBringSlot(slot); setBringOpen(true); };

  return (
    <Shell>
      <PageHeader
        back={{ href: "/kitchen?tab=parties", label: "Parties" }}
        title={party.title}
        secondaryActions={
          <>
            {token && (
              <Button variant="outline" asChild>
                <Link href={guestPath(token)}><Eye aria-hidden /> Guest view</Link>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" aria-label="Party settings"><MoreHorizontal aria-hidden /> Settings</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="min-h-11" onSelect={() => setSettings("details")}><Pencil aria-hidden /> Edit details</DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" onSelect={() => setSettings("courses")}><ListChecks aria-hidden /> Change courses</DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" onSelect={() => setSettings("rotate")}><Link2Off aria-hidden /> Make a new invite link</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="min-h-11 text-destructive" onSelect={() => setSettings("cancel")}><XCircle aria-hidden /> Cancel the party</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="-mt-3 mb-6 space-y-2">
        <StyleBadge style={party.style} />
        <PartyFacts party={party} />
      </div>

      <div className="space-y-8">
        <InviteCard party={party} />

        <section className="space-y-3" aria-labelledby="menu-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="menu-heading" className="font-serif text-2xl font-bold">Menu</h2>
            {token && <Button variant="outline" onClick={() => startBring(null)}><Plus aria-hidden /> Bring a dish myself</Button>}
          </div>
          <MenuBoard
            party={party}
            onClaim={token ? startBring : undefined}
            hrefFor={(d) => (token && d.recipe ? dishPath(token, d.id) : undefined)}
            actionsFor={(d) =>
              mine(d) && token ? (
                <OwnDishActions party={party} token={token} dish={d} signedIn={!!user} />
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setRemoving(d)}><Trash2 aria-hidden /> Remove</Button>
              )
            }
          />
        </section>

        <CoveragePanel party={party} />
        <GuestList party={party} />
        <PrintablesSection party={party} />
        <CookbookLink cookbookId={party.cookbookId} />
      </div>

      <PartySettings party={party} view={settings} onClose={() => setSettings(null)} />
      {token && (
        <BringDishSheet
          party={party}
          token={token}
          open={bringOpen}
          slot={bringSlot}
          signedIn={!!user}
          onClose={() => setBringOpen(false)}
          onAdded={(d) => {
            setBringOpen(false);
            queryClient.invalidateQueries({ queryKey: partyKeys.host(id) });
            toast({ title: `${d.title} is on the menu` });
          }}
        />
      )}
      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Take {removing?.title} off the menu?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.guestName} won't be bringing it anymore, and the place opens up again. Let them know yourself.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => removing && removeDish.mutate(removing)}>Take it off</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="container mx-auto max-w-3xl px-4 py-6">{children}</div>;
}
