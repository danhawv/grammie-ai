import { Link } from "wouter";
import { Coins } from "lucide-react";
import { useCredits, isNeedCredits } from "@/lib/credits-api";
import { cn } from "@/lib/utils";
import { CREDIT_COSTS, LOW_BALANCE, formatCredits, type CreditAction } from "@shared/credits";

// Small credit pieces shared by the header, the Me page and AI buttons.
// Calm by design: the balance is a quiet link, costs show only while credits
// are enforced, and "Running low" appears once, near the balance.

/** "53 credits" link to /credits, for the header and the Me page */
export function CreditsPill({ className }: { className?: string }) {
  const { data } = useCredits();
  if (!data || data.unlimited) return null;
  const low = data.enforced && data.balance <= LOW_BALANCE;
  return (
    <Link
      href="/credits"
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors hover:bg-accent",
        low ? "text-primary" : "text-muted-foreground hover:text-foreground",
        className,
      )}
      aria-label={`${formatCredits(data.balance)}${low ? ", running low" : ""}. See credits`}
      data-testid="link-credits"
    >
      <Coins className="h-4 w-4" aria-hidden />
      {formatCredits(Math.max(0, data.balance))}
    </Link>
  );
}

/** " · 1 credit" after an AI action's label, only while credits are enforced */
export function CreditNote({ action, count = 1, className }: { action: CreditAction; count?: number; className?: string }) {
  const { data } = useCredits();
  if (!data?.enforced || data.unlimited || count < 1) return null;
  return <span className={cn("font-normal opacity-90", className)}> · {formatCredits(CREDIT_COSTS[action] * count)}</span>;
}

/** The one "Running low" notice, at LOW_BALANCE credits or fewer (on the Credits page and where AI actions start) */
export function LowCreditsNotice({ className }: { className?: string }) {
  const { data } = useCredits();
  // Only while enforced: before that, a low balance changes nothing
  if (!data?.enforced || data.unlimited || data.balance > LOW_BALANCE) return null;
  return (
    <p className={cn("rounded-md border border-primary/30 bg-primary/5 p-3 text-base", className)} data-testid="notice-low-credits">
      Running low: {formatCredits(Math.max(0, data.balance))} left.{" "}
      <Link href="/credits" className="font-medium text-primary underline underline-offset-4">Add credits</Link>
    </p>
  );
}

/** An "Add credits" link to show next to an error that was about credits */
export function AddCreditsLink({ error, className }: { error: unknown; className?: string }) {
  if (!error || !isNeedCredits(error)) return null;
  return (
    <Link href="/credits" className={cn("inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4", className)}>
      Add credits
    </Link>
  );
}
