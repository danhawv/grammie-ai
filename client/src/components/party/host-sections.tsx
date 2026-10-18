import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, CheckCircle2, Copy, ExternalLink, Printer, QrCode, Share2, UserMinus } from "lucide-react";
import { PRINTABLES, inviteBlurb, inviteSite, type PartyDetail, type PartyGuest } from "@shared/party";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { openExternal } from "@/lib/platform";
import { queryClient } from "@/lib/queryClient";
import { partyApi, partyErrorText, partyKeys } from "@/lib/party-api";
import { coverage, printPath, restrictionsText, shareableInvite } from "@/lib/party-format";

// The host page's sections: the invite, the guest list, "Everyone covered?",
// printables and the party cookbook.

const SITE_NAMES: Record<string, string> = { partiful: "Partiful", evite: "Evite", luma: "Luma", paperless: "Paperless Post", other: "invite page" };

export function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-lg border bg-card p-4">
      <div>
        <h2 id={id} className="text-xl font-semibold">{title}</h2>
        {description && <p className="mt-1 text-base text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** A QR code for the invite, drawn on this device (shown big so guests can scan the host's phone) */
function InviteQr({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    import("qrcode")
      .then((m) => (m.default ?? m).toDataURL(value, { margin: 1, width: 560, errorCorrectionLevel: "M" }))
      .then((url: string) => { if (live) setSrc(url); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [value]);
  if (failed) return <p className="text-center text-muted-foreground">The code couldn't be drawn. Share the link instead.</p>;
  if (!src) return <div className="mx-auto aspect-square w-full max-w-xs animate-pulse rounded bg-muted" />;
  return <img src={src} alt="Code that opens the party invite" className="mx-auto aspect-square w-full max-w-xs bg-white p-2" />;
}

export function InviteCard({ party }: { party: PartyDetail }) {
  const { toast } = useToast();
  const [qrOpen, setQrOpen] = useState(false);
  const link = shareableInvite(party.inviteUrl);
  if (!link) return null;
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  const copy = async (text: string, what: string) => {
    if (await copyText(text)) toast({ title: `${what} copied` });
    else toast({ title: "Couldn't copy", description: "Select the link below and copy it yourself.", variant: "destructive" });
  };

  const share = async () => {
    try {
      await navigator.share({ title: party.title, text: `Pick what you're bringing to ${party.title}:`, url: link });
    } catch { /* cancelled */ }
  };

  const ext = party.externalInviteUrl;
  return (
    <Section id="invite-heading" title="Invite your guests" description="Send this link. Guests pick what they're bringing and tell you about allergies. They don't need an account.">
      <p className="break-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm" data-testid="text-invite-link">{link}</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => copy(link, "Link")}><Copy aria-hidden /> Copy link</Button>
        {canShare && <Button variant="outline" onClick={share}><Share2 aria-hidden /> Send…</Button>}
        <Button variant="outline" onClick={() => setQrOpen(true)}><QrCode aria-hidden /> Show code</Button>
      </div>
      <div className="space-y-2 border-t pt-3">
        <p className="text-base font-medium">Using Partiful or Evite too?</p>
        <p className="text-sm text-muted-foreground">Copy this and paste it into the invite's description or "custom link" box.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => copy(inviteBlurb(party, link), "Text for your invite")}>
            <Copy aria-hidden /> Copy for Partiful
          </Button>
          {ext && (
            <Button variant="outline" onClick={() => void openExternal(ext)}>
              <ExternalLink aria-hidden /> Open your {SITE_NAMES[inviteSite(ext)]}
            </Button>
          )}
        </div>
      </div>
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Scan to join</DialogTitle>
            <DialogDescription>Guests point their phone camera here to open the party.</DialogDescription>
          </DialogHeader>
          {qrOpen && <InviteQr value={link} />}
        </DialogContent>
      </Dialog>
    </Section>
  );
}

const RSVP_TEXT = { yes: "Coming", maybe: "Maybe", no: "Can't come" } as const;

export function GuestList({ party }: { party: PartyDetail }) {
  const { toast } = useToast();
  const [removing, setRemoving] = useState<PartyGuest | null>(null);
  const remove = useMutation({
    mutationFn: (g: PartyGuest) => partyApi.removeGuest(party.id, g.id),
    onSuccess: (_d, g) => {
      queryClient.invalidateQueries({ queryKey: partyKeys.host(party.id) });
      toast({ title: `${g.name} was taken off the list` });
    },
    onError: (err) => toast({ title: "Couldn't remove that guest", description: partyErrorText(err), variant: "destructive" }),
  });

  const order = { yes: 0, maybe: 1, no: 2 } as const;
  const guests = [...party.guests].sort((a, b) => Number(b.isHost) - Number(a.isHost) || order[a.rsvp] - order[b.rsvp] || a.name.localeCompare(b.name));
  return (
    <Section
      id="guests-heading"
      title="Guests"
      description={`${party.confirmedPeople} ${party.confirmedPeople === 1 ? "person" : "people"} coming so far, out of about ${party.headcount}.`}
    >
      {guests.length <= 1 ? (
        <p className="text-base text-muted-foreground">No one has joined yet. Send the invite link above.</p>
      ) : null}
      <ul className="divide-y">
        {guests.map((g) => {
          const dishes = party.dishes.filter((d) => d.guestId === g.id);
          const needs = restrictionsText(g);
          return (
            <li key={g.id} className="flex items-start gap-3 py-3">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2 text-base font-semibold">
                  {g.name}
                  {g.isHost && <Badge variant="secondary">Host</Badge>}
                  <Badge variant={g.rsvp === "yes" ? "default" : "outline"}>{RSVP_TEXT[g.rsvp]}</Badge>
                  {g.partySize > 1 && <span className="text-sm font-normal text-muted-foreground">+{g.partySize - 1}</span>}
                </p>
                {needs && <p className="text-sm text-amber-800 dark:text-amber-300">{needs}</p>}
                <p className="text-sm text-muted-foreground">
                  {dishes.length ? `Bringing ${dishes.map((d) => d.title).join(", ")}` : "Hasn't picked a dish yet"}
                </p>
              </div>
              {!g.isHost && (
                <Button variant="ghost" size="icon" aria-label={`Remove ${g.name}`} onClick={() => setRemoving(g)}>
                  <UserMinus aria-hidden />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>They come off the guest list, and any dish they signed up for comes off the menu.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction onClick={() => removing && remove.mutate(removing)}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

export function CoveragePanel({ party }: { party: PartyDetail }) {
  const rows = coverage(party.guests, party.dishes);
  if (rows.length === 0) {
    return (
      <Section id="covered-heading" title="Everyone covered?">
        <p className="text-base text-muted-foreground">No one has told us about allergies or diets yet. We'll check each dish when they do.</p>
      </Section>
    );
  }
  return (
    <Section id="covered-heading" title="Everyone covered?" description="For each guest with an allergy or diet: how many dishes they can eat.">
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.guest.id} className="flex items-start gap-3">
            {r.worry ? (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
            ) : (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" aria-hidden />
            )}
            <div className="min-w-0">
              <p className="text-base">
                <strong>{r.guest.name}</strong> ({restrictionsText(r.guest)}) can eat {r.safe} {r.safe === 1 ? "dish" : "dishes"}
                {r.unknown > 0 ? `, and ${r.unknown} we can't check yet` : ""}.
              </p>
              {r.worry && (
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  {r.safeMainsAndSides === 0 ? "No main or side for them yet." : "Only one main or side for them so far."} You might ask someone to bring something they can eat.
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function PrintablesSection({ party }: { party: PartyDetail }) {
  return (
    <Section id="print-heading" title="Print for the table" description="Menus, place cards, food labels and take-home recipe cards.">
      <ul className="grid gap-2 sm:grid-cols-2">
        {PRINTABLES.map((p) => (
          <li key={p.id}>
            <Link href={printPath(party.id, p.id)} className="flex min-h-16 items-start gap-3 rounded-md border p-3 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Printer className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
              <span>
                <span className="block text-base font-medium">{p.title}</span>
                <span className="block text-sm text-muted-foreground">{p.hint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function CookbookLink({ cookbookId }: { cookbookId: number | null }) {
  if (!cookbookId) return null;
  return (
    <Section id="cookbook-heading" title="The party cookbook" description="Every recipe guests bring goes in here, so everyone can make them again.">
      <Button variant="outline" asChild>
        <Link href={`/cookbook/${cookbookId}`}><BookOpen aria-hidden /> Open the party cookbook</Link>
      </Button>
    </Section>
  );
}
