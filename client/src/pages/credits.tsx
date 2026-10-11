import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Check, Coins, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-states";
import { useAuth } from "@/hooks/useAuth";
import { confirmCheckout, refreshCredits, startCheckout, useCredits } from "@/lib/credits-api";
import { buyCreditsInApp, COMING_SOON, inAppPurchasesReady } from "@/lib/purchases";
import { isNativeApp } from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
  CREDIT_ACTION_LABELS, formatCredits, formatPrice,
  type CreditAction, type CreditPack, type CreditsSummary,
} from "@shared/credits";

// Credits: the balance, what things cost, packs to buy and recent history.
// Web buys through Stripe's payment page (that page is the review step and
// shows the price before anything is charged); the app buys through the App
// Store (client/src/lib/purchases.ts).

type Notice = { tone: "good" | "info" | "bad"; text: string } | null;

export default function Credits() {
  const { user, isLoading: authLoading } = useAuth();
  const { data, isLoading, isError, refetch } = useCredits();
  const notice = useReturnFromCheckout();
  const [buyNotice, setBuyNotice] = useState<Notice>(null);
  const shown = buyNotice ?? notice;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-6 md:py-10">
        <PageHeader
          title="Credits"
          back={{ href: "/settings", label: "Me" }}
          description="Grammie's AI helpers use credits. Credits never expire."
        />

        {shown && (
          <p
            role={shown.tone === "bad" ? "alert" : "status"}
            className={cn(
              "mb-6 rounded-md border p-3 text-base",
              shown.tone === "good" && "border-green-700/30 bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100",
              shown.tone === "info" && "border-border bg-muted",
              shown.tone === "bad" && "border-destructive/50 bg-destructive/5 text-destructive",
            )}
          >
            {shown.text}
          </p>
        )}

        {!user && !authLoading ? (
          <EmptyState
            icon={Coins}
            title="Sign in to see your credits"
            description="Every account starts with free credits for adding recipes, dish photos and meal-prep plans."
            action={<Button asChild><Link href="/login">Sign in</Link></Button>}
          />
        ) : isLoading || authLoading ? (
          <LoadingState label="Loading your credits" rows={4} />
        ) : isError || !data ? (
          <ErrorState title="Your credits didn't load" onRetry={() => void refetch()} />
        ) : (
          <div className="space-y-8">
            <Balance data={data} />
            <Packs data={data} onNotice={setBuyNotice} />
            <Costs data={data} />
            <History data={data} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Back from Stripe: ?status=success&session_id=... or ?status=canceled */
function useReturnFromCheckout(): Notice {
  const search = useSearch();
  const [, navigate] = useLocation();
  const [notice, setNotice] = useState<Notice>(null);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    const params = new URLSearchParams(search);
    const status = params.get("status");
    const sessionId = params.get("session_id");
    if (!status) return;
    handled.current = true;
    navigate("/credits", { replace: true });
    if (status === "canceled") {
      setNotice({ tone: "info", text: "No payment was made. You can choose a pack whenever you like." });
      return;
    }
    if (status === "success" && sessionId) {
      setNotice({ tone: "info", text: "Adding your credits…" });
      void (async () => {
        // The payment can take a moment to settle; ask a few times
        for (let i = 0; i < 4; i++) {
          try {
            const r = await confirmCheckout(sessionId);
            if (r.status === "paid") {
              setNotice({ tone: "good", text: r.credits ? `Thank you! ${formatCredits(r.credits)} were added.` : "Thank you! Your credits were added." });
              refreshCredits();
              return;
            }
          } catch {
            /* try again */
          }
          await new Promise((res) => setTimeout(res, 2000));
        }
        setNotice({ tone: "info", text: "Thank you! Your payment is being confirmed. Your credits will appear here in a minute or two." });
        refreshCredits();
      })();
    }
  }, [search, navigate]);

  return notice;
}

function Balance({ data }: { data: CreditsSummary }) {
  return (
    <Card>
      <CardContent className="p-4 md:p-6">
        <p className="text-sm text-muted-foreground">Your balance</p>
        <p className="mt-1 font-serif text-4xl font-bold" data-testid="text-credit-balance">
          {data.unlimited ? "Unlimited" : formatCredits(Math.max(0, data.balance))}
        </p>
        <p className="mt-3 text-base">
          {data.unlimited
            ? "Admin accounts aren't charged."
            : `Every account gets ${formatCredits(data.welcomeCredits)} to start, plus ${formatCredits(data.monthlyFreeCredits)} free each month you use Grammie.`}
        </p>
        {!data.enforced && !data.unlimited && (
          <p className="mt-2 text-sm text-muted-foreground">For now, everything keeps working even when your balance reaches zero.</p>
        )}
      </CardContent>
    </Card>
  );
}

function Packs({ data, onNotice }: { data: CreditsSummary; onNotice: (n: Notice) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const native = isNativeApp();
  const canBuy = native ? inAppPurchasesReady() && data.purchase.apple : data.purchase.web;

  async function buy(pack: CreditPack) {
    if (busy) return;
    setBusy(pack.id);
    onNotice(null);
    try {
      if (native) {
        const r = await buyCreditsInApp(pack);
        if (r.status === "added") {
          onNotice({ tone: "good", text: `Thank you! ${formatCredits(r.credits)} were added.` });
          refreshCredits();
        } else if (r.status !== "cancelled") {
          onNotice({ tone: r.status === "error" ? "bad" : "info", text: r.message });
        }
      } else {
        // Stripe's page shows the price and the Pay button; nothing is charged until then
        window.location.assign(await startCheckout(pack.id));
        return; // leaving the page
      }
    } catch (err) {
      onNotice({ tone: "bad", text: err instanceof Error ? err.message : "We couldn't open the payment page. Nothing was charged." });
    }
    setBusy(null);
  }

  return (
    <section aria-labelledby="packs-heading">
      <h2 id="packs-heading" className="text-xl font-semibold">Add credits</h2>
      {!canBuy && (
        <p className="mt-1 text-base text-muted-foreground">{native ? COMING_SOON : "Buying credits opens soon."}</p>
      )}
      <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {data.packs.map((pack) => (
          <li key={pack.id}>
            <Card className="h-full">
              <CardContent className="flex h-full flex-col gap-3 p-4">
                <div>
                  <h3 className="text-lg font-semibold">{pack.name}</h3>
                  <p className="text-base">
                    {formatCredits(pack.credits)}
                    <span className="text-muted-foreground"> · about {Math.round(pack.priceCents / pack.credits)}¢ each</span>
                  </p>
                </div>
                <Button
                  className="mt-auto h-12 w-full text-base"
                  variant="outline"
                  disabled={!canBuy || !!busy}
                  onClick={() => void buy(pack)}
                  data-testid={`button-buy-${pack.id}`}
                >
                  {busy === pack.id ? <><Loader2 className="motion-safe:animate-spin" aria-hidden /> Opening…</> : `Buy · ${formatPrice(pack.priceCents)}`}
                </Button>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      {!native && canBuy && (
        <p className="mt-3 text-sm text-muted-foreground">You'll see the total on the secure payment page before you pay.</p>
      )}
    </section>
  );
}

function Costs({ data }: { data: CreditsSummary }) {
  const actions = Object.keys(data.costs) as CreditAction[];
  return (
    <section aria-labelledby="costs-heading">
      <h2 id="costs-heading" className="text-xl font-semibold">What things cost</h2>
      <Card className="mt-3">
        <CardContent className="p-4 md:p-6">
          <ul className="divide-y">
            {actions.map((a) => (
              <li key={a} className="flex items-center justify-between gap-4 py-3 text-base first:pt-0">
                <span>{CREDIT_ACTION_LABELS[a]}</span>
                <span className="shrink-0 font-medium">{formatCredits(data.costs[a])}</span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-4 py-3 text-base last:pb-0">
              <span>Talking with Grammie, re-planning, swaps and small helpers</span>
              <span className="flex shrink-0 items-center gap-1 font-medium"><Check className="h-4 w-4" aria-hidden /> Free</span>
            </li>
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">
            The dish photo that comes with a new recipe is included. If something doesn't work, its credits come back.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

function History({ data }: { data: CreditsSummary }) {
  return (
    <section aria-labelledby="history-heading">
      <h2 id="history-heading" className="text-xl font-semibold">Recent activity</h2>
      {data.history.length === 0 ? (
        <p className="mt-3 text-base text-muted-foreground">Nothing yet. When you add a recipe, it shows up here.</p>
      ) : (
        <Card className="mt-3">
          <CardContent className="p-4 md:p-6">
            <ul className="divide-y">
              {data.history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-base">{h.label}</p>
                    <p className="text-sm text-muted-foreground">{new Date(h.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p>
                  </div>
                  <span className={cn("shrink-0 text-base font-medium tabular-nums", h.delta > 0 && "text-green-800 dark:text-green-300")}>
                    {h.delta > 0 ? `+${h.delta}` : h.delta === 0 ? "Free" : h.delta}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
