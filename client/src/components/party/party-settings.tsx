import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import type { PartyDetail, PartyStyle } from "@shared/party";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { partyApi, partyErrorText, partyKeys } from "@/lib/party-api";
import { fromLocalInput, toLocalInput } from "@/lib/party-format";
import { CourseEditor, StylePicker, draftsFrom, slotsFromDrafts, type DraftSlot } from "./party-bits";

// The host's settings: edit the details (including dinner party / potluck),
// change the courses, make a new invite link, or cancel the party.

export type SettingsView = "details" | "courses" | "rotate" | "cancel" | null;

function refresh(id: string, next?: PartyDetail) {
  if (next && typeof next === "object" && "id" in next) queryClient.setQueryData(partyKeys.host(id), next);
  queryClient.invalidateQueries({ queryKey: partyKeys.host(id) });
  queryClient.invalidateQueries({ queryKey: partyKeys.list });
}

export function PartySettings({ party, view, onClose }: { party: PartyDetail; view: SettingsView; onClose: () => void }) {
  return (
    <>
      <DetailsSheet party={party} open={view === "details"} onClose={onClose} />
      <CoursesSheet party={party} open={view === "courses"} onClose={onClose} />
      <RotateDialog party={party} open={view === "rotate"} onClose={onClose} />
      <CancelDialog party={party} open={view === "cancel"} onClose={onClose} />
    </>
  );
}

function SettingsSheet({ open, onClose, title, description, children, footer }: {
  open: boolean; onClose: () => void; title: string; description: string; children: React.ReactNode; footer: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={isMobile ? "bottom" : "right"} className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg md:max-h-none">
        <SheetHeader className="border-b px-4 py-4 pr-14 text-left">
          <SheetTitle className="font-serif text-2xl">{title}</SheetTitle>
          <SheetDescription className="text-base">{description}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5">{children}</div>
        <SheetFooter className="flex-row gap-2 border-t px-4 py-3">{footer}</SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function DetailsSheet({ party, open, onClose }: { party: PartyDetail; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [style, setStyle] = useState<PartyStyle>(party.style);
  const [title, setTitle] = useState(party.title);
  const [when, setWhen] = useState("");
  const [location, setLocation] = useState("");
  const [headcount, setHeadcount] = useState("");
  const [theme, setTheme] = useState("");
  const [hostNote, setHostNote] = useState("");
  const [external, setExternal] = useState("");

  useEffect(() => {
    if (!open) return;
    setStyle(party.style); setTitle(party.title); setWhen(toLocalInput(party.startsAt)); setLocation(party.location ?? "");
    setHeadcount(String(party.headcount)); setTheme(party.theme ?? ""); setHostNote(party.hostNote ?? ""); setExternal(party.externalInviteUrl ?? "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => partyApi.update(party.id, {
      title: title.trim(),
      style,
      startsAt: fromLocalInput(when),
      location: location.trim() || null,
      headcount: Math.max(2, Math.min(150, Number(headcount) || party.headcount)),
      theme: theme.trim() || null,
      hostNote: hostNote.trim() || null,
      externalInviteUrl: external.trim() || null,
    }),
    onSuccess: (next) => {
      refresh(party.id, next);
      toast({ title: "Saved" });
      onClose();
    },
  });

  const badLink = !!external.trim() && !/^https?:\/\/\S+$/i.test(external.trim());
  return (
    <SettingsSheet
      open={open}
      onClose={onClose}
      title="Party details"
      description="Changes show for guests right away."
      footer={
        <>
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" disabled={!title.trim() || badLink || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="motion-safe:animate-spin" aria-hidden />} Save
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <p className="text-base font-medium">Kind of party</p>
        <StylePicker value={style} onChange={setStyle} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ps-title" className="text-base">Name of the party</Label>
        <Input id="ps-title" className="min-h-11" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ps-when" className="text-base">Date and time</Label>
        <Input id="ps-when" type="datetime-local" className="min-h-11" value={when} onChange={(e) => setWhen(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ps-where" className="text-base">Place</Label>
        <Input id="ps-where" className="min-h-11" maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ps-count" className="text-base">About how many people?</Label>
        <Input id="ps-count" type="number" inputMode="numeric" min={2} max={150} className="min-h-11 w-32" value={headcount} onChange={(e) => setHeadcount(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ps-theme" className="text-base">Theme (optional)</Label>
        <Input id="ps-theme" className="min-h-11" maxLength={120} placeholder="Harvest supper" value={theme} onChange={(e) => setTheme(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ps-note" className="text-base">A note for guests (optional)</Label>
        <Textarea id="ps-note" maxLength={500} value={hostNote} onChange={(e) => setHostNote(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ps-ext" className="text-base">Partiful or Evite link (optional)</Label>
        <Input id="ps-ext" type="url" inputMode="url" className="min-h-11" placeholder="https://partiful.com/e/…" value={external} onChange={(e) => setExternal(e.target.value)} />
        {badLink && <p className="text-sm text-destructive">That doesn't look like a web address. Copy the whole link and paste it again.</p>}
      </div>
      {save.isError && <p className="text-sm text-destructive" role="alert">{partyErrorText(save.error, "We couldn't save that. Check your connection and try again.")}</p>}
    </SettingsSheet>
  );
}

function CoursesSheet({ party, open, onClose }: { party: PartyDetail; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [slots, setSlots] = useState<DraftSlot[]>([]);
  useEffect(() => {
    if (open) setSlots(draftsFrom([...party.slots].sort((a, b) => a.position - b.position)));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => partyApi.setSlots(party.id, slotsFromDrafts(slots)),
    onSuccess: (next) => {
      refresh(party.id, next);
      toast({ title: "Courses saved" });
      onClose();
    },
  });

  const claimedRemoved = party.dishes.some((d) => d.slotId && !slots.some((s) => s.id === d.slotId));
  return (
    <SettingsSheet
      open={open}
      onClose={onClose}
      title="Courses"
      description="The places guests sign up for."
      footer={
        <>
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="motion-safe:animate-spin" aria-hidden />} Save
          </Button>
        </>
      }
    >
      <CourseEditor value={slots} onChange={setSlots} style={party.style} headcount={party.headcount} />
      {claimedRemoved && (
        <p className="text-sm text-muted-foreground">Dishes already picked for a course you removed stay on the menu.</p>
      )}
      {save.isError && <p className="text-sm text-destructive" role="alert">{partyErrorText(save.error, "We couldn't save that. Check your connection and try again.")}</p>}
    </SettingsSheet>
  );
}

function RotateDialog({ party, open, onClose }: { party: PartyDetail; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const rotate = useMutation({
    mutationFn: () => partyApi.rotateInvite(party.id),
    onSuccess: () => {
      refresh(party.id);
      toast({ title: "New link made", description: "The old link doesn't work anymore. Send the new one to your guests." });
      onClose();
    },
    onError: (err) => toast({ title: "Couldn't make a new link", description: partyErrorText(err), variant: "destructive" }),
  });
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Make a new invite link?</AlertDialogTitle>
          <AlertDialogDescription>
            The old link stops working. People who already joined stay on the list, but anyone using the old link will need the new one.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep the old link</AlertDialogCancel>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); rotate.mutate(); }} disabled={rotate.isPending}>
            Make a new link
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CancelDialog({ party, open, onClose }: { party: PartyDetail; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const cancel = useMutation({
    mutationFn: () => partyApi.cancel(party.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: partyKeys.list });
      toast({ title: "Party cancelled", description: "The invite link doesn't work anymore." });
      onClose();
      navigate("/kitchen?tab=parties");
    },
    onError: (err) => toast({ title: "Couldn't cancel the party", description: partyErrorText(err), variant: "destructive" }),
  });
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel {party.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            The invite link stops working and the party leaves your list. Grammie doesn't tell guests, so let them know yourself.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep the party</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => { e.preventDefault(); cancel.mutate(); }}
            disabled={cancel.isPending}
          >
            Cancel the party
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
