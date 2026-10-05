import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Every data screen has loading, empty and error states
// (docs/DESIGN_PRINCIPLES.md §7). Use these instead of ad-hoc versions.

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  /** One primary action */
  action?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center rounded-lg border border-dashed px-6 py-12 text-center", className)}>
      {Icon && <Icon className="mb-4 h-10 w-10 text-muted-foreground" aria-hidden />}
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>}
      {(action || secondaryAction) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description = "Check your connection and try again.",
  onRetry,
  className,
}: {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("flex flex-col items-center rounded-lg border px-6 py-12 text-center", className)}>
      <AlertCircle className="mb-4 h-10 w-10 text-destructive" aria-hidden />
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      {onRetry && (
        <Button className="mt-6" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Skeleton rows in the shape of the final content; text appears for slow loads */
export function LoadingState({
  label,
  variant = "list",
  rows = 4,
  className,
}: {
  label?: string;
  variant?: "list" | "cards" | "spinner";
  rows?: number;
  className?: string;
}) {
  if (variant === "spinner") {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground", className)} role="status">
        <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
        {label && <p className="text-sm">{label}</p>}
      </div>
    );
  }
  return (
    <div className={cn(variant === "cards" ? "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" : "space-y-3", className)} role="status" aria-label={label || "Loading"}>
      {Array.from({ length: rows }).map((_, i) =>
        variant === "cards" ? (
          <div key={i} className="space-y-3">
            <Skeleton className="aspect-[4/3] w-full rounded-lg" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ),
      )}
    </div>
  );
}
