import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  BOOK_SIZES,
  BINDING_PAPER_COMPATIBILITY,
  BINDING_PAGE_LIMITS,
  type BindingTypeId,
  type ColorTypeId,
  type CoverFinishId,
  type PaperTypeId,
  type TrimSizeId,
} from "@/lib/print-constants";
import type { BookDraft } from "./types";
import { bindingFit, formatPrice, usePrintEstimate, type BookSpec } from "./use-print-estimate";

// Step 1: what kind of book. Three formats with a price each, three sizes,
// and the printer's options (paper, color, finish) tucked away with sensible
// defaults, so nobody has to know what "60# uncoated" means.

const FORMATS: { id: BindingTypeId; name: string; blurb: string }[] = [
  { id: "CW", name: "Hardcover", blurb: "Sturdy and giftable. Made to be handed down." },
  { id: "PB", name: "Paperback", blurb: "Light, flexible and the most affordable." },
  { id: "CO", name: "Lay-flat coil", blurb: "Stays open on the counter while you cook." },
];

const SIZE_PRESETS: { id: TrimSizeId; name: string; blurb: string }[] = [
  { id: "0600X0900", name: "Classic", blurb: "6 × 9 in · fits on any shelf" },
  { id: "0850X0850", name: "Square", blurb: "8.5 × 8.5 in · photo-book feel" },
  { id: "0850X1100", name: "Large", blurb: "8.5 × 11 in · big type, big photos" },
];

const PAPERS: Record<PaperTypeId, { name: string; blurb: string }> = {
  "080CW444": { name: "Bright white, smooth", blurb: "Best for color photos." },
  "060UW444": { name: "White, uncoated", blurb: "A softer, book-like page." },
  "060UC444": { name: "Cream, uncoated", blurb: "Warm and classic. Black and white only." },
};

/** A paper that works with this binding and color, keeping the current one when it can */
export function paperFor(binding: BindingTypeId, color: ColorTypeId, current: PaperTypeId): PaperTypeId {
  const ok = (BINDING_PAPER_COMPATIBILITY[binding] || []).filter((p) => color === "BW" || p !== "060UC444");
  if (ok.includes(current)) return current;
  if (color === "FC" && ok.includes("080CW444")) return "080CW444";
  return (ok[0] ?? "080CW444") as PaperTypeId;
}

interface BookStepProps {
  cookbookId: number;
  draft: BookDraft;
  pageCount: number;
  update: (change: Partial<BookDraft>) => void;
}

export function BookStep({ cookbookId, draft, pageCount, update }: BookStepProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const isPreset = SIZE_PRESETS.some((s) => s.id === draft.trimSize);
  const [otherSizes, setOtherSizes] = useState(!isPreset);

  const setBinding = (bindingType: BindingTypeId) =>
    update({ bindingType, paperType: paperFor(bindingType, draft.colorType, draft.paperType) });
  const setColor = (colorType: ColorTypeId) =>
    update({ colorType, paperType: paperFor(draft.bindingType, colorType, draft.paperType) });

  const papers = (BINDING_PAPER_COMPATIBILITY[draft.bindingType] || []).filter((p) => draft.colorType === "BW" || p !== "060UC444");
  const short = BINDING_PAGE_LIMITS.SS.max >= pageCount;

  return (
    <div className="space-y-8">
      <section aria-labelledby="format-heading" className="space-y-3">
        <h3 id="format-heading" className="text-lg font-semibold">Format</h3>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="list">
          {FORMATS.map((f) => (
            <li key={f.id}>
              <FormatCard
                cookbookId={cookbookId}
                format={f}
                selected={draft.bindingType === f.id}
                pageCount={pageCount}
                spec={{ ...draft, bindingType: f.id, paperType: paperFor(f.id, draft.colorType, draft.paperType) }}
                onSelect={() => setBinding(f.id)}
              />
            </li>
          ))}
        </ul>
        {short && (
          <button
            type="button"
            className={cn("text-sm underline-offset-4 hover:underline", draft.bindingType === "SS" ? "font-medium text-primary" : "text-muted-foreground")}
            onClick={() => setBinding("SS")}
            aria-pressed={draft.bindingType === "SS"}
          >
            {draft.bindingType === "SS" ? "✓ Stapled booklet chosen" : "Short book? A stapled booklet is the cheapest way to print it."}
          </button>
        )}
      </section>

      <section aria-labelledby="size-heading" className="space-y-3">
        <h3 id="size-heading" className="text-lg font-semibold">Size</h3>
        <ul className="grid grid-cols-3 gap-2 sm:gap-3" role="list">
          {SIZE_PRESETS.map((s) => {
            const on = draft.trimSize === s.id;
            const dims = BOOK_SIZES[s.id];
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => { update({ trimSize: s.id }); setOtherSizes(false); }}
                  className={cn(
                    "flex h-full w-full flex-col items-center gap-2 rounded-lg border p-3 text-center",
                    on ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent/50",
                  )}
                  data-testid={`size-${s.id}`}
                >
                  <span className="flex h-16 items-end" aria-hidden>
                    <span
                      className={cn("block rounded-sm border-2", on ? "border-primary bg-primary/15" : "border-muted-foreground/40 bg-muted")}
                      style={{ width: `${dims.width * 5.2}px`, height: `${dims.height * 5.2}px` }}
                    />
                  </span>
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs leading-snug text-muted-foreground">{s.blurb}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {otherSizes ? (
          <div className="space-y-1.5">
            <Label htmlFor="trim-size">Other sizes</Label>
            <select
              id="trim-size"
              value={draft.trimSize}
              onChange={(e) => update({ trimSize: e.target.value as TrimSizeId })}
              className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-base"
              data-testid="select-trim-size"
            >
              {Object.entries(BOOK_SIZES).map(([id, s]) => (
                <option key={id} value={id}>{`${s.width} × ${s.height} in (${s.name})`}</option>
              ))}
            </select>
          </div>
        ) : (
          <button type="button" className="text-sm text-muted-foreground underline-offset-4 hover:underline" onClick={() => setOtherSizes(true)}>
            More sizes, from pocket-size to A4
          </button>
        )}
      </section>

      <section className="rounded-lg border">
        <button
          type="button"
          className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((o) => !o)}
        >
          <span>
            <span className="block font-medium">Paper and color</span>
            <span className="block text-sm text-muted-foreground">
              {draft.colorType === "FC" ? "Full color" : "Black and white"} · {PAPERS[draft.paperType]?.name.toLowerCase()} · {draft.coverFinish === "G" ? "glossy" : "matte"} cover
            </span>
          </span>
          <ChevronDown className={cn("h-5 w-5 shrink-0 transition-transform", moreOpen && "rotate-180")} aria-hidden />
        </button>
        {moreOpen && (
          <div className="space-y-5 border-t p-4">
            <ChoiceRow
              label="Color"
              value={draft.colorType}
              onChange={(v) => setColor(v as ColorTypeId)}
              options={[
                { value: "FC", label: "Full color", hint: "Your photos in color" },
                { value: "BW", label: "Black and white", hint: "Costs less" },
              ]}
            />
            <ChoiceRow
              label="Paper"
              value={draft.paperType}
              onChange={(v) => update({ paperType: v as PaperTypeId })}
              options={papers.map((p) => ({ value: p, label: PAPERS[p as PaperTypeId].name, hint: PAPERS[p as PaperTypeId].blurb }))}
            />
            <ChoiceRow
              label="Cover"
              value={draft.coverFinish}
              onChange={(v) => update({ coverFinish: v as CoverFinishId })}
              options={[
                { value: "M", label: "Matte", hint: "Soft, no glare" },
                { value: "G", label: "Glossy", hint: "Shiny, colors pop" },
              ]}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function FormatCard({
  cookbookId,
  format,
  selected,
  pageCount,
  spec,
  onSelect,
}: {
  cookbookId: number;
  format: (typeof FORMATS)[number];
  selected: boolean;
  pageCount: number;
  spec: BookSpec;
  onSelect: () => void;
}) {
  const tooBig = bindingFit(format.id, pageCount);
  const estimate = usePrintEstimate(cookbookId, pageCount, spec, !tooBig);
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={!!tooBig}
      onClick={onSelect}
      className={cn(
        "relative flex h-full w-full items-center gap-4 rounded-lg border p-4 text-left sm:flex-col sm:items-start",
        selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent/50",
        tooBig && "cursor-not-allowed opacity-60 hover:bg-transparent",
      )}
      data-testid={`format-${format.id}`}
    >
      <BookIllustration kind={format.id} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-semibold">{format.name}</span>
          <span className="text-sm font-medium text-foreground">
            {tooBig ? "" : estimate.data ? `about ${formatPrice(estimate.data.totalCost, estimate.data.currency)}` : estimate.isLoading ? "…" : ""}
          </span>
        </span>
        <span className="mt-1 block text-sm text-muted-foreground">{tooBig ?? format.blurb}</span>
      </span>
      {selected && <span className="sr-only">Selected</span>}
    </button>
  );
}

/** A small drawing of each kind of book */
function BookIllustration({ kind }: { kind: BindingTypeId }) {
  const stroke = "currentColor";
  return (
    <svg viewBox="0 0 64 56" className="h-14 w-16 shrink-0 text-primary" aria-hidden>
      {kind === "CW" && (
        <>
          <rect x="14" y="6" width="38" height="46" rx="2" fill="hsl(var(--primary) / 0.18)" stroke={stroke} strokeWidth="2" />
          <rect x="10" y="6" width="6" height="46" rx="1.5" fill="hsl(var(--primary) / 0.45)" stroke={stroke} strokeWidth="2" />
          <path d="M22 18h22M22 24h16" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
        </>
      )}
      {kind === "PB" && (
        <>
          <path d="M14 8h34a2 2 0 0 1 2 2v40a2 2 0 0 1-2 2H14z" fill="hsl(var(--primary) / 0.12)" stroke={stroke} strokeWidth="2" />
          <path d="M14 8v44" stroke={stroke} strokeWidth="3" />
          <path d="M22 18h20M22 24h14" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
        </>
      )}
      {kind === "CO" && (
        <>
          <path d="M6 16l24 4v30L6 46z" fill="hsl(var(--primary) / 0.12)" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
          <path d="M58 16l-24 4v30l24-4z" fill="hsl(var(--primary) / 0.12)" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
          {[22, 28, 34, 40, 46].map((y) => (
            <circle key={y} cx="32" cy={y} r="2.4" fill="none" stroke={stroke} strokeWidth="1.6" />
          ))}
          <path d="M11 26l14 2M11 32l14 2M39 28l14-2M39 34l14-2" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
      {(kind === "SS" || kind === "LW") && <rect x="12" y="8" width="40" height="44" rx="2" fill="none" stroke={stroke} strokeWidth="2" />}
    </svg>
  );
}

function ChoiceRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; hint?: string }[];
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <Button
              key={o.value}
              type="button"
              variant="outline"
              aria-pressed={on}
              onClick={() => onChange(o.value)}
              className={cn("h-auto min-h-12 flex-col items-start justify-center gap-0.5 whitespace-normal py-2 text-left", on && "border-primary bg-primary/5 ring-1 ring-primary")}
            >
              <span className="font-medium">{o.label}</span>
              {o.hint && <span className="text-xs font-normal text-muted-foreground">{o.hint}</span>}
            </Button>
          );
        })}
      </div>
    </fieldset>
  );
}
