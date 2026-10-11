import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { ArrowLeftRight, CalendarCheck, ChefHat, ClipboardList, Copy, ExternalLink, Loader2, Printer, Share2, ShoppingCart, Utensils } from "lucide-react";
import type { ShoppingItem } from "@shared/meal-prep/contract";
import type { CheckinOutcome, PrepCheckin, PrepPlanView } from "@shared/meal-prep/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { cookPath, errorText, mealPrepApi, mealPrepKeys, SLOT_LABELS } from "@/lib/meal-prep-api";
import { describePlate, eatingDate, formatDay, formatMinutes, formatServings, plateKey, roughPlates, todayIso } from "@/lib/meal-prep-format";
import { cn } from "@/lib/utils";
import { photoOf, titleFor, useOwnerRecipes } from "./cook-data";
import { DishPhoto, PersonWeek, usePlanNames } from "./plan-bits";
import { publicUrl, isNativeApp, openExternal } from "@/lib/platform";

// After approval: what to buy (by aisle, with Instacart when it's set up),
// what to check in the pantry, what to do the day before, how to hand the
// cooking day to someone else (link or printed packet), any swaps the cook
// made, and afterwards how the meals went.

/** Checkbox state remembered on this device */
export function useLocalChecks(key: string): [Record<string, boolean>, (id: string, v: boolean) => void] {
  const [checks, setChecks] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; }
  });
  const set = useCallback((id: string, v: boolean) => {
    setChecks((prev) => {
      const next = { ...prev, [id]: v };
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* not remembered */ }
      return next;
    });
  }, [key]);
  return [checks, set];
}

function CheckRow({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <li>
      <label htmlFor={id} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-accent/50">
        <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5 h-6 w-6" />
        <span className={checked ? "text-muted-foreground line-through" : ""}>{children}</span>
      </label>
    </li>
  );
}

type Tab = "shop" | "before" | "plan" | "cook";

export function ApprovedView({ record, onRecord }: { record: PrepPlanView; onRecord: (r: PrepPlanView) => void }) {
  const [tab, setTab] = useState<Tab>(record.unseenSubstitutions > 0 ? "cook" : "shop");
  const { setup } = record;
  const session = record.session!;
  const finished = record.status === "done" || record.status === "cancelled";
  return (
    <div>
      <PageHeader
        title={`Cooking ${formatDay(setup.session.date)}`}
        back={{ href: "/meal-prep", label: "Meal prep" }}
        description={`${record.status === "cancelled" ? "Cancelled" : record.status === "done" ? "Done" : "Approved"} · about ${formatMinutes(session.totalMinutes)} in the kitchen · ${session.containers.count} containers`}
      />
      {record.unseenSubstitutions > 0 && <SwapsNotice record={record} onRecord={onRecord} />}
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="mb-6 grid h-auto w-full grid-cols-4 gap-1 p-1">
          {([
            ["shop", "Shopping", ShoppingCart],
            ["before", "Day before", CalendarCheck],
            ["plan", "The plan", Utensils],
            ["cook", "Cook & share", ChefHat],
          ] as const).map(([value, label, Icon]) => (
            <TabsTrigger key={value} value={value} className="min-h-11 flex-col gap-0.5 whitespace-normal px-1 text-sm sm:flex-row sm:gap-2 sm:text-base">
              <Icon className="h-5 w-5 shrink-0" aria-hidden />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="shop" className="mt-0"><ShoppingTab record={record} /></TabsContent>
        <TabsContent value="before" className="mt-0"><BeforeTab record={record} /></TabsContent>
        <TabsContent value="plan" className="mt-0"><PlanTab record={record} /></TabsContent>
        <TabsContent value="cook" className="mt-0"><CookShareTab record={record} finished={finished} /></TabsContent>
      </Tabs>
    </div>
  );
}

/** Swaps the cook made during the session, until the owner has seen them */
function SwapsNotice({ record, onRecord }: { record: PrepPlanView; onRecord: (r: PrepPlanView) => void }) {
  const seen = useMutation({ mutationFn: () => mealPrepApi.substitutionsSeen(record.id), onSuccess: onRecord });
  const fresh = record.substitutions.filter((s) => !s.seenAt);
  return (
    <section className="mb-6 space-y-2 rounded-lg border border-amber-400 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950 dark:text-amber-100" aria-labelledby="swaps-heading">
      <h2 id="swaps-heading" className="inline-flex items-center gap-2 text-lg font-semibold"><ArrowLeftRight className="h-5 w-5" aria-hidden /> Your cook swapped {fresh.length === 1 ? "an ingredient" : `${fresh.length} ingredients`}</h2>
      <ul className="list-disc space-y-1 pl-6 text-base">
        {fresh.map((s) => (
          <li key={s.id}>{s.note}{!s.nutritionUpdated && s.labelKeys.length > 0 ? " The numbers on those labels are rougher now." : ""}</li>
        ))}
      </ul>
      <Button variant="outline" onClick={() => seen.mutate()} disabled={seen.isPending}>Got it</Button>
    </section>
  );
}

function ItemText({ item }: { item: ShoppingItem }) {
  return (
    <span className="block">
      <span className="text-base font-medium">{item.ingredient.name}</span>
      <span className="text-base"> · {item.display}</span>
      {item.buy && <span className="block text-sm text-muted-foreground">Buy {item.buy}</span>}
      {item.forRecipes.length > 0 && <span className="block text-sm text-muted-foreground">For {item.forRecipes.join(", ")}</span>}
    </span>
  );
}

const INSTACART_OFF = "grammie-mp-instacart-off";

function ShoppingTab({ record }: { record: PrepPlanView }) {
  const { toast } = useToast();
  const [checks, setCheck] = useLocalChecks(`grammie-mp-shop-${record.id}`);
  // A 501 means Instacart isn't set up on the server; don't offer it again this visit
  const [instacartOff, setInstacartOff] = useState(() => {
    try { return sessionStorage.getItem(INSTACART_OFF) === "1"; } catch { return false; }
  });
  const instacart = useMutation({
    mutationFn: () => mealPrepApi.instacart(record.id),
    onSuccess: (res) => {
      if (!res) {
        setInstacartOff(true);
        try { sessionStorage.setItem(INSTACART_OFF, "1"); } catch { /* fine */ }
        toast({ title: "Instacart ordering isn't available yet", description: "Use the list below at the store." });
      }
    },
    onError: (err) => toast({ title: "Couldn't reach Instacart", description: errorText(err, "Try again in a moment, or shop from the list below."), variant: "destructive" }),
  });
  // Browsers block a new tab opened after waiting on the server, so in a
  // browser the tab opens on the tap and goes to Instacart once the link is
  // ready. The app opens Instacart in its own browser sheet instead.
  const orderOnInstacart = () => {
    const tab = isNativeApp() ? null : window.open("", "_blank");
    if (tab) tab.opener = null;
    instacart.mutate(undefined, {
      onSuccess: (res) => {
        if (!res) tab?.close();
        else if (tab) tab.location.href = res.url;
        else void openExternal(res.url);
      },
      onError: () => tab?.close(),
    });
  };
  const shopping = record.shopping;
  if (!shopping) return <p className="text-base">The shopping list isn't ready yet.</p>;
  const toBuy = shopping.byAisle.map((a) => ({ ...a, items: a.items.filter((i) => !i.have) })).filter((a) => a.items.length);
  const have = shopping.byAisle.flatMap((a) => a.items.filter((i) => i.have));
  const total = toBuy.reduce((n, a) => n + a.items.length, 0);
  const got = toBuy.reduce((n, a) => n + a.items.filter((i) => checks[i.ingredient.id]).length, 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base" aria-live="polite">
          {got} of {total} in the cart{shopping.estimatedCost != null && ` · about $${Math.round(shopping.estimatedCost)}`}
        </p>
        {!instacartOff && (
          <Button variant="outline" onClick={orderOnInstacart} disabled={instacart.isPending}>
            {instacart.isPending ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <ExternalLink aria-hidden />}
            Order on Instacart
          </Button>
        )}
      </div>
      {record.groceryListId && (
        <p className="text-base">
          It's also on your <Link href="/kitchen?tab=grocery" className="font-medium text-primary underline-offset-4 hover:underline">grocery list</Link>.
        </p>
      )}
      {toBuy.map((a) => (
        <section key={a.aisle} aria-labelledby={`aisle-${a.aisle}`}>
          <h3 id={`aisle-${a.aisle}`} className="mb-1 text-lg font-semibold">{a.aisle}</h3>
          <ul>
            {a.items.map((i) => (
              <CheckRow key={i.ingredient.id} id={`shop-${i.ingredient.id}`} checked={!!checks[i.ingredient.id]} onChange={(v) => setCheck(i.ingredient.id, v)}>
                <ItemText item={i} />
              </CheckRow>
            ))}
          </ul>
        </section>
      ))}
      {shopping.pantryCheck.length > 0 && (
        <section aria-labelledby="pantry-heading">
          <h3 id="pantry-heading" className="text-lg font-semibold">Check the pantry</h3>
          <p className="mb-1 text-sm text-muted-foreground">You probably have these. Tick them off, or add them to the list.</p>
          <ul>
            {shopping.pantryCheck.map((p, i) => (
              <CheckRow key={p} id={`pantry-${i}`} checked={!!checks[`pantry:${p}`]} onChange={(v) => setCheck(`pantry:${p}`, v)}>
                <span className="text-base">{p}</span>
              </CheckRow>
            ))}
          </ul>
        </section>
      )}
      {have.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="px-0 text-primary">Already in your pantry ({have.length})</Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="space-y-2 pt-2">
              {have.map((i) => <li key={i.ingredient.id} className="px-2"><ItemText item={i} /></li>)}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

function BeforeTab({ record }: { record: PrepPlanView }) {
  const [checks, setCheck] = useLocalChecks(`grammie-mp-before-${record.id}`);
  const session = record.session!;
  return (
    <div className="space-y-8">
      <section aria-labelledby="before-heading">
        <h3 id="before-heading" className="mb-1 text-lg font-semibold">Before the cooking day</h3>
        <ul>
          {session.beforeSession.map((t, i) => (
            <CheckRow key={t} id={`before-${i}`} checked={!!checks[t]} onChange={(v) => setCheck(t, v)}>
              <span className="text-base">{t}</span>
            </CheckRow>
          ))}
        </ul>
      </section>
      <section aria-labelledby="equip-heading">
        <h3 id="equip-heading" className="mb-2 text-lg font-semibold">Have these out</h3>
        <ul className="list-disc space-y-1 pl-6 text-base">
          {session.equipment.map((e) => <li key={e}>{e}</li>)}
          <li>{session.containers.count} containers{session.containers.bySize && ` (${Object.entries(session.containers.bySize).map(([s, n]) => `${n} × ${s}`).join(", ")})`}</li>
        </ul>
      </section>
      {session.safety.length > 0 && (
        <section aria-labelledby="safety-heading" className="rounded-lg border p-4">
          <h3 id="safety-heading" className="mb-2 text-lg font-semibold">Keeping food safe</h3>
          <ul className="list-disc space-y-1 pl-6 text-base">{session.safety.map((s) => <li key={s}>{s}</li>)}</ul>
        </section>
      )}
    </div>
  );
}

function PlanTab({ record }: { record: PrepPlanView }) {
  const names = usePlanNames(record.recipeTitles);
  const { setup } = record;
  const plan = record.plan!;
  const photos = useOwnerRecipes(plan.batches.map((b) => b.recipeId));
  const rough = useMemo(() => roughPlates(record.session?.labels), [record.session]);
  const [personId, setPersonId] = useState(setup.people[0]?.id);
  return (
    <div className="space-y-8">
      <ul className="grid gap-3 sm:grid-cols-2">
        {plan.batches.map((b) => (
          <li key={b.recipeId} className="flex items-center gap-3 rounded-lg border bg-card p-3">
            <DishPhoto src={photoOf(photos[b.recipeId])} className="h-14 w-14 shrink-0" />
            <span>
              <Link href={`/recipe/${b.recipeId}`} className="text-base font-semibold underline-offset-4 hover:underline">{titleFor(record.recipeTitles, b.recipeId)}</Link>
              <span className="block text-sm text-muted-foreground">Making {formatServings(b.servingsMade)}</span>
            </span>
          </li>
        ))}
      </ul>
      {setup.people.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Whose week to show">
          {setup.people.map((p) => (
            <Button key={p.id} variant={p.id === personId ? "secondary" : "outline"} aria-pressed={p.id === personId} onClick={() => setPersonId(p.id)}>{p.name}</Button>
          ))}
        </div>
      )}
      {personId && <PersonWeek setup={setup} plates={plan.plates} fit={plan.fit} personId={personId} names={names} rough={rough} />}
    </div>
  );
}

function CookShareTab({ record, finished }: { record: PrepPlanView; finished: boolean }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [link, setLink] = useState<string | null>(null);
  // A new link is made on request; the API can't show an old token again
  const share = useMutation({ mutationFn: () => mealPrepApi.share(record.id) });

  const ensureLink = async () => {
    if (link) return link;
    const res = await share.mutateAsync();
    const url = publicUrl(res.path || cookPath(res.token));
    setLink(url);
    return url;
  };

  const copy = async () => {
    try {
      const url = await ensureLink();
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: "Send it to your cook. They don't need an account." });
    } catch (err) {
      toast({ title: "Couldn't copy the link", description: link ? "Select the link below and copy it yourself." : errorText(err), variant: "destructive" });
    }
  };

  const sendLink = async () => {
    try {
      const url = await ensureLink();
      await navigator.share({ title: "Our meal prep day", text: "Here's the plan for the cooking day:", url });
    } catch { /* cancelled */ }
  };

  return (
    <div className="space-y-8">
      {!finished && (
        <section className="space-y-3 rounded-lg border bg-card p-4" aria-labelledby="cook-heading">
          <h3 id="cook-heading" className="text-lg font-semibold">Cooking it yourself?</h3>
          <p className="text-base text-muted-foreground">Step-by-step on this screen, with timers, what to do now and what's next.</p>
          <Button size="lg" className="w-full sm:w-auto" onClick={() => navigate(`/meal-prep/${record.id}/cook`)}>
            <ChefHat aria-hidden /> Start cooking
          </Button>
        </section>
      )}

      {!finished && (
        <section className="space-y-3 rounded-lg border bg-card p-4" aria-labelledby="share-heading">
          <h3 id="share-heading" className="text-lg font-semibold">Share with my cook</h3>
          <p className="text-base text-muted-foreground">
            Anyone with the link can see the shopping list, the cooking steps and these recipes, and tick things off. They can't see anything else. The link stops working a few days after the cooking day.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={copy} disabled={share.isPending}>
              {share.isPending ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Copy aria-hidden />} Copy link
            </Button>
            {typeof navigator !== "undefined" && "share" in navigator && (
              <Button variant="outline" onClick={sendLink} disabled={share.isPending}><Share2 aria-hidden /> Send…</Button>
            )}
          </div>
          {link && <p className="break-all rounded-md bg-secondary p-2 text-sm" aria-label="Share link">{link}</p>}
        </section>
      )}

      <section className="space-y-3 rounded-lg border bg-card p-4" aria-labelledby="print-heading">
        <h3 id="print-heading" className="text-lg font-semibold">Print the packet</h3>
        <p className="text-base text-muted-foreground">Overview, shopping list, the cooking timeline, each dish, the portion plan and container labels.</p>
        <Button variant="outline" asChild>
          <Link href={`/meal-prep/${record.id}/packet`}><Printer aria-hidden /> Open the packet</Link>
        </Button>
      </section>

      <CheckInCard record={record} />
    </div>
  );
}

const OUTCOMES: Array<[CheckinOutcome, string]> = [
  ["ate", "Ate it"],
  ["too_much", "Too much"],
  ["too_little", "Too little"],
  ["skipped", "Skipped"],
  ["threw_out", "Threw it out"],
];

/**
 * After eating: how each meal went, for the most recent day so far. Grammie
 * uses it to size portions and pick dishes next time.
 */
function CheckInCard({ record }: { record: PrepPlanView }) {
  const names = usePlanNames(record.recipeTitles);
  const { setup } = record;
  const today = todayIso();
  const lastDay = useMemo(() => {
    let d = -1;
    for (let i = 0; i < setup.days; i++) if (eatingDate(setup, i) <= today) d = i;
    return d;
  }, [setup, today]);
  const checkins = useQuery({
    queryKey: [...mealPrepKeys.plan(record.id), "checkins"],
    queryFn: () => mealPrepApi.listCheckIns(record.id),
    enabled: lastDay >= 0,
  });
  const send = useMutation({
    mutationFn: (c: { personId: string; day: number; slot: PrepCheckin["slot"]; outcome: CheckinOutcome }) => mealPrepApi.checkIn(record.id, c),
    onSuccess: (saved) =>
      queryClient.setQueryData<PrepCheckin[]>([...mealPrepKeys.plan(record.id), "checkins"], (old = []) => [
        ...old.filter((c) => !(c.personId === saved.personId && c.day === saved.day && c.slot === saved.slot)),
        saved,
      ]),
  });
  if (lastDay < 0 || !record.plan) return null;
  const plates = record.plan.plates.filter((p) => p.day === lastDay);
  const outcomeOf = (key: string) => checkins.data?.find((c) => plateKey(c) === key)?.outcome;
  const person = (id: string) => setup.people.find((p) => p.id === id)?.name ?? "";

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="checkin-heading">
      <h3 id="checkin-heading" className="inline-flex items-center gap-2 text-lg font-semibold"><ClipboardList className="h-5 w-5" aria-hidden /> How did {formatDay(eatingDate(setup, lastDay))} go?</h3>
      <p className="text-base text-muted-foreground">Grammie uses this to size portions and pick dishes next time. Skip anything you like.</p>
      <ul className="space-y-4">
        {plates.map((p) => {
          const key = plateKey(p);
          const current = outcomeOf(key);
          return (
            <li key={key} className="space-y-2">
              <p className="text-base"><span className="font-medium">{person(p.personId)} · {SLOT_LABELS[p.slot]}:</span> {describePlate(p, names)}</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label={`How was ${person(p.personId)}'s ${SLOT_LABELS[p.slot].toLowerCase()}?`}>
                {OUTCOMES.map(([v, label]) => (
                  <Button
                    key={v}
                    variant={current === v ? "secondary" : "outline"}
                    aria-pressed={current === v}
                    className={cn("min-h-11", current === v && "border-primary")}
                    disabled={send.isPending}
                    onClick={() => send.mutate({ personId: p.personId, day: p.day, slot: p.slot, outcome: v })}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      {send.isError && <p role="alert" className="text-base text-destructive">{errorText(send.error, "Couldn't save that. Try again.")}</p>}
    </section>
  );
}
