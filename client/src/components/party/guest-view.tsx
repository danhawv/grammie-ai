import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { BookOpen, Loader2, Pencil, Plus, UserPlus } from "lucide-react";
import { MAX_DISHES_PER_GUEST, type PartyDetail, type PartyDish, type PartySlot } from "@shared/party";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { partyApi, partyErrorText } from "@/lib/party-api";
import { dishPath, isImporting, partyPath, restrictionsText, signUpPath } from "@/lib/party-format";
import { BringDishSheet } from "./bring-dish";
import { OwnDishActions } from "./dish-actions";
import { JoinSheet } from "./join-sheet";
import { MenuBoard } from "./menu-board";
import { DishRow, DismissButton } from "./party-bits";
import { PartyHero } from "./party-hero";

// A party seen through the invite link: the details, a "Join" step for
// newcomers, your own answers and dish, and the menu so far. Works signed in
// or out.

const RSVP_TEXT = { yes: "You're coming", maybe: "You might come", no: "You can't make it" } as const;

export function GuestView({ party, token, signedIn, firstName }: { party: PartyDetail; token: string; signedIn: boolean; firstName?: string | null }) {
  const { toast } = useToast();
  const [joinOpen, setJoinOpen] = useState(false);
  const [bringOpen, setBringOpen] = useState(false);
  const [bringSlot, setBringSlot] = useState<PartySlot | null>(null);
  const [keepNudge, setKeepNudge] = useState(false);

  const joined = !!party.youGuestId && party.role !== "visitor";
  const me = party.guests.find((g) => g.id === party.youGuestId) ?? null;
  const mine = party.dishes.filter((d) => d.guestId === party.youGuestId);
  const canBring = joined && me?.rsvp !== "no" && mine.length < MAX_DISHES_PER_GUEST;
  const coming = party.guests.filter((g) => g.rsvp !== "no");

  const saveCookbook = useMutation({
    mutationFn: () => partyApi.saveCookbook(token),
    onSuccess: () => toast({ title: "Saved to your Cookbooks", description: "Every recipe from the party, in one place." }),
    onError: (err) => toast({ title: "Couldn't save the cookbook", description: partyErrorText(err), variant: "destructive" }),
  });

  const startBring = (slot: PartySlot | null) => {
    if (!joined) { setJoinOpen(true); return; }
    setBringSlot(slot);
    setBringOpen(true);
  };

  const onAdded = (dish: PartyDish) => {
    setBringOpen(false);
    if (dish.conflicts.length) {
      toast({ title: `${dish.title} is on the menu`, description: dish.conflicts.map((c) => c.message).join(". ") });
    } else {
      toast({ title: `${dish.title} is on the menu`, description: isImporting(dish.recipe) ? "Grammie is reading the recipe now. It fills in by itself." : undefined });
    }
    if (!signedIn) setKeepNudge(true);
  };

  return (
    <div className="space-y-8">
      <PartyHero party={party} />

      {party.role === "host" && (
        <div className="rounded-lg border bg-card p-4">
          <p className="text-base">This is what your guests see.</p>
          <Button variant="outline" className="mt-2" asChild><Link href={partyPath(party.id)}>Open the host page</Link></Button>
        </div>
      )}

      {!joined && party.role !== "host" && (
        <section className="space-y-3 rounded-lg border-2 border-primary bg-primary/5 p-4" aria-labelledby="join-heading">
          <h2 id="join-heading" className="text-xl font-semibold">Are you coming?</h2>
          <p className="text-base">Say you're coming, tell {party.hostName} about any allergies, and pick what you'll bring.</p>
          <Button size="lg" className="w-full sm:w-auto" onClick={() => setJoinOpen(true)} data-testid="button-join-party">Join the party</Button>
        </section>
      )}

      {joined && me && (
        <section className="space-y-4 rounded-lg border bg-card p-4" aria-labelledby="you-heading">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="you-heading" className="text-xl font-semibold">{RSVP_TEXT[me.rsvp]}</h2>
              <p className="text-base text-muted-foreground">
                {me.partySize > 1 ? `${me.partySize} people, counting you` : "Just you"}
                {restrictionsText(me) ? ` · ${restrictionsText(me)}` : ""}
              </p>
            </div>
            <Button variant="outline" onClick={() => setJoinOpen(true)}><Pencil aria-hidden /> Change</Button>
          </div>

          <div className="space-y-3 border-t pt-4">
            <h3 className="text-lg font-semibold">What you're bringing</h3>
            {mine.length === 0 ? (
              <p className="text-base text-muted-foreground">{me.rsvp === "no" ? "Nothing, since you can't make it." : "You haven't picked anything yet."}</p>
            ) : (
              <ul className="space-y-4">
                {mine.map((d) => (
                  <li key={d.id}>
                    <DishRow
                      dish={d}
                      party={party}
                      isYours
                      href={d.recipe ? dishPath(token, d.id) : undefined}
                      actions={<OwnDishActions party={party} token={token} dish={d} signedIn={signedIn} />}
                    />
                  </li>
                ))}
              </ul>
            )}
            {canBring && (
              <Button size={mine.length ? "default" : "lg"} variant={mine.length ? "outline" : "default"} onClick={() => startBring(null)} data-testid="button-bring-dish">
                <Plus aria-hidden /> {mine.length ? "Bring something else" : "Pick what you're bringing"}
              </Button>
            )}
          </div>

          {keepNudge && !signedIn && (
            <div className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
              <div className="flex-1 space-y-2">
                <p className="text-base font-medium">Keep your recipe</p>
                <p className="text-sm">Create a free account to keep it, and get the party cookbook. It takes one minute and is free.</p>
                <Button asChild><Link href={signUpPath(token, true)}><UserPlus aria-hidden /> Create a free account</Link></Button>
              </div>
              <DismissButton onClick={() => setKeepNudge(false)} label="Not now" />
            </div>
          )}

          {signedIn && party.cookbookId != null && (
            <div className="border-t pt-4">
              <Button variant="outline" disabled={saveCookbook.isPending} onClick={() => saveCookbook.mutate()}>
                {saveCookbook.isPending ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <BookOpen aria-hidden />} Save the party cookbook
              </Button>
              <p className="mt-1 text-sm text-muted-foreground">Every recipe from the party, kept in your Cookbooks.</p>
            </div>
          )}
        </section>
      )}

      <section className="space-y-3" aria-labelledby="menu-heading">
        <h2 id="menu-heading" className="font-serif text-2xl font-bold">The menu so far</h2>
        <MenuBoard
          party={party}
          onClaim={startBring}
          hrefFor={(d) => (d.recipe ? dishPath(token, d.id) : undefined)}
        />
      </section>

      {coming.length > 0 && (
        <section className="space-y-3" aria-labelledby="coming-heading">
          <h2 id="coming-heading" className="text-xl font-semibold">Who's coming</h2>
          <ul className="flex flex-wrap gap-2">
            {coming.map((g) => (
              <li key={g.id}>
                <Badge variant={g.rsvp === "yes" ? "secondary" : "outline"} className="px-3 py-1 text-sm">
                  {g.name}{g.isHost ? " (host)" : ""}{g.rsvp === "maybe" ? " (maybe)" : ""}{g.partySize > 1 ? ` +${g.partySize - 1}` : ""}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      <JoinSheet
        party={party}
        token={token}
        open={joinOpen}
        me={joined ? me : null}
        signedIn={signedIn}
        firstName={firstName}
        onClose={() => setJoinOpen(false)}
        onJoined={() => {
          setJoinOpen(false);
          if (!joined) toast({ title: "You're on the list", description: "Now pick what you're bringing." });
        }}
      />
      <BringDishSheet
        party={party}
        token={token}
        open={bringOpen}
        slot={bringSlot}
        signedIn={signedIn}
        onClose={() => setBringOpen(false)}
        onAdded={onAdded}
      />
    </div>
  );
}
