import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, Camera, ChevronRight, FileText, Link2, Loader2, Search, Tag, Utensils } from "lucide-react";
import {
  COURSES,
  courseLabel,
  dishConflicts,
  dishScale,
  duplicateOf,
  openSlots,
  type DishConflict,
  type PartyCourse,
  type PartyDetail,
  type PartyDish,
  type PartySlot,
} from "@shared/party";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PhotoPicker } from "@/components/photo-picker";
import { useIsMobile } from "@/hooks/use-mobile";
import { apiFetch, mediaUrl } from "@/lib/platform";
import { downscaleImage } from "@/lib/images";
import { queryClient } from "@/lib/queryClient";
import { partyApi, partyErrorText, partyKeys } from "@/lib/party-api";
import { recipeFactsFrom, scaleText } from "@/lib/party-format";
import { slotName } from "./party-bits";
import { cn } from "@/lib/utils";

// "Pick what you're bringing": choose a place on the menu, then how — one of
// my Grammie recipes (signed in), a link, a photo of a recipe card, pasted
// text, or just a name ("a bottle of red"). Before adding a recipe or a name we
// check for the same dish twice and for allergy/diet clashes, and ask.

type Method = "mine" | "link" | "photo" | "text" | "name";
type Screen = "where" | "how" | Method | "check";

const MIN_TEXT = 20;

interface Pending {
  title: string;
  recipeId?: string;
  image?: string | null;
  conflicts: DishConflict[];
  duplicate: { title: string; guestName: string } | null;
  scale: string | null;
}

export function BringDishSheet({
  party,
  token,
  open,
  slot,
  signedIn,
  onClose,
  onAdded,
}: {
  party: PartyDetail;
  token: string;
  open: boolean;
  /** The open place they tapped, if any */
  slot: PartySlot | null;
  signedIn: boolean;
  onClose: () => void;
  onAdded: (dish: PartyDish) => void;
}) {
  const isMobile = useIsMobile();
  const [screen, setScreen] = useState<Screen>("where");
  const [slotId, setSlotId] = useState<string | null>(null);
  const [course, setCourse] = useState<PartyCourse>("other");
  const [link, setLink] = useState("");
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const free = useMemo(() => openSlots(party.slots, party.dishes).sort((a, b) => a.position - b.position), [party.slots, party.dishes]);

  useEffect(() => {
    if (!open) return;
    setSlotId(slot?.id ?? null);
    setCourse(slot?.course ?? "other");
    setScreen(slot ? "how" : "where");
    setLink(""); setText(""); setName(""); setNote(""); setSearch(""); setPending(null);
    add.reset();
  }, [open, slot]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (open) headingRef.current?.focus(); }, [screen, open]);

  const place = slotId ? party.slots.find((s) => s.id === slotId) : null;
  const placeText = place ? slotName(place) : courseLabel(course);

  const done = (dish: PartyDish) => {
    queryClient.invalidateQueries({ queryKey: partyKeys.invite(token) });
    queryClient.invalidateQueries({ queryKey: partyKeys.list });
    queryClient.invalidateQueries({ queryKey: ["parties", "host"] });
    onAdded(dish);
  };

  const add = useMutation({
    mutationFn: async (input: { kind: Method; photo?: Blob; recipeId?: string }) => {
      const where = { course, slotId };
      switch (input.kind) {
        case "mine": return partyApi.addDish(token, { ...where, recipeId: input.recipeId, note: note.trim() || null });
        case "name": return partyApi.addDish(token, { ...where, title: name.trim(), note: note.trim() || null });
        case "link": return partyApi.importLink(token, { ...where, url: link.trim() });
        case "text": return partyApi.importText(token, { ...where, text: text.trim() });
        case "photo": return partyApi.importPhoto(token, await downscaleImage(input.photo!), course, slotId);
      }
    },
    onSuccess: done,
  });

  const check = (p: Omit<Pending, "duplicate">) => {
    const dup = duplicateOf(p.title, party.dishes);
    const next = { ...p, duplicate: dup ? { title: dup.title, guestName: dup.guestName } : null };
    setPending(next);
    if (next.duplicate || next.conflicts.length) setScreen("check");
    else add.mutate({ kind: p.recipeId ? "mine" : "name", recipeId: p.recipeId });
  };

  const pickRecipe = (r: any) => {
    const facts = recipeFactsFrom(r);
    const { scale, makeServings } = dishScale(party.style, facts.servings, party.headcount);
    check({
      title: facts.title,
      recipeId: facts.id,
      image: facts.image,
      conflicts: dishConflicts(facts, party.guests),
      scale: scaleText({ scale, makeServings }, party.style),
    });
  };

  const back = () => {
    if (screen === "how") setScreen("where");
    else if (screen === "check") setScreen(pending?.recipeId ? "mine" : "name");
    else setScreen("how");
  };

  const busy = add.isPending;
  const TITLES: Record<Screen, string> = {
    where: "Which course?",
    how: "What are you bringing?",
    mine: "Pick one of your recipes",
    link: "Paste a link",
    photo: "A photo of the recipe",
    text: "Paste or type the recipe",
    name: "Just a name",
    check: "Before you add it",
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <SheetContent side={isMobile ? "bottom" : "right"} className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg md:max-h-none">
        <SheetHeader className="border-b px-4 py-4 pr-14 text-left">
          <SheetTitle asChild>
            <h2 ref={headingRef} tabIndex={-1} className="font-serif text-2xl font-bold focus:outline-none">{TITLES[screen]}</h2>
          </SheetTitle>
          <SheetDescription className="text-base">
            {screen === "where" ? "Pick an open place on the menu, or bring something extra." : `For: ${placeText}`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
          {screen === "where" && (
            <>
              {free.length > 0 ? (
                <ul className="space-y-2">
                  {free.map((s) => (
                    <li key={s.id}>
                      <ChoiceButton title={slotName(s)} onClick={() => { setSlotId(s.id); setCourse(s.course); setScreen("how"); }} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-base text-muted-foreground">Every place on the menu is taken. You can still bring something extra.</p>
              )}
              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-base font-medium">Something extra</p>
                <div className="flex flex-wrap gap-2">
                  <Select value={course} onValueChange={(v) => setCourse(v as PartyCourse)}>
                    <SelectTrigger className="min-h-11 w-48" aria-label="Course"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {COURSES.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={() => { setSlotId(null); setScreen("how"); }}>Next</Button>
                </div>
              </div>
            </>
          )}

          {screen === "how" && (
            <>
              <ul className="space-y-2">
                {signedIn && <li><ChoiceButton icon={BookOpen} title="One of my Grammie recipes" hint="From your recipes and cookbooks" onClick={() => setScreen("mine")} /></li>}
                <li><ChoiceButton icon={Link2} title="Paste a link" hint="A website, Instagram or TikTok post" onClick={() => setScreen("link")} /></li>
                <li><ChoiceButton icon={Camera} title="Photo of a recipe" hint="Snap a recipe card or cookbook page" onClick={() => setScreen("photo")} /></li>
                <li><ChoiceButton icon={FileText} title="Paste or type it" hint="Copy the recipe text from anywhere" onClick={() => setScreen("text")} /></li>
                <li><ChoiceButton icon={Tag} title="Just a name" hint="Like “a bottle of red” or “store-bought pie”" onClick={() => setScreen("name")} /></li>
              </ul>
              {party.credits != null && (
                <p className="text-sm text-muted-foreground">
                  Reading a recipe from a link, photo or text uses credits. You have {party.credits} free {party.credits === 1 ? "credit" : "credits"}.
                </p>
              )}
            </>
          )}

          {screen === "mine" && <MyRecipes search={search} onSearch={setSearch} onPick={pickRecipe} busy={busy} />}

          {screen === "link" && (
            <div className="space-y-2">
              <Label htmlFor="bd-link" className="text-base">Link to the recipe</Label>
              <Input id="bd-link" type="url" inputMode="url" className="min-h-11" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} />
              <p className="text-sm text-muted-foreground">Grammie reads the recipe and adds it for you. It takes about a minute.</p>
            </div>
          )}

          {screen === "photo" && (
            <PhotoPicker
              multiple={false}
              disabled={busy}
              libraryLabel="Choose a photo"
              onPick={(files) => files[0] && add.mutate({ kind: "photo", photo: files[0] })}
            >
              <p className="text-base text-muted-foreground">One clear photo of the recipe card or page.</p>
            </PhotoPicker>
          )}

          {screen === "text" && (
            <div className="space-y-2">
              <Label htmlFor="bd-text" className="text-base">The recipe</Label>
              <Textarea id="bd-text" rows={10} placeholder="Paste the ingredients and steps here" value={text} onChange={(e) => setText(e.target.value)} />
            </div>
          )}

          {screen === "name" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="bd-name" className="text-base">What are you bringing?</Label>
                <Input id="bd-name" className="min-h-11" maxLength={120} placeholder="A bottle of red" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bd-note" className="text-base">A note (optional)</Label>
                <Input id="bd-note" className="min-h-11" maxLength={200} placeholder="Nut-free!" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </>
          )}

          {screen === "check" && pending && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                {pending.image ? (
                  <img src={mediaUrl(pending.image)} alt="" className="h-14 w-14 rounded-md object-cover" />
                ) : (
                  <span className="flex h-14 w-14 items-center justify-center rounded-md bg-muted" aria-hidden><Utensils className="h-6 w-6 text-muted-foreground" /></span>
                )}
                <p className="text-lg font-semibold">{pending.title}</p>
              </div>
              {pending.duplicate && (
                <Warning>{pending.duplicate.guestName} is already bringing {pending.duplicate.title}.</Warning>
              )}
              {pending.conflicts.map((c) => <Warning key={`${c.kind}-${c.what}`}>{c.message}.</Warning>)}
              {pending.scale && <p className="text-base">{pending.scale}</p>}
              <p className="text-base">Bring it anyway?</p>
            </div>
          )}

          {add.isError && (
            <p className="text-sm text-destructive" role="alert">
              {partyErrorText(add.error, "We couldn't add that. Check your connection and try again.")}
            </p>
          )}
        </div>

        {screen !== "where" && (
          <SheetFooter className="flex-row gap-2 border-t px-4 py-3">
            <Button variant="outline" className="flex-1" disabled={busy} onClick={screen === "how" && slot ? onClose : back}>
              {screen === "check" ? "Pick something else" : screen === "how" && slot ? "Cancel" : "Back"}
            </Button>
            {screen === "link" && (
              <Button className="flex-1" disabled={busy || !/\S+\.\S+/.test(link)} onClick={() => add.mutate({ kind: "link" })}>
                {busy && <Loader2 className="motion-safe:animate-spin" aria-hidden />} Add it
              </Button>
            )}
            {screen === "text" && (
              <Button className="flex-1" disabled={busy || text.trim().length < MIN_TEXT} onClick={() => add.mutate({ kind: "text" })}>
                {busy && <Loader2 className="motion-safe:animate-spin" aria-hidden />} Add it
              </Button>
            )}
            {screen === "name" && (
              <Button
                className="flex-1"
                disabled={busy || !name.trim()}
                onClick={() => check({ title: name.trim(), conflicts: [], scale: null, image: null })}
              >
                {busy && <Loader2 className="motion-safe:animate-spin" aria-hidden />} Add it
              </Button>
            )}
            {screen === "check" && (
              <Button className="flex-1" disabled={busy} onClick={() => add.mutate({ kind: pending?.recipeId ? "mine" : "name", recipeId: pending?.recipeId })}>
                {busy && <Loader2 className="motion-safe:animate-spin" aria-hidden />} Bring it anyway
              </Button>
            )}
            {screen === "photo" && busy && (
              <p className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden /> Sending the photo…</p>
            )}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-base text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function ChoiceButton({ icon: Icon, title, hint, onClick }: { icon?: typeof BookOpen; title: string; hint?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 w-full items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {Icon && <Icon className="h-6 w-6 shrink-0 text-primary" aria-hidden />}
      <span className="min-w-0 flex-1">
        <span className="block text-base font-medium">{title}</span>
        {hint && <span className="block text-sm text-muted-foreground">{hint}</span>}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

/** The signed-in guest's own recipes, searchable */
function MyRecipes({ search, onSearch, onPick, busy }: { search: string; onSearch: (s: string) => void; onPick: (r: any) => void; busy: boolean }) {
  const [debounced, setDebounced] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const query = useQuery({
    queryKey: ["/api/recipes", "party-picker", debounced],
    queryFn: async () => {
      const params = new URLSearchParams({ page: "1", limit: "30", scope: "my" });
      if (debounced) params.set("search", debounced);
      const res = await apiFetch(`/api/recipes?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      return (data.recipes || data) as any[];
    },
  });
  const recipes = query.data ?? [];
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input className="min-h-11 pl-9" placeholder="Search my recipes" aria-label="Search my recipes" value={search} onChange={(e) => onSearch(e.target.value)} />
      </div>
      {query.isLoading ? (
        <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden /> Loading your recipes…</p>
      ) : query.isError ? (
        <p className="text-destructive">We couldn't load your recipes. Check your connection and try again.</p>
      ) : recipes.length === 0 ? (
        <p className="text-muted-foreground">{debounced ? "No recipes match that." : "You don't have any recipes yet. Paste a link or snap a photo instead."}</p>
      ) : (
        <ul className="space-y-2">
          {recipes.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(r)}
                className={cn("flex min-h-14 w-full items-center gap-3 rounded-lg border p-2 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", busy && "opacity-60")}
              >
                {r.dishImageThumbnail ? (
                  <img src={mediaUrl(r.dishImageThumbnail)} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" loading="lazy" />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted" aria-hidden><Utensils className="h-5 w-5 text-muted-foreground" /></span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-medium">{r.title}</span>
                  {r.servings ? <span className="block text-sm text-muted-foreground">Serves {r.servings}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
