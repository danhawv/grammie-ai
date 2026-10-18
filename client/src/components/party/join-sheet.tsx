import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { BookOpen, Check, Loader2, Sparkles, UserPlus } from "lucide-react";
import { ALLERGENS, PARTY_DIETS, type Allergen, type PartyDetail, type PartyDiet, type PartyGuest, type RsvpStatus } from "@shared/party";
import { WELCOME_CREDITS } from "@shared/credits";
import { getFoodProfile } from "@shared/food-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePreferences } from "@/hooks/use-preferences";
import { queryClient } from "@/lib/queryClient";
import { partyApi, partyErrorText, partyKeys, setGuestToken } from "@/lib/party-api";
import { joinPrefillFromProfile, signUpPath } from "@/lib/party-format";
import { ChipToggle } from "./party-bits";
import { cn } from "@/lib/utils";

// Joining a party (or changing your answers). Signed-out guests first see the
// account nudge: a free account is the big button, "Continue as guest" the
// small one. Signed-in guests skip it, and their Food profile fills in
// allergies and diets.

const ALLERGY_OPTIONS = ALLERGENS.map((a) => ({ id: a, label: a }));
const RSVP_OPTIONS: { id: RsvpStatus; label: string }[] = [
  { id: "yes", label: "I'll be there" },
  { id: "maybe", label: "Maybe" },
  { id: "no", label: "Can't make it" },
];

export function JoinSheet({
  party,
  token,
  open,
  me,
  signedIn,
  firstName,
  onClose,
  onJoined,
}: {
  party: PartyDetail;
  token: string;
  open: boolean;
  /** Set when changing answers after joining */
  me: PartyGuest | null;
  signedIn: boolean;
  firstName?: string | null;
  onClose: () => void;
  onJoined: (asGuest: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const { preferences } = usePreferences();
  const [phase, setPhase] = useState<"nudge" | "form">("form");
  const [name, setName] = useState("");
  const [rsvp, setRsvp] = useState<RsvpStatus>("yes");
  const [size, setSize] = useState("1");
  const [allergies, setAllergies] = useState<Allergen[]>([]);
  const [diets, setDiets] = useState<PartyDiet[]>([]);
  const [dietNote, setDietNote] = useState("");
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (me) {
      setPhase("form");
      setName(me.name); setRsvp(me.rsvp); setSize(String(me.partySize)); setAllergies(me.allergies); setDiets(me.diets); setDietNote(me.dietNote ?? "");
      setPrefilled(false);
      return;
    }
    setPhase(signedIn ? "form" : "nudge");
    setName(firstName ?? ""); setRsvp("yes"); setSize("1");
    const p = signedIn && preferences ? joinPrefillFromProfile(getFoodProfile(preferences)) : null;
    setAllergies(p?.allergies ?? []); setDiets(p?.diets ?? []); setDietNote(p?.dietNote ?? "");
    setPrefilled(!!p && (p.allergies.length > 0 || p.diets.length > 0 || !!p.dietNote));
  }, [open, me, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        rsvp,
        partySize: Math.max(1, Math.min(20, Number(size) || 1)),
        allergies,
        diets,
        dietNote: dietNote.trim() || null,
      };
      if (me) { await partyApi.updateMe(token, body); return { guestToken: undefined }; }
      return partyApi.join(token, body);
    },
    onSuccess: (res) => {
      if (res.guestToken) setGuestToken(token, res.guestToken);
      queryClient.invalidateQueries({ queryKey: partyKeys.invite(token) });
      queryClient.invalidateQueries({ queryKey: partyKeys.list });
      onJoined(!signedIn);
    },
  });

  return (
    <Sheet open={open} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <SheetContent side={isMobile ? "bottom" : "right"} className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg md:max-h-none">
        <SheetHeader className="border-b px-4 py-4 pr-14 text-left">
          <SheetTitle className="font-serif text-2xl">
            {phase === "nudge" ? "Before you join" : me ? "Your answers" : `Join ${party.title}`}
          </SheetTitle>
          <SheetDescription className="text-base">
            {phase === "nudge" ? "You can join with or without an account." : "The host uses this to plan the food."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5">
          {phase === "nudge" ? (
            <div className="space-y-5">
              <div className="space-y-3 rounded-lg border-2 border-primary bg-primary/5 p-4">
                <p className="text-xl font-semibold">Create a free account</p>
                <p className="text-base">It takes one minute and is free.</p>
                <ul className="space-y-2 text-base">
                  <li className="flex items-start gap-2"><Check className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden /> Keep the recipe you bring</li>
                  <li className="flex items-start gap-2"><BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden /> Get the party cookbook with everyone's recipes</li>
                  <li className="flex items-start gap-2"><Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden /> Start with {WELCOME_CREDITS} free credits</li>
                </ul>
                <Button size="lg" className="w-full" onClick={() => navigate(signUpPath(token, false))}>
                  <UserPlus aria-hidden /> Create a free account
                </Button>
              </div>
              <Button variant="outline" className="w-full" onClick={() => setPhase("form")}>Continue as guest</Button>
              <p className="text-center text-sm text-muted-foreground">
                Already have an account? <button type="button" className="min-h-11 font-medium text-primary underline-offset-4 hover:underline" onClick={() => navigate(signUpPath(token, false, "signin"))}>Sign in</button>
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="join-name" className="text-base">Your name</Label>
                <Input id="join-name" className="min-h-11" maxLength={60} autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <p className="text-base font-medium" id="join-rsvp">Are you coming?</p>
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby="join-rsvp">
                  {RSVP_OPTIONS.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={rsvp === o.id}
                      onClick={() => setRsvp(o.id)}
                      className={cn(
                        "min-h-11 rounded-md border px-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        rsvp === o.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              {rsvp !== "no" && (
                <div className="space-y-2">
                  <Label htmlFor="join-size" className="text-base">How many people, counting you?</Label>
                  <Input id="join-size" type="number" inputMode="numeric" min={1} max={20} className="min-h-11 w-28" value={size} onChange={(e) => setSize(e.target.value)} />
                </div>
              )}
              <div className="space-y-2">
                <p className="text-base font-medium">Any food allergies?</p>
                <ChipToggle label="Allergies" options={ALLERGY_OPTIONS} value={allergies} onChange={setAllergies} />
              </div>
              <div className="space-y-2">
                <p className="text-base font-medium">Any diets?</p>
                <ChipToggle label="Diets" options={PARTY_DIETS} value={diets} onChange={setDiets} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="join-note" className="text-base">Anything else? (optional)</Label>
                <Textarea id="join-note" maxLength={300} placeholder="No cilantro, please" value={dietNote} onChange={(e) => setDietNote(e.target.value)} />
              </div>
              {prefilled && <p className="text-sm text-muted-foreground">We filled in allergies and diets from your Food profile. Change anything you like.</p>}
              <p className="text-sm text-muted-foreground">Only the host sees your allergies and diets. Other guests see a note on a dish if it doesn't suit someone.</p>
              {save.isError && <p className="text-sm text-destructive" role="alert">{partyErrorText(save.error, "We couldn't save that. Check your connection and try again.")}</p>}
            </>
          )}
        </div>

        {phase === "form" && (
          <SheetFooter className="flex-row gap-2 border-t px-4 py-3">
            <Button variant="outline" className="flex-1" disabled={save.isPending} onClick={() => (!me && !signedIn ? setPhase("nudge") : onClose())}>
              {!me && !signedIn ? "Back" : "Cancel"}
            </Button>
            <Button className="flex-1" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Loader2 className="motion-safe:animate-spin" aria-hidden />}
              {me ? "Save" : "Join the party"}
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
