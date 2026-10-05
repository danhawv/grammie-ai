import { Bell } from "lucide-react";
import { Link } from "wouter";
import { useUploadProgress } from "@/contexts/UploadProgressContext";
import { cn } from "@/lib/utils";

// Where background imports report in (docs/DESIGN_PRINCIPLES.md §6.9): the
// badge counts recipes still being read plus those that need a look, and the
// button opens the progress list, which links to each review screen.

export function AlertsButton() {
  const { counts } = useUploadProgress();
  const total = counts.active + counts.needsReview + counts.failed;

  const parts: string[] = [];
  if (counts.active) parts.push(`${counts.active} being read`);
  if (counts.needsReview) parts.push(`${counts.needsReview} ${counts.needsReview === 1 ? "needs" : "need"} a look`);
  if (counts.failed) parts.push(`${counts.failed} couldn't be read`);
  const label = parts.length ? `Recipe imports: ${parts.join(", ")}` : "Recipe imports";

  return (
    <Link
      href="/processing"
      className="relative inline-flex size-11 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="button-alerts"
      aria-label={label}
      title={label}
    >
      <Bell className="h-5 w-5" aria-hidden />
      {total > 0 && (
        <span
          className={cn(
            "absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-semibold",
            counts.needsReview || counts.failed ? "bg-amber-600 text-white" : "bg-primary text-primary-foreground",
          )}
          data-testid="badge-alerts-count"
          aria-hidden
        >
          {total}
        </span>
      )}
    </Link>
  );
}
