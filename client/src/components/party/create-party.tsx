import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { defaultSlots, inviteSite, type PartyStyle } from "@shared/party";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { queryClient } from "@/lib/queryClient";
import { mediaUrl } from "@/lib/platform";
import { partyApi, partyErrorText, partyKeys } from "@/lib/party-api";
import { fromLocalInput, partyPath } from "@/lib/party-format";
import { CourseEditor, StylePicker, draftsFrom, slotsFromDrafts, type DraftSlot } from "./party-bits";

// "Plan a party": three short screens. 1) dinner party or potluck, explained;
// 2) the details, with an optional Partiful/Evite link that fills in the name;
// 3) the course list, started from Grammie's suggestion and editable.

const STEPS = [
  { title: "What kind of party?", why: "You can change this later." },
  { title: "The details", why: "Only the name is needed now. Fill in the rest whenever you like." },
  { title: "The menu", why: "These are the places guests sign up for. Add, remove or rename them." },
];

const SITE_NAMES: Record<string, string> = { partiful: "Partiful", evite: "Evite", luma: "Luma", paperless: "Paperless Post" };

export function CreatePartySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);
  const [style, setStyle] = useState<PartyStyle>("dinner");
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [location, setLocation] = useState("");
  const [headcount, setHeadcount] = useState("8");
  const [hostNote, setHostNote] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [preview, setPreview] = useState<{ title: string | null; image: string | null; site: string } | null>(null);
  const [slots, setSlots] = useState<DraftSlot[]>([]);
  const [slotsTouched, setSlotsTouched] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const count = Math.max(2, Math.min(150, Number(headcount) || 2));

  useEffect(() => {
    if (!open) return;
    setStep(0); setStyle("dinner"); setTitle(""); setWhen(""); setLocation(""); setHeadcount("8");
    setHostNote(""); setInviteLink(""); setPreview(null); setSlots([]); setSlotsTouched(false);
  }, [open]);

  // The suggested course list follows the style and head count until it's edited
  useEffect(() => {
    if (!slotsTouched) setSlots(draftsFrom(defaultSlots(style, count)));
  }, [style, count, slotsTouched]);

  useEffect(() => { if (open) headingRef.current?.focus(); }, [step, open]);

  const lookUp = useMutation({
    mutationFn: (url: string) => partyApi.invitePreview(url),
    onSuccess: (p) => {
      setPreview(p);
      if (p.title && !title.trim()) setTitle(p.title.slice(0, 120));
    },
    onError: () => setPreview(null),
  });

  const onLinkBlur = () => {
    const url = inviteLink.trim();
    if (/^https?:\/\/\S+\.\S+/i.test(url) && !lookUp.isPending) lookUp.mutate(url);
  };

  const create = useMutation({
    mutationFn: async () => {
      const party = await partyApi.create({
        title: title.trim(),
        style,
        startsAt: fromLocalInput(when),
        location: location.trim() || null,
        hostNote: hostNote.trim() || null,
        headcount: count,
        slots: slotsFromDrafts(slots),
      });
      const link = inviteLink.trim();
      if (/^https?:\/\//i.test(link)) {
        // Saved separately (it isn't part of the create request); a failure here
        // just leaves the link off, which the host can add in Settings
        await partyApi.update(party.id, { externalInviteUrl: link }).catch(() => undefined);
      }
      return party;
    },
    onSuccess: (party) => {
      queryClient.invalidateQueries({ queryKey: partyKeys.list });
      onOpenChange(false);
      navigate(partyPath(party.id));
    },
  });

  const canNext = step !== 1 || title.trim().length > 0;
  const last = step === STEPS.length - 1;

  return (
    <Sheet open={open} onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <SheetContent side={isMobile ? "bottom" : "right"} className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg md:max-h-none">
        <SheetHeader className="space-y-2 border-b px-4 py-4 pr-14 text-left">
          <p className="text-sm text-muted-foreground">Plan a party · Step {step + 1} of {STEPS.length}</p>
          <Progress value={((step + 1) / STEPS.length) * 100} className="h-2" aria-hidden />
          <SheetTitle asChild>
            <h2 ref={headingRef} tabIndex={-1} className="font-serif text-2xl font-bold focus:outline-none">{STEPS[step].title}</h2>
          </SheetTitle>
          <SheetDescription className="text-base">{STEPS[step].why}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5">
          {step === 0 && <StylePicker value={style} onChange={setStyle} />}

          {step === 1 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="party-invite-link" className="text-base">Already made a Partiful or Evite? (optional)</Label>
                <Input
                  id="party-invite-link"
                  type="url"
                  inputMode="url"
                  className="min-h-11"
                  placeholder="Paste the invite link"
                  value={inviteLink}
                  onChange={(e) => { setInviteLink(e.target.value); setPreview(null); }}
                  onBlur={onLinkBlur}
                />
                {lookUp.isPending && (
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden /> Looking at the link…</p>
                )}
                {preview && (preview.title || preview.image) && (
                  <div className="flex items-center gap-3 rounded-md border bg-muted/40 p-2">
                    {preview.image && <img src={mediaUrl(preview.image)} alt="" className="h-12 w-12 rounded object-cover" />}
                    <p className="text-sm">
                      Found {SITE_NAMES[preview.site] ? `your ${SITE_NAMES[preview.site]} invite` : "the invite"}
                      {preview.title ? <>: <strong>{preview.title}</strong></> : null}
                    </p>
                  </div>
                )}
                {inviteLink && !lookUp.isPending && inviteSite(inviteLink) !== "other" && !preview && (
                  <p className="text-sm text-muted-foreground">We'll keep the link on the party page so guests can find it.</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="party-title" className="text-base">Name of the party</Label>
                <Input id="party-title" className="min-h-11" maxLength={120} placeholder="Friendsgiving" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="party-when" className="text-base">Date and time</Label>
                <Input id="party-when" type="datetime-local" className="min-h-11" value={when} onChange={(e) => setWhen(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="party-where" className="text-base">Place</Label>
                <Input id="party-where" className="min-h-11" maxLength={200} placeholder="Our house" value={location} onChange={(e) => setLocation(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="party-headcount" className="text-base">About how many people?</Label>
                <Input id="party-headcount" type="number" inputMode="numeric" min={2} max={150} className="min-h-11 w-32" value={headcount} onChange={(e) => setHeadcount(e.target.value)} />
                {style === "dinner" && <p className="text-sm text-muted-foreground">Recipes are scaled to feed this many.</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="party-note" className="text-base">A note for guests (optional)</Label>
                <Textarea id="party-note" maxLength={500} placeholder="Come hungry! Parking is on the street." value={hostNote} onChange={(e) => setHostNote(e.target.value)} />
              </div>
            </>
          )}

          {step === 2 && (
            <CourseEditor value={slots} onChange={(v) => { setSlots(v); setSlotsTouched(true); }} style={style} headcount={count} />
          )}

          {create.isError && <p className="text-sm text-destructive" role="alert">{partyErrorText(create.error, "We couldn't make the party. Check your connection and try again.")}</p>}
        </div>

        <SheetFooter className="flex-row gap-2 border-t px-4 py-3">
          <Button variant="outline" className="flex-1" disabled={create.isPending} onClick={() => (step === 0 ? onOpenChange(false) : setStep(step - 1))}>
            {step === 0 ? "Cancel" : "Back"}
          </Button>
          <Button
            className="flex-1"
            disabled={!canNext || create.isPending}
            onClick={() => (last ? create.mutate() : setStep(step + 1))}
          >
            {create.isPending && <Loader2 className="motion-safe:animate-spin" aria-hidden />}
            {last ? "Make the party" : "Next"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
