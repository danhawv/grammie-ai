import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ArrowLeft, ArrowLeftRight, Check, CheckCircle2, ChevronDown, Eye, LayoutList, Loader2, Printer, Sun, SunDim, Timer } from "lucide-react";
import type { ScheduledTask } from "@shared/meal-prep/contract";
import type { TaskProgress } from "@shared/meal-prep/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorState, LoadingState } from "@/components/page-states";
import { TimerChips } from "@/components/cooking-mode";
import { StorageBadge } from "@/components/meal-prep/plan-bits";
import { CookSwapBox, IngredientsWithSwaps } from "@/components/meal-prep/plan-changes";
import { useLocalChecks } from "@/components/meal-prep/approved-view";
import { fromCookView, fromPlanView, knownTitles, type CookData, type CookSource } from "@/components/meal-prep/cook-data";
import { useCookingTimers, useKeepAwakePreference, useWakeLock } from "@/hooks/use-cooking-session";
import { useToast } from "@/hooks/use-toast";
import { cookPath, errorText, mealPrepApi, mealPrepKeys } from "@/lib/meal-prep-api";
import {
  eatByText,
  focusTasks,
  formatMinutes,
  labelSlotText,
  LANE_LABELS,
  quarterFraction,
  sessionClock,
  tasksByLane,
} from "@/lib/meal-prep-format";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

// The cooking day, for the owner (/meal-prep/:id/cook) or a hired cook
// (/prep/cook/:token, no login). Three parts: get ready (mise en place
// first), cook (Now / Next, or the full timeline in lanes), pack (each
// container with its label). Ticks sync to the server so two cooks and the
// owner see the same progress; they're also kept on this device so a dropped
// connection loses nothing.

type Part = "ready" | "cook" | "pack";

export function useCookSource(): CookSource {
  const params = useParams<{ id?: string; token?: string }>();
  return params.token ? { kind: "cook", token: params.token } : { kind: "owner", id: params.id! };
}

export function useCookData(source: CookSource, opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: source.kind === "cook" ? mealPrepKeys.cook(source.token) : mealPrepKeys.plan(source.id),
    queryFn: () => (source.kind === "cook" ? mealPrepApi.getCook(source.token) : mealPrepApi.getPlan(source.id)),
    select: (d: any): CookData | null => (source.kind === "cook" ? fromCookView(d) : fromPlanView(d)),
    refetchInterval: opts.poll ? 20_000 : false, // a second cook's ticks show up
    staleTime: opts.poll ? 0 : 5 * 60_000,
  });
}

const sourceKey = (s: CookSource) => (s.kind === "cook" ? `cook-${s.token}` : `plan-${s.id}`);

/** Ticks made on this device that the server may not have yet */
function useProgress(source: CookSource, server: Record<string, TaskProgress> | undefined) {
  const key = `grammie-mp-progress-${sourceKey(source)}`;
  const [local, setLocal] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(local)); } catch { /* not remembered */ }
  }, [key, local]);

  const send = useCallback((taskId: string, done: boolean) =>
    source.kind === "cook" ? mealPrepApi.setCookProgress(source.token, taskId, done) : mealPrepApi.setOwnerProgress(source.id, taskId, done),
  [source]);

  // Re-send anything the server hasn't recorded (e.g. made while offline), then let the server lead
  useEffect(() => {
    if (!server) return;
    const pending = Object.entries(local).filter(([taskId, done]) => !!server[taskId] !== done);
    if (pending.length === 0 && Object.keys(local).length) { setLocal({}); return; }
    for (const [taskId, done] of pending) send(taskId, done).catch(() => {});
  }, [server]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const id of Object.keys(server ?? {})) out[id] = true;
    return { ...out, ...local };
  }, [server, local]);

  const set = useCallback((taskId: string, value: boolean) => {
    setLocal((l) => ({ ...l, [taskId]: value }));
    send(taskId, value).then(
      () => queryClient.invalidateQueries({ queryKey: source.kind === "cook" ? mealPrepKeys.cook(source.token) : mealPrepKeys.plan(source.id) }),
      () => { /* kept locally and re-sent on the next refresh */ },
    );
  }, [send, source]);
  return { done, set };
}

export default function MealPrepCookPage() {
  const source = useCookSource();
  const query = useCookData(source, { poll: true });
  const data = query.data;
  const { done, set } = useProgress(source, data?.progress);
  const [part, setPart] = useState<Part>("ready");
  const [keepAwake, setKeepAwake] = useKeepAwakePreference();
  const wakeStatus = useWakeLock(keepAwake && !!data);
  const timers = useCookingTimers(`meal-prep-${sourceKey(source)}`);

  useEffect(() => { document.title = "Cooking day · Grammie"; }, []);

  if (query.isLoading) return <div className="mx-auto max-w-3xl px-4 py-6"><LoadingState label="Opening the cooking day" rows={5} /></div>;
  if (query.isError || !data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <ErrorState
          title="Couldn't open the cooking day"
          description={query.isError ? errorText(query.error, "Check the link, or your connection, and try again.") : "This plan doesn't have a cooking day yet."}
          onRetry={() => query.refetch()}
        />
      </div>
    );
  }

  const tasks = data.session.tasks;
  const doneCount = tasks.filter((t) => done[t.id]).length;
  const packetHref = source.kind === "cook" ? `${cookPath(source.token)}/packet` : `/meal-prep/${source.id}/packet`;

  const goToTask = (index: number) => {
    setPart("cook");
    requestAnimationFrame(() => document.getElementById(`task-${tasks[index]?.id}`)?.scrollIntoView({ block: "center" }));
  };

  return (
    <div className="min-h-screen supports-[height:100dvh]:min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="mx-auto max-w-5xl space-y-2 px-4 py-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {source.kind === "owner" && (
              <Button variant="ghost" size="icon" asChild>
                <Link href={`/meal-prep/${source.id}`} aria-label="Back to the plan"><ArrowLeft aria-hidden /></Link>
              </Button>
            )}
            <h1 className="mr-auto font-serif text-2xl font-bold">Cooking day</h1>
            <p className="text-base font-medium" aria-live="polite">{doneCount} of {tasks.length} steps done</p>
            {wakeStatus === "unsupported" ? (
              <p className="flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground"><SunDim className="h-4 w-4" aria-hidden /> This browser can't keep the screen on</p>
            ) : (
              <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                {keepAwake ? <Sun className="h-4 w-4 text-primary" aria-hidden /> : <SunDim className="h-4 w-4" aria-hidden />}
                {!keepAwake ? "Screen may turn off" : wakeStatus === "blocked" ? "Couldn't keep the screen on" : "Screen stays on"}
                <Switch checked={keepAwake} onCheckedChange={setKeepAwake} aria-label="Keep the screen on" />
              </label>
            )}
          </div>
          <nav aria-label="Parts of the day" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
            {([["ready", "1 · Get ready"], ["cook", "2 · Cook"], ["pack", "3 · Pack"]] as const).map(([p, label]) => (
              <button
                key={p}
                type="button"
                aria-current={part === p ? "step" : undefined}
                onClick={() => setPart(p)}
                className={cn(
                  "min-h-12 rounded-md text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  part === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </nav>
          <TimerChips timers={timers} onGoToStep={goToTask} />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 pb-16">
        {part === "ready" && <ReadyPart data={data} storageKey={sourceKey(source)} onStart={() => setPart("cook")} />}
        {part === "cook" && <CookPart data={data} source={source} done={done} setDone={set} timers={timers} />}
        {part === "pack" && <PackPart data={data} storageKey={sourceKey(source)} packetHref={packetHref} />}
      </main>
    </div>
  );
}

// ---------- 1. Get ready ----------

function ReadyPart({ data, storageKey, onStart }: { data: CookData; storageKey: string; onStart: () => void }) {
  const [checks, setCheck] = useLocalChecks(`grammie-mp-mise-${storageKey}`);
  const { session } = data;
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <p className="text-lg">
        About {formatMinutes(session.totalMinutes)} in all, {formatMinutes(session.handsOnMinutes)} of it hands-on.
        Do all the chopping and measuring first; the cooking goes smoothly after that.
      </p>
      {data.householdAllergies.length > 0 && (
        <p className="rounded-lg border-2 border-amber-500 p-4 text-lg" role="note">
          <span className="font-semibold">Allergies in this house:</span> {data.householdAllergies.join(", ")}. Check labels on anything store-bought, and ask before swapping in something new.
        </p>
      )}
      {data.substitutions.length > 0 && (
        <section aria-labelledby="subs-heading" className="rounded-lg border p-4">
          <h2 id="subs-heading" className="mb-1 text-xl font-semibold">Swaps already made</h2>
          <ul className="list-disc space-y-1 pl-6 text-lg">{data.substitutions.map((s) => <li key={s.id}>{s.note}</li>)}</ul>
        </section>
      )}
      <section aria-labelledby="mise-heading">
        <h2 id="mise-heading" className="mb-2 text-2xl font-semibold">Chop and measure first</h2>
        <ul className="space-y-1">
          {session.misePlace.map((m, i) => (
            <li key={i}>
              <label htmlFor={`mise-${i}`} className="flex min-h-14 cursor-pointer items-start gap-4 rounded-md px-2 py-2 hover:bg-accent/50">
                <Checkbox id={`mise-${i}`} checked={!!checks[i]} onCheckedChange={(v) => setCheck(String(i), v === true)} className="mt-1 h-7 w-7" />
                <span className={cn("text-xl", checks[i] && "text-muted-foreground line-through")}>
                  {m.text}
                  {knownTitles(data.titles, m.recipeIds).length > 0 && <span className="block text-base text-muted-foreground">For {knownTitles(data.titles, m.recipeIds).join(", ")}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="equip-heading">
        <h2 id="equip-heading" className="mb-2 text-2xl font-semibold">Get these out</h2>
        <ul className="list-disc space-y-1 pl-6 text-xl">
          {session.equipment.map((e) => <li key={e}>{e}</li>)}
          <li>{session.containers.count} containers</li>
        </ul>
      </section>
      {data.dishes.some((d) => d.swaps?.length) && (
        <section aria-labelledby="cook-swaps-heading" className="space-y-2">
          <h2 id="cook-swaps-heading" className="text-2xl font-semibold">Recipe swaps today</h2>
          <p className="text-base text-muted-foreground">The family chose these on purpose. The shopping list already has what you need.</p>
          {data.dishes.filter((d) => d.swaps?.length).map((d) => (
            <div key={d.id} className="space-y-1">
              <h3 className="text-lg font-semibold">{d.title}</h3>
              <CookSwapBox swaps={d.swaps} scale={d.scale} />
            </div>
          ))}
        </section>
      )}
      {data.dishes.some((d) => d.ingredients?.length) && (
        <section aria-labelledby="recipes-heading" className="space-y-2">
          <h2 id="recipes-heading" className="text-2xl font-semibold">The recipes</h2>
          {data.dishes.map((d) => (
            <Collapsible key={d.id} className="rounded-lg border">
              <CollapsibleTrigger asChild>
                <button type="button" className="flex min-h-14 w-full items-center justify-between gap-2 px-4 text-left text-lg font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span>{d.title}{d.swaps?.length ? <span className="block text-base font-normal text-emerald-800 dark:text-emerald-300">With {d.swaps.length === 1 ? "a swap" : `${d.swaps.length} swaps`}</span> : null}{d.scale !== 1 && <span className="block text-base font-normal text-muted-foreground">Make {quarterFraction(d.scale)}× the recipe</span>}</span>
                  <ChevronDown className="h-5 w-5 shrink-0" aria-hidden />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 border-t p-4 text-lg">
                {d.scale !== 1 && <p className="font-medium">These are the amounts for one batch. Multiply each by {quarterFraction(d.scale)}.</p>}
                <CookSwapBox swaps={d.swaps} scale={d.scale} />
                <IngredientsWithSwaps ingredients={d.ingredients ?? []} swaps={d.swaps} scale={d.scale} />
                <ol className="list-decimal space-y-2 pl-6">{d.instructions?.map((x, i) => <li key={i}>{x}</li>)}</ol>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </section>
      )}
      {session.safety.length > 0 && (
        <section aria-labelledby="safety-heading" className="rounded-lg border p-4">
          <h2 id="safety-heading" className="mb-2 text-xl font-semibold">Keeping food safe</h2>
          <ul className="list-disc space-y-1 pl-6 text-lg">{session.safety.map((s) => <li key={s}>{s}</li>)}</ul>
        </section>
      )}
      <Button size="lg" className="min-h-14 w-full text-lg" onClick={onStart}>Start cooking</Button>
    </div>
  );
}

// ---------- 2. Cook ----------

function CookPart({
  data,
  source,
  done,
  setDone,
  timers,
}: {
  data: CookData;
  source: CookSource;
  done: Record<string, boolean>;
  setDone: (id: string, v: boolean) => void;
  timers: ReturnType<typeof useCookingTimers>;
}) {
  const [mode, setMode] = useState<"focus" | "timeline">("focus");
  const [swapOpen, setSwapOpen] = useState(false);
  const tasks = data.session.tasks;
  const { now, next } = focusTasks(tasks, done, { cooks: data.cooks });
  const nowRef = useRef<HTMLHeadingElement>(null);
  const allDone = tasks.every((t) => done[t.id]);
  const startTimer = (t: ScheduledTask) =>
    timers.start({ label: t.text.length > 28 ? `${t.text.slice(0, 26)}…` : t.text, seconds: t.timerSec!, stepIndex: tasks.indexOf(t) });

  const finish = (t: ScheduledTask) => {
    setDone(t.id, true);
    // Keep focus on the new "Now" for keyboard and screen-reader users
    requestAnimationFrame(() => nowRef.current?.focus());
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border p-1" role="group" aria-label="How to show the steps">
          <Button variant={mode === "focus" ? "secondary" : "ghost"} aria-pressed={mode === "focus"} onClick={() => setMode("focus")}><Eye aria-hidden /> Now &amp; next</Button>
          <Button variant={mode === "timeline" ? "secondary" : "ghost"} aria-pressed={mode === "timeline"} onClick={() => setMode("timeline")}><LayoutList aria-hidden /> Whole timeline</Button>
        </div>
        {/* Only the cook link can record a swap (the API has no owner swap) */}
        {source.kind === "cook" && (
          <Button variant="outline" className="ml-auto" onClick={() => setSwapOpen(true)}>
            <ArrowLeftRight aria-hidden /> Out of something?
          </Button>
        )}
      </div>

      {mode === "focus" ? (
        <div className="mx-auto max-w-2xl space-y-8">
          <section aria-labelledby="now-heading">
            <h2 id="now-heading" ref={nowRef} tabIndex={-1} className="mb-3 text-sm font-semibold uppercase tracking-wide text-primary focus:outline-none">Now</h2>
            {allDone ? (
              <div className="rounded-xl border-2 border-green-600 p-6 text-center">
                <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-green-700" aria-hidden />
                <p className="text-2xl font-semibold">All done — well cooked!</p>
                <p className="mt-1 text-lg text-muted-foreground">Head to Pack to fill and label the containers.</p>
              </div>
            ) : (
              <ul className="space-y-4">
                {now.map((t) => (
                  <li key={t.id} id={`task-${t.id}`} className="rounded-xl border-2 border-primary bg-card p-5">
                    <TaskMeta task={t} titles={data.titles} cooks={data.cooks} />
                    <p className="mt-2 text-2xl font-semibold leading-snug">{t.text}</p>
                    {t.doneCue && <p className="mt-2 text-lg"><span className="font-medium">It's ready when:</span> {t.doneCue}</p>}
                    <div className="mt-4 flex flex-wrap gap-3">
                      {t.timerSec ? (
                        <Button variant="outline" size="lg" className="min-h-12" onClick={() => startTimer(t)}>
                          <Timer aria-hidden /> Start {formatMinutes(t.timerSec / 60)} timer
                        </Button>
                      ) : null}
                      <Button size="lg" className="min-h-12 flex-1" onClick={() => finish(t)}>
                        <Check aria-hidden /> Done
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {next.length > 0 && (
            <section aria-labelledby="next-heading">
              <h2 id="next-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Next</h2>
              <ul className="space-y-2">
                {next.map((t) => (
                  <li key={t.id} className="rounded-lg border p-4">
                    <TaskMeta task={t} titles={data.titles} cooks={data.cooks} />
                    <p className="mt-1 text-xl">{t.text}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : (
        <Timeline tasks={tasks} done={done} setDone={setDone} />
      )}

      {source.kind === "cook" && <SubstitutionDialog open={swapOpen} onOpenChange={setSwapOpen} data={data} token={source.token} />}
    </div>
  );
}

function TaskMeta({ task, titles, cooks }: { task: ScheduledTask; titles: Record<string, string>; cooks: number }) {
  const dishes = knownTitles(titles, task.recipeIds);
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base text-muted-foreground">
      <span className="rounded-md bg-secondary px-2 py-0.5 text-sm font-medium text-secondary-foreground">{LANE_LABELS[task.lane]}</span>
      <span>at {sessionClock(task.start)}</span>
      {task.passiveMin > 0 && <span>· {formatMinutes(task.activeMin)} hands-on, then {formatMinutes(task.passiveMin)} on its own</span>}
      {cooks > 1 && <span>· Cook {task.cook}</span>}
      {dishes.length > 0 && <span className="basis-full">{dishes.join(", ")}</span>}
    </p>
  );
}

/** Every step: by time on phones, in lanes side by side on wider screens */
function Timeline({ tasks, done, setDone }: { tasks: ScheduledTask[]; done: Record<string, boolean>; setDone: (id: string, v: boolean) => void }) {
  const lanes = tasksByLane(tasks);
  const row = (t: ScheduledTask, showLane: boolean, prefix: string) => (
    <li key={t.id} id={prefix === "m" ? `task-${t.id}` : undefined}>
      <label htmlFor={`tl-${prefix}-${t.id}`} className={cn("flex min-h-14 cursor-pointer items-start gap-3 rounded-md border bg-card p-3", done[t.id] && "opacity-60")}>
        <Checkbox id={`tl-${prefix}-${t.id}`} checked={!!done[t.id]} onCheckedChange={(v) => setDone(t.id, v === true)} className="mt-1 h-6 w-6" />
        <span className="min-w-0">
          <span className="block text-sm text-muted-foreground tabular-nums">
            {sessionClock(t.start)}–{sessionClock(t.end)}{showLane && ` · ${LANE_LABELS[t.lane]}`}
          </span>
          <span className={cn("block text-lg", done[t.id] && "line-through")}>{t.text}</span>
        </span>
      </label>
    </li>
  );
  return (
    <>
      <ol className="space-y-2 md:hidden">{[...tasks].sort((a, b) => a.start - b.start).map((t) => row(t, true, "m"))}</ol>
      <div className="hidden gap-3 md:grid" style={{ gridTemplateColumns: `repeat(${lanes.length}, minmax(0, 1fr))` }}>
        {lanes.map((l) => (
          <section key={l.lane} aria-labelledby={`lane-${l.lane}`}>
            <h3 id={`lane-${l.lane}`} className="mb-2 text-lg font-semibold">{LANE_LABELS[l.lane]}</h3>
            <ol className="space-y-2">{l.tasks.map((t) => row(t, false, "d"))}</ol>
          </section>
        ))}
      </div>
    </>
  );
}

function SubstitutionDialog({ open, onOpenChange, data, token }: { open: boolean; onOpenChange: (o: boolean) => void; data: CookData; token: string }) {
  const items = data.shopping?.byAisle.flatMap((a) => a.items) ?? [];
  const [ingredientId, setIngredientId] = useState("");
  const [replacement, setReplacement] = useState("");
  const item = items.find((i) => i.ingredient.id === ingredientId);
  const { toast } = useToast();
  const sub = useMutation({
    mutationFn: () => mealPrepApi.substitute(token, item!.ingredient.name, replacement.trim()),
    onSuccess: (res) => queryClient.setQueryData(mealPrepKeys.cook(token), res.view),
    onError: (err) => toast({ title: "Couldn't save the swap", description: errorText(err, "Go ahead with it; tell the family later."), variant: "destructive" }),
  });
  useEffect(() => { if (open) { sub.reset(); setReplacement(""); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const allergyHit = data.householdAllergies.find((a) => replacement.toLowerCase().includes(a));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Out of an ingredient?</DialogTitle>
          <DialogDescription className="text-base">Tell Grammie what you're using instead. The family sees it, and the container labels are updated.</DialogDescription>
        </DialogHeader>
        {sub.data ? (
          <div className="space-y-4">
            <p className="text-lg">{sub.data.substitution.note}</p>
            <Button className="w-full" onClick={() => onOpenChange(false)}>Back to cooking</Button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (item && replacement.trim()) sub.mutate(); }}>
            <div className="space-y-1">
              <Label htmlFor="sub-ingredient" className="text-base">Which one ran out?</Label>
              <select
                id="sub-ingredient"
                className="h-11 w-full rounded-md border bg-background px-3 text-base"
                value={ingredientId}
                onChange={(e) => { setIngredientId(e.target.value); setReplacement(""); }}
              >
                <option value="">Choose…</option>
                {items.map((i) => <option key={i.ingredient.id} value={i.ingredient.id}>{i.ingredient.name}</option>)}
              </select>
            </div>
            {item && item.substitutes.length > 0 && (
              <div className="space-y-2">
                <p className="text-base">These usually work:</p>
                <div className="flex flex-wrap gap-2">
                  {item.substitutes.map((s) => (
                    <Button key={s} type="button" variant={replacement === s ? "secondary" : "outline"} aria-pressed={replacement === s} onClick={() => setReplacement(s)}>{s}</Button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="sub-replacement" className="text-base">Using instead</Label>
              <Input id="sub-replacement" className="h-11 text-base" value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="e.g. black beans" maxLength={80} />
            </div>
            {allergyHit && <p role="alert" className="text-base font-medium text-destructive">Someone in this house is allergic to {allergyHit}. Please pick something else.</p>}
            <Button type="submit" className="w-full" disabled={!item || !replacement.trim() || sub.isPending || !!allergyHit}>
              {sub.isPending && <Loader2 className="motion-safe:animate-spin" aria-hidden />} Use this instead
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- 3. Pack ----------

function PackPart({ data, storageKey, packetHref }: { data: CookData; storageKey: string; packetHref: string }) {
  const [packed, setPacked] = useLocalChecks(`grammie-mp-pack-${storageKey}`);
  const labels = data.session.labels;
  const people = Array.from(new Set(labels.map((l) => l.person)));
  const count = labels.filter((l) => packed[l.plateKey]).length;
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-2">
        <p className="text-lg">Let everything cool before you close the lids. Fill one container at a time and stick its label on.</p>
        <p className="text-base font-medium" aria-live="polite">{count} of {labels.length} packed</p>
        <Button variant="outline" asChild>
          <Link href={`${packetHref}#labels`}><Printer aria-hidden /> Print the labels</Link>
        </Button>
      </div>
      {people.map((person) => (
        <section key={person} aria-labelledby={`pack-${person}`}>
          <h2 id={`pack-${person}`} className="mb-2 text-2xl font-semibold">{person}</h2>
          <ul className="space-y-2">
            {labels.filter((l) => l.person === person).map((l) => (
              <li key={l.plateKey}>
                <label htmlFor={`pack-${l.plateKey}`} className={cn("flex min-h-14 cursor-pointer items-start gap-4 rounded-lg border bg-card p-4", packed[l.plateKey] && "opacity-60")}>
                  <Checkbox id={`pack-${l.plateKey}`} checked={!!packed[l.plateKey]} onCheckedChange={(v) => setPacked(l.plateKey, v === true)} className="mt-1 h-7 w-7" />
                  <span className="min-w-0 space-y-1">
                    <span className="block text-base text-muted-foreground">{labelSlotText(l, data.setup ?? undefined)}</span>
                    <span className="block text-xl font-semibold">{l.portion}</span>
                    {l.swapNotes?.map((n) => <span key={n} className="block text-base text-emerald-800 dark:text-emerald-300">{n}</span>)}
                    <span className="flex flex-wrap items-center gap-2 text-base">
                      <StorageBadge storage={l.storage} />
                      {eatByText(l.eatBy, l.madeOn)}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
