import { AlertCircle, ArrowLeft, ArrowRight, Check, Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AutosaveState } from "@shared/autosave";
import { STEPS, type StepId } from "./types";

// The print builder's step list (top) and its bottom bar: Back, Preview, the
// live price and Next. On phones the app's tab bar is hidden on this page, so
// the bar sits at the very bottom.

export function StepList({ current, onSelect }: { current: StepId; onSelect: (s: StepId) => void }) {
  const index = STEPS.findIndex((s) => s.id === current);
  return (
    <nav aria-label="Steps" className="mb-6">
      <ol className="grid grid-cols-4 gap-1 md:gap-2">
        {STEPS.map((s, i) => {
          const active = s.id === current;
          const done = i < index;
          return (
            <li key={s.id} className="relative">
              {i > 0 && <span className={cn("absolute right-1/2 top-[1.15rem] -z-10 h-px w-full md:hidden", i <= index ? "bg-primary" : "bg-border")} aria-hidden />}
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={active ? "step" : undefined}
                aria-label={`Step ${i + 1}: ${s.title}`}
                className={cn(
                  "flex min-h-11 w-full flex-col items-center gap-1 rounded-md px-1 py-1 text-center md:flex-row md:gap-2 md:px-3 md:text-left",
                  active ? "text-primary md:bg-primary/10" : "text-muted-foreground hover:text-foreground md:hover:bg-accent/50",
                )}
                data-testid={`step-${s.id}`}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-background text-sm font-semibold",
                    active && "border-primary bg-primary text-primary-foreground",
                    done && "border-primary text-primary",
                  )}
                  aria-hidden
                >
                  {done ? <Check className="h-4 w-4" /> : i + 1}
                </span>
                <span className={cn("text-xs font-medium md:text-sm", active && "font-semibold")}>{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function SaveStatus({ state, onRetry }: { state: AutosaveState; onRetry: () => void }) {
  // Nothing to say until there's a change, so the header doesn't keep an empty row
  if (state === "idle") return null;
  return (
    <span aria-live="polite" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground" data-testid="save-status">
      {state === "pending" || state === "saving" ? (
        <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Saving…</>
      ) : state === "saved" ? (
        <><Check className="h-4 w-4" aria-hidden /> Saved</>
      ) : state === "error" ? (
        <>
          <AlertCircle className="h-4 w-4 text-destructive" aria-hidden />
          <span className="text-destructive">Not saved.</span>
          <Button variant="ghost" className="px-2" onClick={onRetry}>Try again</Button>
        </>
      ) : null}
    </span>
  );
}

export function StepBar({
  current,
  onSelect,
  onPreview,
  previewDisabled,
  price,
}: {
  current: StepId;
  onSelect: (s: StepId) => void;
  onPreview: () => void;
  previewDisabled?: boolean;
  /** "about $23 · 244 pages", or null while it's worked out */
  price?: { amount: string | null; pages: number; loading?: boolean };
}) {
  const i = STEPS.findIndex((s) => s.id === current);
  const prev = STEPS[i - 1];
  const next = STEPS[i + 1];
  return (
    <div
      className="sticky bottom-0 z-30 -mx-4 mt-8 border-t bg-background/95 px-4 pt-3 backdrop-blur md:-mx-6 md:px-6 md:pb-3"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
    >
      <div className="flex items-center gap-2">
        {prev && (
          <Button variant="outline" size="icon" className="shrink-0 sm:w-auto sm:px-4" onClick={() => onSelect(prev.id)} aria-label={`Back to ${prev.title}`}>
            <ArrowLeft aria-hidden /> <span className="hidden sm:inline">Back</span>
          </Button>
        )}
        <Button variant="outline" size="icon" className="shrink-0 sm:w-auto sm:px-4" onClick={onPreview} disabled={previewDisabled} aria-label="Preview the book" data-testid="button-preview">
          <Eye aria-hidden /> <span className="hidden sm:inline">Preview</span>
        </Button>
        {price && (
          <div className="min-w-0 flex-1 px-1 leading-tight" aria-live="polite" data-testid="live-price">
            <p className="truncate text-base font-semibold">
              {price.amount ? `About ${price.amount}` : price.loading ? <span className="text-muted-foreground">Pricing…</span> : <span className="text-muted-foreground">Price at checkout</span>}
            </p>
            <p className="truncate text-xs text-muted-foreground">{price.pages} pages<span className="hidden sm:inline"> · with shipping</span></p>
          </div>
        )}
        {!price && <span className="flex-1" />}
        {next && (
          <Button className="shrink-0" onClick={() => onSelect(next.id)} data-testid="button-next-step">
            {next.id === "order" ? "Review" : next.label}
            <ArrowRight aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}
