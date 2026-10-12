import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Ban, CheckCircle2, Loader2, MoreHorizontal, Pin, PinOff, Repeat, SlidersHorizontal, Sparkles } from "lucide-react";
import type { PrepPlanView } from "@shared/meal-prep/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ToastAction } from "@/components/ui/toast";
import { ErrorState, LoadingState } from "@/components/page-states";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { errorText, mealPrepApi, type ApproveOptions, type PlanPatch } from "@/lib/meal-prep-api";
import { fitChangeText, formatDay, formatMinutes, formatServings, prepAimText, quarterFraction, roughPlates } from "@/lib/meal-prep-format";
import { cn } from "@/lib/utils";
import { photoOf, titleFor, useOwnerRecipes } from "./cook-data";
import { DishPhoto, PersonWeek, usePlanNames } from "./plan-bits";
import { SetupStepSheet } from "./setup-sheet";
import { ChangesSection, DishSwaps, OptionCards } from "./plan-changes";

// Plan review: the dishes, each person's week, how well each day fits, and
// the controls to change it (swap, always include, leave out, adjust the
// setup, undo the wishes) before approving. Expects a plan that's built.

export function PlanReview({ record, onRecord }: { record: PrepPlanView; onRecord: (r: PrepPlanView) => void }) {
  const { toast } = useToast();
  const names = usePlanNames(record.recipeTitles, { adjusters: record.adjusters, plan: record.plan });
  const { setup } = record;
  const plan = record.plan!;
  const session = record.session!;
  const photos = useOwnerRecipes(plan.batches.map((b) => b.recipeId));
  const rough = useMemo(() => roughPlates(session.labels), [session.labels]);
  const [personId, setPersonId] = useState(setup.people[0]?.id);
  const [swapFor, setSwapFor] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);

  const replan = useMutation({
    mutationFn: (patch: PlanPatch) => mealPrepApi.updatePlan(record.id, patch),
    onSuccess: onRecord,
    onError: (err) => toast({ title: "Couldn't update the plan", description: errorText(err, "Nothing changed. Check your connection and try again."), variant: "destructive" }),
  });

  const pickOption = useMutation({
    mutationFn: (key: NonNullable<PrepPlanView["options"]>[number]["key"]) => mealPrepApi.chooseOption(record.id, key),
    onSuccess: (r) => { onRecord(r); toast({ title: "Switched plans", description: "The shopping list and cooking day are updated." }); },
    onError: (err) => toast({ title: "Couldn't switch plans", description: errorText(err, "Nothing changed. Try again."), variant: "destructive" }),
  });
  const busy = replan.isPending || pickOption.isPending;
  const keepAsWritten = (key: string) =>
    replan.mutate({ keepAsWritten: [key] }, {
      onSuccess: () =>
        toast({
          title: `${title(key.split(":")[0])} stays as written`,
          description: "Grammie re-planned the week without that swap.",
          duration: 10_000,
          action: <ToastAction altText="Undo" onClick={() => replan.mutate({ allowSwapsAgain: [key] })}>Undo</ToastAction>,
        }),
    });
  const swapsFor = (id: string) => (plan.swapsApplied ?? []).filter((s) => s.recipeId === id);

  const pinned = new Set(setup.pinnedRecipeIds ?? []);
  const title = (id: string) => titleFor(record.recipeTitles, id);
  const togglePin = (id: string) => {
    const was = pinned.has(id);
    replan.mutate(was ? { unpin: [id] } : { pin: [id] }, {
      onSuccess: () => toast({ title: was ? "No longer always included" : `${title(id)} will stay in the plan` }),
    });
  };
  const exclude = (id: string) =>
    replan.mutate({ exclude: [id] }, {
      onSuccess: () =>
        toast({
          title: `Left out ${title(id)}`,
          description: "Grammie re-planned the week without it.",
          duration: 10_000,
          action: <ToastAction altText="Undo" onClick={() => replan.mutate({ unexclude: [id] })}>Undo</ToastAction>,
        }),
    });

  const person = setup.people.find((p) => p.id === personId) ?? setup.people[0];
  const wishes = record.wishes;
  const wishTitles = (ids: string[]) => ids.map(title).join(", ");

  return (
    <div className="pb-32">
      <PageHeader
        title="Your meal prep plan"
        back={{ href: "/meal-prep", label: "Meal prep" }}
        description={`Cooking ${formatDay(setup.session.date)} · about ${formatMinutes(session.totalMinutes)} in the kitchen · ${setup.days} ${setup.days === 1 ? "day" : "days"} of food`}
      />

      {busy && (
        <div role="status" className="mb-4 flex items-center gap-2 rounded-md bg-secondary p-3 text-base">
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden /> {pickOption.isPending ? "Switching plans…" : "Re-planning the week…"}
        </div>
      )}

      <OptionCards options={record.options ?? []} onPick={(k) => pickOption.mutate(k)} pendingKey={pickOption.isPending ? pickOption.variables : null} disabled={busy} />

      {record.explanation && (
        <section className={cn("mb-6 rounded-lg border p-4", record.explanationByAI && "border-primary/30 bg-primary/5")} aria-label="About this plan">
          {record.explanationByAI && (
            <p className="mb-1 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
              <Sparkles className="h-4 w-4" aria-hidden /> Suggested by Grammie
            </p>
          )}
          <p className="text-base leading-relaxed">{record.explanation}</p>
        </section>
      )}

      <ChangesSection
        changes={record.changes ?? { swaps: [], topUps: [] }}
        keptAsWritten={setup.excludedSwaps ?? []}
        titleOf={title}
        onAllowAgain={(key) => replan.mutate({ allowSwapsAgain: [key] })}
        disabled={busy}
      />

      {wishes && wishes.source === "ai" && (wishes.more.length > 0 || wishes.less.length > 0 || wishes.excludedRecipeIds.length > 0) && (
        <section className="mb-6 space-y-2 rounded-lg border p-4" aria-labelledby="wishes-heading">
          <h2 id="wishes-heading" className="inline-flex items-center gap-1.5 text-base font-semibold">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden /> What Grammie took from “{wishes.wishes}”
          </h2>
          <ul className="space-y-1 text-base">
            {wishes.more.length > 0 && <li>Leaning toward: {wishTitles(wishes.more)}</li>}
            {wishes.less.length > 0 && <li>Leaning away from: {wishTitles(wishes.less)}</li>}
            {wishes.excludedRecipeIds.length > 0 && <li>Left out: {wishTitles(wishes.excludedRecipeIds)}</li>}
          </ul>
          <Button variant="outline" onClick={() => replan.mutate({ clearWishes: true })} disabled={busy}>
            Plan without my wishes
          </Button>
        </section>
      )}

      {(plan.relaxed.length > 0 || session.warnings.length > 0) && (
        <ul className="mb-6 space-y-1 rounded-md border border-amber-400 bg-amber-50 p-3 text-base text-amber-950 dark:bg-amber-950 dark:text-amber-100">
          {[...plan.relaxed, ...session.warnings].map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      <section aria-labelledby="dishes-heading" className="mb-8 space-y-3">
        <h2 id="dishes-heading" className="text-xl font-semibold">The dishes</h2>
        <ul className="space-y-3">
          {plan.batches.map((b) => {
            const name = title(b.recipeId);
            return (
              <li key={b.recipeId} className="flex flex-wrap gap-3 rounded-lg border bg-card p-3">
                {/* Opens the full recipe; its back link returns to this plan */}
                <Link href={`/recipe/${b.recipeId}?from=${encodeURIComponent(`/meal-prep/${record.id}`)}`} className="shrink-0 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label={`Open the recipe for ${name}`}>
                  <DishPhoto src={photoOf(photos[b.recipeId])} className="h-20 w-20" />
                </Link>
                <div className="min-w-0 flex-1 basis-48">
                  <h3 className="text-lg font-semibold leading-snug">
                    <Link href={`/recipe/${b.recipeId}?from=${encodeURIComponent(`/meal-prep/${record.id}`)}`} className="underline-offset-4 hover:underline" data-testid={`link-dish-${b.recipeId}`}>
                      {name}
                    </Link>
                  </h3>
                  <p className="mt-1 text-base">
                    Making {formatServings(b.servingsMade)}
                    {b.scale !== 1 && ` (${quarterFraction(b.scale)}× the recipe)`}
                  </p>
                  {pinned.has(b.recipeId) && (
                    <p className="inline-flex items-center gap-1 text-sm text-primary"><Pin className="h-3.5 w-3.5" aria-hidden /> Always included</p>
                  )}
                  <DishSwaps swaps={swapsFor(b.recipeId)} onKeep={keepAsWritten} disabled={busy} />
                </div>
                {/* Actions sit under the text on phones, beside it when there's room */}
                <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:flex-col sm:items-end sm:justify-start">
                  <Button variant="outline" onClick={() => setSwapFor(b.recipeId)} disabled={busy} aria-label={`Swap ${name}`}>
                    <Repeat aria-hidden /> Swap
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`More for ${name}`} disabled={busy}>
                        <MoreHorizontal aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem className="min-h-11 text-base" onClick={() => togglePin(b.recipeId)}>
                        {pinned.has(b.recipeId) ? <PinOff className="mr-2 h-4 w-4" aria-hidden /> : <Pin className="mr-2 h-4 w-4" aria-hidden />}
                        {pinned.has(b.recipeId) ? "Stop always including" : "Always include"}
                      </DropdownMenuItem>
                      <DropdownMenuItem className="min-h-11 text-base" onClick={() => exclude(b.recipeId)}>
                        <Ban className="mr-2 h-4 w-4" aria-hidden /> Leave out this week
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="week-heading" className="space-y-3">
        <h2 id="week-heading" className="text-xl font-semibold">The week</h2>
        {setup.people.length > 1 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Whose week to show">
            {setup.people.map((p) => (
              <Button key={p.id} variant={p.id === person?.id ? "secondary" : "outline"} aria-pressed={p.id === person?.id} onClick={() => setPersonId(p.id)}>
                {p.name}
              </Button>
            ))}
          </div>
        )}
        {person && (
          <>
            <p className="text-base text-muted-foreground">
              {person.targets ? prepAimText(person, { you: setup.people.length === 1, dessertsPerWeek: setup.dessertsPerWeek }) : "Normal portions, no targets."}
            </p>
            <PersonWeek setup={setup} plates={plan.plates} fit={plan.fit} personId={person.id} names={names} rough={rough} />
          </>
        )}
      </section>

      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-30 border-t bg-background/95 backdrop-blur md:bottom-0">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          <Button variant="outline" onClick={() => setAdjustOpen(true)} disabled={busy}>
            <SlidersHorizontal aria-hidden /> Adjust
          </Button>
          <Button size="lg" className="ml-auto min-w-0 flex-1 sm:flex-none" onClick={() => setApproveOpen(true)} disabled={busy} data-testid="button-approve-plan">
            <CheckCircle2 aria-hidden /> Approve plan
          </Button>
        </div>
      </div>

      <SwapDialog record={record} recipeId={swapFor} onClose={() => setSwapFor(null)} onChosen={(r) => { onRecord(r); setSwapFor(null); }} />
      <ApproveDialog record={record} open={approveOpen} onOpenChange={setApproveOpen} onApproved={onRecord} />
      <SetupStepSheet
        setup={setup}
        stepId={adjustOpen ? "list" : null}
        onClose={() => setAdjustOpen(false)}
        listDescription="Change an answer and Grammie re-plans the week. Your recipes stay as they are."
        saveLabel="Re-plan"
        onSave={(s) => { setAdjustOpen(false); replan.mutate({ setup: s }); }}
      />
    </div>
  );
}

/** The review before approving: what approval also does, with the choice to skip it */
function ApproveDialog({ record, open, onOpenChange, onApproved }: { record: PrepPlanView; open: boolean; onOpenChange: (o: boolean) => void; onApproved: (r: PrepPlanView) => void }) {
  const [opts, setOpts] = useState<ApproveOptions>({ addToCalendar: true, addToGroceryList: true, groceryMode: "add_to_existing" });
  const approve = useMutation({ mutationFn: () => mealPrepApi.approve(record.id, opts), onSuccess: (r) => { onOpenChange(false); onApproved(r); } });
  const items = record.shopping?.byAisle.reduce((n, a) => n + a.items.filter((i) => !i.have).length, 0) ?? 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Approve this plan?</DialogTitle>
          <DialogDescription className="text-base">You can still print, share and cook it afterwards. To change dishes after approving, start a new plan.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-accent/50">
            <Checkbox checked={opts.addToCalendar} onCheckedChange={(v) => setOpts({ ...opts, addToCalendar: v === true })} className="mt-0.5 h-6 w-6" />
            <span className="text-base">Add the meals to my meal plan calendar</span>
          </label>
          <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-accent/50">
            <Checkbox checked={opts.addToGroceryList} onCheckedChange={(v) => setOpts({ ...opts, addToGroceryList: v === true })} className="mt-0.5 h-6 w-6" />
            <span className="text-base">Add the {items} things to buy to my grocery list</span>
          </label>
          {opts.addToGroceryList && (
            <label className="ml-11 flex min-h-11 cursor-pointer items-center gap-3">
              <Checkbox checked={opts.groceryMode === "create_new"} onCheckedChange={(v) => setOpts({ ...opts, groceryMode: v === true ? "create_new" : "add_to_existing" })} className="h-5 w-5" />
              <span className="text-sm">Start a fresh list instead of adding to my current one</span>
            </label>
          )}
        </div>
        {approve.isError && <p role="alert" className="text-base text-destructive">{errorText(approve.error, "Couldn't approve the plan. Check your connection and try again.")}</p>}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Not yet</Button>
          <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
            {approve.isPending ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <CheckCircle2 aria-hidden />} Approve plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SwapDialog({
  record,
  recipeId,
  onClose,
  onChosen,
}: {
  record: PrepPlanView;
  recipeId: string | null;
  onClose: () => void;
  onChosen: (r: PrepPlanView) => void;
}) {
  const options = useMutation({ mutationFn: (id: string) => mealPrepApi.swapOptions(record.id, id) });
  const choose = useMutation({ mutationFn: (replacementId: string) => mealPrepApi.chooseSwap(record.id, replacementId), onSuccess: onChosen });
  const photos = useOwnerRecipes(options.data?.options.map((o) => o.recipeId) ?? []);

  // Ask for alternatives each time the dialog opens for a dish
  useEffect(() => {
    if (!recipeId) return;
    options.reset();
    choose.reset();
    options.mutate(recipeId);
  }, [recipeId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={!!recipeId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Swap {recipeId ? titleFor(record.recipeTitles, recipeId) : ""}</DialogTitle>
          <DialogDescription className="text-base">Other dishes from your recipes that keep everyone's week close to their goals. Best fit first.</DialogDescription>
        </DialogHeader>
        {options.isPending ? (
          <LoadingState label="Finding dishes that fit" rows={3} />
        ) : options.isError ? (
          <ErrorState title="Couldn't find other dishes" description={errorText(options.error)} onRetry={() => options.mutate(recipeId!)} />
        ) : options.data && options.data.options.length === 0 ? (
          <p className="py-6 text-base">No other dishes fit right now. Try leaving this one out instead, or add more recipes.</p>
        ) : (
          <ul className="space-y-2">
            {options.data?.options.map((o) => {
              const worse = o.fitScoreChange < -2;
              return (
                <li key={o.recipeId}>
                  <button
                    type="button"
                    disabled={choose.isPending}
                    onClick={() => choose.mutate(o.recipeId)}
                    className="flex min-h-16 w-full items-center gap-3 rounded-lg border p-3 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  >
                    <DishPhoto src={photoOf(photos[o.recipeId])} className="h-14 w-14 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold">{o.title}</span>
                      {o.notes[0] && <span className="block text-sm text-muted-foreground">{o.notes[0]}</span>}
                      <span className={cn("block text-sm", worse ? "text-amber-800 dark:text-amber-300" : "text-green-800 dark:text-green-300")}>
                        {fitChangeText(0, o.fitScoreChange)}
                      </span>
                    </span>
                    {choose.isPending && choose.variables === o.recipeId && <Loader2 className="h-5 w-5 motion-safe:animate-spin" aria-label="Swapping" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {choose.isError && <p role="alert" className="text-base text-destructive">{errorText(choose.error, "Couldn't make that swap. Try again.")}</p>}
      </DialogContent>
    </Dialog>
  );
}
