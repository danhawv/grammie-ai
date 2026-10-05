import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

// The one page header (docs/DESIGN_PRINCIPLES.md §3): title, optional back
// link, at most one primary action, and a "…" menu for everything else.

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Where "back" goes, and what it's called ("Recipes") */
  back?: { href: string; label: string };
  /** The single primary (filled) action */
  primaryAction?: ReactNode;
  /** Secondary actions: outline buttons and/or a "…" DropdownMenu */
  secondaryActions?: ReactNode;
  /** Optional leading icon or image (e.g. cookbook cover) */
  leading?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, back, primaryAction, secondaryActions, leading, className }: PageHeaderProps) {
  return (
    <header className={cn("mb-6 space-y-3", className)}>
      {back && (
        <Link href={back.href} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {leading}
          <div className="min-w-0">
            <h1 className="font-serif text-3xl font-bold leading-tight break-words">{title}</h1>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
        </div>
        {(primaryAction || secondaryActions) && (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
            {secondaryActions}
            {primaryAction}
          </div>
        )}
      </div>
    </header>
  );
}
