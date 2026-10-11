import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/platform";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import type { CreditsSummary, CreditPackId, NeedCreditsError } from "@shared/credits";

// Server calls for credits (server/routes/credits.ts). Shapes and prices are
// in shared/credits.ts.

export const CREDITS_KEY = ["/api/credits"] as const;

async function json<T>(res: Response, fallback: string): Promise<T> {
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : fallback);
  return body as T;
}

export async function fetchCredits(): Promise<CreditsSummary> {
  return json(await apiFetch("/api/credits"), "Your credits didn't load.");
}

/** The signed-in person's credits; nothing for signed-out visitors */
export function useCredits() {
  const { user } = useAuth();
  return useQuery({
    queryKey: CREDITS_KEY,
    queryFn: fetchCredits,
    enabled: !!user,
    staleTime: 30_000,
    retry: 1,
  });
}

/** Call after any action that may have used or added credits */
export function refreshCredits() {
  void queryClient.invalidateQueries({ queryKey: CREDITS_KEY });
}

/** Opens Stripe's payment page for a pack (web) */
export async function startCheckout(pack: CreditPackId): Promise<string> {
  const res = await apiFetch("/api/credits/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pack }),
  });
  const { url } = await json<{ url: string }>(res, "We couldn't open the payment page. Nothing was charged.");
  return url;
}

/** After returning from Stripe: adds the credits if the webhook hasn't yet */
export async function confirmCheckout(sessionId: string): Promise<{ status: "paid" | "pending"; credits?: number | null; balance: number | null }> {
  const res = await apiFetch("/api/credits/checkout/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  return json(res, "We couldn't check that payment yet.");
}

/** True for the server's "needs credits" answers (402) and their messages */
export function isNeedCredits(errOrMessage: unknown): boolean {
  if (errOrMessage && typeof errOrMessage === "object" && (errOrMessage as NeedCreditsError).code === "needs_credits") return true;
  const text = errOrMessage instanceof Error ? errOrMessage.message : String(errOrMessage ?? "");
  return /needs_credits|\bAdd credits\b/.test(text);
}
