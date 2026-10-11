import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Printer } from "lucide-react";
import type { ContainerLabel, PrepSetup } from "@shared/meal-prep/contract";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ErrorState, LoadingState } from "@/components/page-states";
import { knownTitles, useOwnerRecipes, type CookData } from "@/components/meal-prep/cook-data";
import { cookPath, errorText } from "@/lib/meal-prep-api";
import {
  formatDay,
  formatMacro,
  formatMinutes,
  formatServings,
  LABEL_LAYOUTS,
  labelSheets,
  labelSlotText,
  LANE_LABELS,
  quarterFraction,
  sessionClock,
  type LabelLayout,
} from "@/lib/meal-prep-format";
import { cn } from "@/lib/utils";
import { useCookData, useCookSource } from "./meal-prep-cook";
import { printPage } from "@/lib/platform";

// The printable cook packet: overview, shopping list, mise en place, the
// timeline, a card per dish (with the written recipe), the portion plan,
// and container labels laid out for standard sticker sheets. Reachable by
// the owner (/meal-prep/:id/packet) and from a cook's share link
// (/prep/cook/:token/packet).

const LAYOUT_KEY = "grammie-mp-label-layout";

export default function MealPrepPacketPage() {
  const source = useCookSource();
  const query = useCookData(source);
  const [layoutId, setLayoutId] = useState<LabelLayout["id"]>(() => {
    try { return (localStorage.getItem(LAYOUT_KEY) as LabelLayout["id"]) || "avery-5163"; } catch { return "avery-5163"; }
  });
  const layout = LABEL_LAYOUTS.find((l) => l.id === layoutId) ?? LABEL_LAYOUTS[0];
  const back = source.kind === "cook" ? cookPath(source.token) : `/meal-prep/${source.id}`;

  useEffect(() => { document.title = "Meal prep packet · Grammie"; }, []);
  useEffect(() => {
    if (query.data && window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, [query.data]);

  if (query.isLoading) return <div className="mx-auto max-w-3xl px-4 py-6"><LoadingState label="Getting the packet ready" rows={6} /></div>;
  if (query.isError || !query.data) return <div className="mx-auto max-w-3xl px-4 py-6"><ErrorState title="Couldn't open the packet" description={errorText(query.error, "This plan doesn't have a cooking day yet.")} onRetry={() => query.refetch()} /></div>;

  return (
    <div className="mp-packet bg-background">
      <style>{PRINT_CSS(layout)}</style>
      <div className="no-print sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-4 py-3">
          <Button variant="ghost" asChild><Link href={back}><ArrowLeft aria-hidden /> Back</Link></Button>
          <div className="flex min-w-0 items-center gap-2">
            <Label htmlFor="label-layout" className="shrink-0 text-sm">Label sheets</Label>
            <select
              id="label-layout"
              className="h-11 min-w-0 rounded-md border bg-background px-2 text-sm"
              value={layoutId}
              onChange={(e) => {
                setLayoutId(e.target.value as LabelLayout["id"]);
                try { localStorage.setItem(LAYOUT_KEY, e.target.value); } catch { /* not remembered */ }
              }}
            >
              {LABEL_LAYOUTS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <Button className="print-button ml-auto" onClick={() => void printPage()}><Printer aria-hidden /> Print</Button>
        </div>
      </div>
      <Packet data={query.data} layout={layout} owner={source.kind === "owner"} />
    </div>
  );
}

function Packet({ data, layout, owner }: { data: CookData; layout: LabelLayout; owner: boolean }) {
  const { session, shopping, setup } = data;
  // The owner's view doesn't carry the written recipes; read them from the app
  const own = useOwnerRecipes(data.dishes.map((d) => d.id), owner);
  const dishes = data.dishes.map((d) => (d.ingredients ? d : { ...d, ingredients: own[d.id]?.ingredients, instructions: own[d.id]?.instructions }));
  const people = Array.from(new Set(session.labels.map((l) => l.person)));
  const sheets = labelSheets(session.labels, layout);

  return (
    <article className="mx-auto max-w-3xl space-y-10 px-4 py-6 text-base print:max-w-none print:space-y-0 print:p-0">
      <section className="packet-page space-y-4">
        <h1 className="font-serif text-3xl font-bold">Meal prep{data.sessionDate ? ` · ${formatDay(data.sessionDate)}` : ""}</h1>
        <p>
          {dishes.length} dishes{people.length ? ` for ${people.join(" and ")}` : ""}, covering {data.days} {data.days === 1 ? "day" : "days"}.
          About {formatMinutes(session.totalMinutes)} in the kitchen ({formatMinutes(session.handsOnMinutes)} hands-on), {session.containers.count} containers.
        </p>
        <h2 className="text-xl font-semibold">Dishes</h2>
        <ul className="list-disc pl-6">
          {dishes.map((d) => <li key={d.id}>{d.title}{d.servingsMade ? ` — make ${formatServings(d.servingsMade)}` : ""}</li>)}
        </ul>
        {data.householdAllergies.length > 0 && <p className="font-semibold">Allergies in this house: {data.householdAllergies.join(", ")}.</p>}
        <h2 className="text-xl font-semibold">Before the cooking day</h2>
        <ul className="space-y-1">{session.beforeSession.map((t) => <li key={t} className="flex gap-2"><Box /> {t}</li>)}</ul>
        <h2 className="text-xl font-semibold">Equipment</h2>
        <p>{session.equipment.join(" · ")}</p>
        {session.safety.length > 0 && (
          <>
            <h2 className="text-xl font-semibold">Keeping food safe</h2>
            <ul className="list-disc pl-6">{session.safety.map((s) => <li key={s}>{s}</li>)}</ul>
          </>
        )}
      </section>

      {shopping && <section className="packet-page space-y-4">
        <h2 className="font-serif text-2xl font-bold">Shopping list</h2>
        <div className="columns-1 gap-8 sm:columns-2 print:columns-2">
          {shopping.byAisle.map((a) => (
            <div key={a.aisle} className="mb-4 break-inside-avoid">
              <h3 className="font-semibold">{a.aisle}</h3>
              <ul>
                {a.items.map((i) => (
                  <li key={i.ingredient.id} className="flex gap-2">
                    <Box checked={i.have} />
                    <span>{i.ingredient.name} — {i.buy ?? i.display}{i.have ? " (have)" : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {shopping.pantryCheck.length > 0 && (
          <>
            <h3 className="font-semibold">Check the pantry</h3>
            <ul>{shopping.pantryCheck.map((p) => <li key={p} className="flex gap-2"><Box /> {p}</li>)}</ul>
          </>
        )}
      </section>}

      <section className="packet-page space-y-4">
        <h2 className="font-serif text-2xl font-bold">Chop and measure first</h2>
        <ul className="space-y-1">
          {session.misePlace.map((m, i) => (
            <li key={i} className="flex gap-2"><Box /> <span>{m.text} {knownTitles(data.titles, m.recipeIds).length > 0 && <span className="text-muted-foreground">({knownTitles(data.titles, m.recipeIds).join(", ")})</span>}</span></li>
          ))}
        </ul>
        <h2 className="pt-4 font-serif text-2xl font-bold">Timeline</h2>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-1 pr-3">Time</th>
              <th scope="col" className="py-1 pr-3">Where</th>
              <th scope="col" className="py-1">Step</th>
            </tr>
          </thead>
          <tbody>
            {[...session.tasks].sort((a, b) => a.start - b.start).map((t) => (
              <tr key={t.id} className="border-b align-top">
                <td className="py-1.5 pr-3 tabular-nums">{sessionClock(t.start)}</td>
                <td className="py-1.5 pr-3">{LANE_LABELS[t.lane]}{data.cooks > 1 ? ` · Cook ${t.cook}` : ""}</td>
                <td className="py-1.5">
                  <span className="flex gap-2"><Box /> <span>{t.text}{t.passiveMin > 0 ? ` (${formatMinutes(t.passiveMin)} on its own)` : ""}{t.doneCue && <span className="block text-sm italic">Ready when: {t.doneCue}</span>}</span></span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="packet-page space-y-4">
        <h2 className="font-serif text-2xl font-bold">The dishes</h2>
        {dishes.map((d) => (
          <div key={d.id} className="break-inside-avoid rounded-md border p-3">
            <h3 className="text-lg font-semibold">{d.title}</h3>
            <p>
              {d.servingsMade ? `Make ${formatServings(d.servingsMade)}` : "Make one batch"}
              {d.scale !== 1 ? ` — ${quarterFraction(d.scale)}× the recipe, so multiply every amount below by ${quarterFraction(d.scale)}` : ""}.
            </p>
            {d.ingredients?.length ? (
              <div className="mt-2 grid gap-4 sm:grid-cols-[2fr_3fr] print:grid-cols-[2fr_3fr]">
                <ul className="list-disc pl-5">{d.ingredients.map((x, i) => <li key={i}>{x}</li>)}</ul>
                <ol className="list-decimal pl-5">{d.instructions?.map((x, i) => <li key={i}>{x}</li>)}</ol>
              </div>
            ) : (
              <p className="text-muted-foreground">Follow the family recipe as written.</p>
            )}
          </div>
        ))}
      </section>

      <section className="packet-page space-y-4">
        <h2 className="font-serif text-2xl font-bold">Portion plan</h2>
        {people.map((person) => (
          <div key={person} className="break-inside-avoid">
            <h3 className="text-lg font-semibold">{person}</h3>
            <table className="w-full border-collapse text-left">
              <tbody>
                {session.labels.filter((l) => l.person === person).map((l) => (
                  <tr key={l.plateKey} className="border-b align-top">
                    <td className="py-1 pr-3">{labelSlotText(l, setup ?? undefined).replace(`${person} · `, "")}</td>
                    <td className="py-1 pr-3">{l.portion}</td>
                    <td className="w-20 py-1">{l.storage === "freezer" ? "Freezer" : "Fridge"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      <section id="labels" className="space-y-4 print:space-y-0">
        <h2 className="font-serif text-2xl font-bold print:hidden">Container labels</h2>
        <p className="print:hidden">
          {session.labels.length} labels on {sheets.length} {sheets.length === 1 ? "sheet" : "sheets"} of {layout.name.split(" (")[0].toLowerCase()} stickers.
          Print at 100% (not "fit to page") so they line up.
        </p>
        {/* Screen preview: the labels as cards */}
        <ul className="grid gap-3 sm:grid-cols-2 print:hidden">
          {session.labels.map((l) => <li key={l.plateKey} className="rounded-md border p-3"><LabelBody label={l} setup={setup} compact={false} /></li>)}
        </ul>
        {/* Print: exact sticker-sheet positions */}
        {sheets.map((sheet, i) => (
          <div key={i} className="label-sheet hidden print:grid">
            {sheet.map((l) => <div key={l.plateKey} className="label-cell"><LabelBody label={l} setup={setup} compact={layout.compact} /></div>)}
          </div>
        ))}
      </section>
    </article>
  );
}

function LabelBody({ label, setup, compact }: { label: ContainerLabel; setup: PrepSetup | null; compact: boolean }) {
  const approx = label.confidence === "low";
  const dates = `Made ${formatDay(label.madeOn, { weekday: false })} · Eat by ${formatDay(label.eatBy)}`;
  if (compact) {
    return (
      <div className="label-compact">
        <p className="font-semibold">{labelSlotText(label, setup ?? undefined)}</p>
        <p className="truncate">{label.title}</p>
        <p>{label.storage === "freezer" ? "FREEZER · " : ""}{dates}</p>
        <p>{formatMacro("kcal", label.macros.kcal, approx)} · {formatMacro("protein", label.macros.protein, approx)}</p>
      </div>
    );
  }
  return (
    <div className="space-y-0.5 text-sm leading-snug">
      <p className="flex justify-between gap-2 font-semibold">
        <span>{labelSlotText(label, setup ?? undefined)}</span>
        <span>{label.storage === "freezer" ? "FREEZER" : "FRIDGE"}</span>
      </p>
      <p className="text-base font-semibold">{label.title}</p>
      <p>{label.portion}</p>
      <p>{dates}</p>
      <p>{formatMacro("kcal", label.macros.kcal, approx)} · {formatMacro("protein", label.macros.protein, approx)} · {formatMacro("carbs", label.macros.carbs, approx)} · {formatMacro("fat", label.macros.fat, approx)}</p>
      <p>Reheat: {label.reheat}</p>
      {label.allergens.length > 0 && <p>May contain: {label.allergens.join(", ")}</p>}
    </div>
  );
}

function Box({ checked }: { checked?: boolean }) {
  return <span aria-hidden className={cn("mt-1 inline-block h-4 w-4 shrink-0 border border-current", checked && "bg-current")} />;
}

/** Page breaks per section, and sticker sheets on a margin-less named page */
function PRINT_CSS(l: LabelLayout) {
  return `
@media print {
  .mp-packet { font-size: 11pt; }
  .mp-packet .packet-page { break-after: page; }
  .mp-packet .label-sheet {
    page: labels;
    break-after: page;
    width: 8.5in; height: 11in; box-sizing: border-box;
    padding: ${l.top}in ${l.side}in 0;
    grid-template-columns: repeat(${l.cols}, ${l.width}in);
    grid-auto-rows: ${l.height}in;
    column-gap: ${l.colGap}in;
  }
  .mp-packet .label-sheet:last-child { break-after: auto; }
  .mp-packet .label-cell { overflow: hidden; padding: ${l.compact ? "0.06in 0.1in" : "0.12in 0.16in"}; box-sizing: border-box; }
  .mp-packet .label-compact { font-size: 7pt; line-height: 1.2; }
  .mp-packet .label-cell .text-sm { font-size: 8pt; }
  .mp-packet .label-cell .text-base { font-size: 10pt; }
}
@page labels { size: letter; margin: 0; }
`;
}
