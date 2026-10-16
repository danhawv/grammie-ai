import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useIsFetching, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { PRINTABLES, type PartyDetail, type PrintableKind } from "@shared/party";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-states";
import { PRINT_CSS, SheetStack, THEMES, useThemeFonts, type PrintTheme } from "@/components/party-print/sheet";
import { MenuSheet } from "@/components/party-print/menu-sheet";
import { FoodLabelSheets, PlaceCardSheets } from "@/components/party-print/tent-cards";
import { RecipeCardSheets, recipeDishes } from "@/components/party-print/recipe-cards";
import { inviteTokenFrom, placeCards, type StepsLength } from "@/lib/party-print";
import { printPage } from "@/lib/platform";

// The party printables (/parties/:id/print/:kind): the menu, place cards,
// food labels and take-home recipe cards, shown as the Letter sheets they
// print on, with a toolbar of small choices. Only the sheets print.

const THEME_KEY = "grammie.partyPrint.theme";

const TIPS: Record<PrintableKind, string> = {
  menu: "One page for the table or the fridge.",
  "place-cards": "Print at 100% (not \"fit to page\"). Cut on the dashed lines and fold on the dotted line.",
  "food-labels": "Print at 100%. Cut on the dashed lines and fold on the dotted line. What's in each dish comes from its recipe, so check with the cook for serious allergies.",
  "recipe-cards": "Two 4×6 cards per page. Cut on the dashed lines. The code opens the whole recipe on any phone, no account needed.",
};

export default function PartyPrintPage() {
  const { id, kind: rawKind } = useParams<{ id: string; kind: string }>();
  const [, navigate] = useLocation();
  const kind = PRINTABLES.find((p) => p.id === rawKind)?.id ?? null;
  const query = useQuery<PartyDetail>({ queryKey: ["/api/parties", id] });
  const back = `/parties/${id}`;

  const [theme, setTheme] = useState<PrintTheme>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return THEMES.some((t) => t.id === saved) ? (saved as PrintTheme) : "classic";
    } catch { return "classic"; }
  });
  const [showCooks, setShowCooks] = useState(true);
  const [showMarks, setShowMarks] = useState(true);
  const [blanks, setBlanks] = useState(0);
  const [showDish, setShowDish] = useState(false);
  const [steps, setSteps] = useState<StepsLength>("short");
  const [showScale, setShowScale] = useState(false);
  useThemeFonts(theme);

  // Recipe cards wait for the full recipes before printing
  const fetchingRecipes = useIsFetching({ predicate: (q) => /^\/api\/party\/.+\/recipe$/.test(String(q.queryKey[0])) });

  const printable = PRINTABLES.find((p) => p.id === kind);
  useEffect(() => {
    document.title = `${printable?.title ?? "Printables"}${query.data ? ` · ${query.data.title}` : ""} · Grammie`;
  }, [printable, query.data]);

  const pickTheme = (t: PrintTheme) => {
    setTheme(t);
    try { localStorage.setItem(THEME_KEY, t); } catch { /* not remembered */ }
  };

  const print = async () => {
    // Fonts for the chosen look must be in before the sheets go to the printer
    try { await (document as any).fonts?.ready; } catch { /* print anyway */ }
    await printPage();
  };

  const party = query.data;
  const token = inviteTokenFrom(party?.inviteUrl);

  let body: ReactNode;
  if (!kind) {
    body = (
      <EmptyState
        title="We don't have that printable"
        description="Pick one from the list above, or go back to the party."
        action={<Button asChild><Link href={back}>Back to the party</Link></Button>}
      />
    );
  } else if (query.isLoading) {
    body = <LoadingState label="Getting your printables ready" variant="cards" rows={2} />;
  } else if (query.isError || !party) {
    body = <ErrorState title="Couldn't open this party" onRetry={() => query.refetch()} />;
  } else {
    body = <Sheets
      kind={kind} party={party} token={token} back={back} theme={theme}
      showCooks={showCooks} showMarks={showMarks} blanks={blanks} showDish={showDish} steps={steps} showScale={showScale}
    />;
  }

  return (
    <div className="pp-page min-h-screen bg-muted/40 print:bg-white">
      <style>{PRINT_CSS}</style>
      {/* Back, which printable and Print stay in view; the options scroll away on a phone */}
      <div className="no-print sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-2">
          <Button variant="ghost" className="h-11 px-2" asChild><Link href={back}><ArrowLeft aria-hidden /> Back</Link></Button>
          <label className="sr-only" htmlFor="pp-kind">Printable</label>
          <select
            id="pp-kind"
            className="h-11 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm sm:max-w-56 sm:flex-none"
            value={kind ?? ""}
            onChange={(e) => navigate(`/parties/${id}/print/${e.target.value}`, { replace: true })}
          >
            {!kind && <option value="">Choose…</option>}
            {PRINTABLES.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          <Button className="print-button ml-auto h-11" onClick={() => void print()} disabled={!party || !kind || fetchingRecipes > 0}>
            <Printer aria-hidden /> {fetchingRecipes > 0 ? "Getting recipes…" : "Print"}
          </Button>
        </div>
      </div>
      <div className="no-print border-b bg-background empty:hidden">
        {kind && (
          <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-1">
            <OptionSelect id="pp-theme" label="Look" value={theme} onChange={(v) => pickTheme(v as PrintTheme)}
              options={THEMES.map((t) => ({ value: t.id, label: t.label }))} />
            {(kind === "menu" || kind === "food-labels" || kind === "recipe-cards") && (
              <Toggle id="pp-cooks" label="Who made it" checked={showCooks} onChange={setShowCooks} />
            )}
            {(kind === "menu" || kind === "food-labels") && (
              <Toggle id="pp-marks" label="Diet marks" checked={showMarks} onChange={setShowMarks} />
            )}
            {kind === "place-cards" && (
              <>
                <Toggle id="pp-dish" label="What they're bringing" checked={showDish} onChange={setShowDish} />
                <OptionSelect id="pp-blanks" label="Blank cards" value={String(blanks)} onChange={(v) => setBlanks(Number(v))}
                  options={[0, 1, 2, 3, 4, 6, 8, 12].map((n) => ({ value: String(n), label: String(n) }))} />
              </>
            )}
            {kind === "recipe-cards" && (
              <>
                <OptionSelect id="pp-steps" label="Steps" value={steps} onChange={(v) => setSteps(v as StepsLength)}
                  options={[{ value: "short", label: "First few" }, { value: "long", label: "As many as fit" }, { value: "none", label: "None, just the code" }]} />
                {party?.style === "dinner" && (
                  <Toggle id="pp-scale" label="Note the party amount" checked={showScale} onChange={setShowScale} />
                )}
              </>
            )}
          </div>
        )}
        {kind && <p className="mx-auto max-w-4xl px-4 pb-3 text-sm text-muted-foreground">{TIPS[kind]}</p>}
      </div>
      {body}
    </div>
  );
}

function Sheets({ kind, party, token, back, theme, showCooks, showMarks, blanks, showDish, steps, showScale }: {
  kind: PrintableKind;
  party: PartyDetail;
  token: string | null;
  back: string;
  theme: PrintTheme;
  showCooks: boolean;
  showMarks: boolean;
  blanks: number;
  showDish: boolean;
  steps: StepsLength;
  showScale: boolean;
}) {
  const backButton = <Button asChild><Link href={back}>Back to the party</Link></Button>;
  const empty = (title: string, description: string) => (
    <div className="mx-auto max-w-xl px-4 py-8"><EmptyState title={title} description={description} action={backButton} /></div>
  );

  if (kind === "menu") {
    if (!party.dishes.length) return empty("No dishes yet", "The menu fills in as guests pick what they're bringing. Come back once a few dishes are in.");
    return <SheetStack theme={theme}><MenuSheet party={party} showCooks={showCooks} showMarks={showMarks} /></SheetStack>;
  }
  if (kind === "place-cards") {
    const cards = placeCards(party.guests, party.dishes, { blanks, showDish });
    if (!cards.length) return empty("Nobody has said yes yet", "Place cards are made for everyone coming. You can also add blank cards to write names on.");
    return <SheetStack theme={theme}><PlaceCardSheets cards={cards} /></SheetStack>;
  }
  if (kind === "food-labels") {
    if (!party.dishes.length) return empty("No dishes yet", "Each dish gets a label once someone says they're bringing it.");
    return <SheetStack theme={theme}><FoodLabelSheets party={party} showCooks={showCooks} showMarks={showMarks} /></SheetStack>;
  }
  if (!recipeDishes(party).length) {
    return empty("No recipes yet", "Recipe cards are made for dishes that come with a recipe. Dishes added by name only don't get one.");
  }
  if (!token) return empty("Only the host can print these", "Recipe cards carry the party's invite code, so they print from the host's account.");
  return (
    <SheetStack theme={theme}>
      <RecipeCardSheets party={party} token={token} showCooks={showCooks} steps={steps} showScale={showScale} />
    </SheetStack>
  );
}

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex h-11 items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="text-sm">{label}</Label>
    </div>
  );
}

function OptionSelect({ id, label, value, onChange, options }: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex h-11 items-center gap-2">
      <Label htmlFor={id} className="shrink-0 text-sm">{label}</Label>
      <select id={id} className="h-11 rounded-md border bg-background px-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
