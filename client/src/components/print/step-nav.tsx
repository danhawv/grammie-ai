import { AlertCircle, ArrowLeft, ArrowRight, Check, Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AutosaveState } from "@shared/autosave";
import { STEPS, type StepId } from "./types";

// The print builder's step list (top) and its Back / Preview / Next bar
// (bottom; sits above the phone tab bar so nothing is covered).

export function StepList({ current, onSelect }: { current: StepId; onSelect: (s: StepId) => void }) {
  const index = STEPS.findIndex((s) => s.id === current);
  return (
    <nav aria-label="Steps" className="mb-6">
      {/* Phone: where you are, plus a tappable step for each */}
      <p className="mb-2 text-sm text-muted-foreground md:hidden">
        Step {index + 1} of {STEPS.length}
      </p>
      <ol className="grid grid-cols-5 gap-1 md:gap-2">
        {STEPS.map((s, i) => {
          const active = s.id === current;
          const done = i < index;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={active ? "step" : undefined}
                aria-label={`Step ${i + 1}: ${s.title}`}
                className={cn(
                  "flex min-h-11 w-full flex-col items-center gap-1 rounded-md px-1 py-1 text-center md:flex-row md:gap-2 md:px-3 md:text-left",
                  active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
                data-testid={`step-${s.id}`}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
                    active && "border-primary bg-primary text-primary-foreground",
                    done && "border-primary text-primary",
                  )}
                  aria-hidden
                >
                  {done ? <Check className="h-4 w-4" /> : i + 1}
                </span>
                <span className={cn("text-sm font-medium", !active && "hidden md:inline")}>{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function SaveStatus({ state, onRetry }: { state: AutosaveState; onRetry: () => void }) {
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
}: {
  current: StepId;
  onSelect: (s: StepId) => void;
  onPreview: () => void;
  previewDisabled?: boolean;
}) {
  const i = STEPS.findIndex((s) => s.id === current);
  const prev = STEPS[i - 1];
  const next = STEPS[i + 1];
  return (
    <div
      className="sticky z-30 -mx-4 mt-8 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6"
      style={{ bottom: "var(--print-bar-bottom)" }}
    >
      <div className="flex items-center gap-2">
        {prev ? (
          <Button variant="outline" onClick={() => onSelect(prev.id)} aria-label={`Back to ${prev.title}`}>
            <ArrowLeft aria-hidden /> <span className="hidden sm:inline">Back</span>
          </Button>
        ) : (
          <span />
        )}
        <Button variant="outline" onClick={onPreview} disabled={previewDisabled} data-testid="button-preview">
          <Eye aria-hidden /> Preview
        </Button>
        {next && (
          <Button className="ml-auto" onClick={() => onSelect(next.id)} data-testid="button-next-step">
            {next.id === "review" ? "Check the book" : next.id === "order" ? "Order" : <>Next<span className="sr-only sm:not-sr-only">: {next.label}</span></>}
            <ArrowRight aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}
