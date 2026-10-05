import type { ReactNode } from "react";
import { Link } from "wouter";
import { AlertCircle, CheckCircle2, Clock, Eye, ImageIcon, Loader2, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { countJobs, jobBreakdown, jobPercent, type JobState } from "@/lib/job-summary";

export type { JobState } from "@/lib/job-summary";

// The one progress UI for background work (docs/DESIGN_PRINCIPLES.md §4, §6.9):
// a status for each item, "3 of 12" overall, a plain-words reason and Retry
// for each failure. Used for recipe imports; reuse it for PDFs and placement.

export interface JobItem {
  id: string;
  title: string;
  state: JobState;
  /** Overrides the default status words, e.g. "Reading…" */
  statusText?: string;
  /** Why it failed, in words the person can act on */
  error?: string;
  thumbnail?: string | null;
  /** Where the main action goes ("Check it", "Open") */
  href?: string;
  actionLabel?: string;
  onRetry?: () => void;
  retrying?: boolean;
  onDismiss?: () => void;
  dismissLabel?: string;
}

const DEFAULT_TEXT: Record<JobState, string> = {
  queued: "Waiting…",
  working: "Working…",
  needs_review: "Needs a look",
  done: "Done",
  failed: "Couldn't finish",
};

function StateIcon({ state }: { state: JobState }) {
  switch (state) {
    case "queued":
      return <Clock className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />;
    case "working":
      return <Loader2 className="h-5 w-5 shrink-0 text-primary motion-safe:animate-spin" aria-hidden />;
    case "needs_review":
      return <Eye className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />;
    case "done":
      return <CheckCircle2 className="h-5 w-5 shrink-0 text-green-700 dark:text-green-400" aria-hidden />;
    case "failed":
      return <AlertCircle className="h-5 w-5 shrink-0 text-destructive" aria-hidden />;
  }
}

export function JobStatusRow({ item }: { item: JobItem }) {
  const status = item.statusText ?? DEFAULT_TEXT[item.state];
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 sm:flex-nowrap",
        item.state === "needs_review" && "border-amber-500/60",
        item.state === "failed" && "border-destructive/50",
      )}
      data-testid={`job-${item.id}`}
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {item.thumbnail ? (
          <img src={item.thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="h-5 w-5 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{item.title}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-sm" role="status">
          <StateIcon state={item.state} />
          <span>{status}</span>
        </p>
        {item.state === "failed" && item.error && <p className="mt-1 text-sm text-destructive">{item.error}</p>}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {item.state === "failed" && item.onRetry && (
          <Button variant="outline" onClick={item.onRetry} disabled={item.retrying}>
            <RotateCw className={cn(item.retrying && "motion-safe:animate-spin")} aria-hidden /> Retry
          </Button>
        )}
        {item.href && item.state !== "working" && item.state !== "queued" && (
          <Button asChild variant={item.state === "needs_review" ? "default" : "outline"}>
            <Link href={item.href}>{item.actionLabel ?? (item.state === "needs_review" ? "Check it" : "Open")}</Link>
          </Button>
        )}
        {item.onDismiss && (
          <Button
            variant="ghost"
            size="icon"
            onClick={item.onDismiss}
            aria-label={item.dismissLabel ?? `Remove ${item.title} from this list`}
            title={item.dismissLabel ?? "Remove from list"}
          >
            <X aria-hidden />
          </Button>
        )}
      </div>
    </li>
  );
}

interface JobStatusProps {
  items: JobItem[];
  /** "3 of 12 read" — how to say finished/total */
  progressLabel?: (finished: number, total: number) => string;
  /** Word for failures in the summary, e.g. "couldn't be read" */
  failedLabel?: string;
  /** Hide the overall line for a single item */
  showOverall?: boolean;
  /** Extra actions beside the overall line (e.g. "Clear finished") */
  actions?: ReactNode;
  className?: string;
}

export function JobStatus({
  items,
  progressLabel = (f, t) => `${f} of ${t} done`,
  failedLabel,
  showOverall = items.length > 1,
  actions,
  className,
}: JobStatusProps) {
  const counts = countJobs(items);
  const breakdown = jobBreakdown(counts, failedLabel);

  return (
    <section className={cn("space-y-4", className)} aria-label="Progress">
      {showOverall && (
        <div className="space-y-2 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-lg font-semibold" aria-live="polite">
              {progressLabel(counts.finished, counts.total)}
            </p>
            {actions}
          </div>
          <Progress
            value={jobPercent(counts)}
            className="h-2"
            aria-label={progressLabel(counts.finished, counts.total)}
          />
          {breakdown.length > 0 && <p className="text-sm">{breakdown.join(" · ")}</p>}
        </div>
      )}
      <ul className="space-y-3">
        {items.map((item) => (
          <JobStatusRow key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}
