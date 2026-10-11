import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { ChevronRight, RotateCcw, Sparkles } from "lucide-react";
import type { PrepSetup } from "@shared/meal-prep/contract";
import { getFoodProfile } from "@shared/food-profile";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingState } from "@/components/page-states";
import { Button } from "@/components/ui/button";
import { Walkthrough } from "@/components/meal-prep/walkthrough";
import { BuildingState } from "@/components/meal-prep/building-state";
import { SetupStepSheet, SetupSummaryList } from "@/components/meal-prep/setup-sheet";
import { setupProblems } from "@/components/meal-prep/setup-steps";
import { planStatusText } from "@/components/meal-prep/plan-status";
import { useAuth } from "@/hooks/useAuth";
import { CreditNote } from "@/components/credits";
import { isNeedCredits, refreshCredits } from "@/lib/credits-api";
import { usePreferences } from "@/hooks/use-preferences";
import { queryClient } from "@/lib/queryClient";
import { MealPrepApiError, defaultsFromSetup, errorText, mealPrepApi, mealPrepKeys, setupFromDefaults, type PrepPlanSummary } from "@/lib/meal-prep-api";
import { defaultSetup, formatDay, sessionSkill, todayIso } from "@/lib/meal-prep-format";

// /meal-prep: the start of meal prep. First time through it's the guided
// walkthrough; after that it's the saved setup as a short list of answers,
// "Build my plan", and any plan still in progress to pick back up.

const DRAFT_KEY = "grammie-meal-prep-draft";

function readDraft(): { setup: PrepSetup; step: number } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeDraft(v: { setup: PrepSetup; step: number } | null) {
  try {
    if (v) localStorage.setItem(DRAFT_KEY, JSON.stringify(v));
    else localStorage.removeItem(DRAFT_KEY);
  } catch { /* not remembered; fine */ }
}

/** Keep the session date from sitting in the past when reusing saved defaults */
function freshen(setup: PrepSetup, base: PrepSetup): PrepSetup {
  return setup.session.date < todayIso() ? { ...setup, session: { ...setup.session, date: base.session.date } } : setup;
}

export default function MealPrepPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { preferences, isLoading: prefsLoading } = usePreferences();

  useEffect(() => { document.title = "Meal prep · Kitchen · Grammie"; }, []);

  const profileQuery = useQuery({ queryKey: mealPrepKeys.profile, queryFn: mealPrepApi.getProfile });
  const plansQuery = useQuery({ queryKey: mealPrepKeys.plans, queryFn: mealPrepApi.listPlans });

  // Defaults come from what the app already knows (Food profile, name)
  const base = useMemo(() => {
    const food = getFoodProfile(preferences);
    return defaultSetup({
      today: todayIso(),
      ownerName: user?.firstName || undefined,
      allergies: food.allergies,
      dislikes: food.dislikes,
      skill: sessionSkill(food.skillLevel),
    });
  }, [preferences, user?.firstName]);

  const [setup, setSetup] = useState<PrepSetup | null>(null);
  const [step, setStep] = useState(0);
  const [tour, setTour] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  // Start from: an unfinished walkthrough on this device, else saved defaults, else fresh defaults
  useEffect(() => {
    if (setup || !profileQuery.data || prefsLoading) return;
    const draft = readDraft();
    if (draft && !profileQuery.data.walkthroughDone) {
      setSetup(freshen(draft.setup, base));
      setStep(draft.step);
    } else {
      setSetup(setupFromDefaults(profileQuery.data.defaults, base));
    }
  }, [profileQuery.data, prefsLoading, base, setup]);

  const showWalkthrough = tour || (profileQuery.data && !profileQuery.data.walkthroughDone);

  const update = (next: PrepSetup) => {
    setSetup(next);
    if (showWalkthrough) writeDraft({ setup: next, step });
  };

  const build = useMutation({
    mutationFn: async (s: PrepSetup) => {
      // Remember these answers as the defaults for next time
      await mealPrepApi.saveProfile(defaultsFromSetup(s), true);
      return mealPrepApi.createPlan(s);
    },
    onSuccess: (record) => {
      writeDraft(null);
      refreshCredits();
      queryClient.setQueryData(mealPrepKeys.plan(record.id), record);
      queryClient.invalidateQueries({ queryKey: mealPrepKeys.profile });
      queryClient.invalidateQueries({ queryKey: mealPrepKeys.plans });
      navigate(`/meal-prep/${record.id}`);
    },
  });

  const wrap = (children: React.ReactNode) => <div className="container mx-auto max-w-3xl px-4 py-6">{children}</div>;

  if (build.isPending) return wrap(<BuildingState />);
  if (build.isError) {
    if (build.error instanceof MealPrepApiError && isNeedCredits(build.error)) {
      return wrap(
        <ErrorState
          title="Add credits to build this plan"
          description={<>{errorText(build.error)} <Link href="/credits" className="font-medium text-primary underline underline-offset-4">Add credits</Link>. Your answers are saved.</>}
        />,
      );
    }
    return wrap(
      <ErrorState
        title="Grammie couldn't build that plan"
        description={errorText(build.error, "Check your connection and try again. Your answers are saved.")}
        onRetry={() => setup && build.mutate(setup)}
      />,
    );
  }
  if (profileQuery.isError) return wrap(<ErrorState title="Couldn't open meal prep" description={errorText(profileQuery.error)} onRetry={() => profileQuery.refetch()} />);
  if (!setup) return wrap(<LoadingState label="Opening meal prep" rows={4} />);

  if (showWalkthrough) {
    return wrap(
      <Walkthrough
        setup={setup}
        onChange={update}
        initialStep={tour ? 1 : step}
        onStepChange={(i) => { setStep(i); if (!tour) writeDraft({ setup, step: i }); }}
        onBuild={() => build.mutate(setup)}
        onExit={() => (tour ? setTour(false) : navigate("/kitchen?tab=meal-plans"))}
        building={build.isPending}
      />,
    );
  }

  const inProgress = (plansQuery.data ?? []).filter((p) => p.status === "draft" || p.status === "approved");
  const problems = setupProblems(setup);

  return wrap(
    <>
      <PageHeader
        title="Meal prep"
        back={{ href: "/kitchen?tab=meal-plans", label: "Kitchen" }}
        description="Check your answers, then Grammie picks the dishes, sizes the plates and plans the cooking day."
      />
      {inProgress.length > 0 && <ResumeList plans={inProgress} />}
      <section aria-labelledby="setup-heading" className="space-y-3">
        <h2 id="setup-heading" className="text-xl font-semibold">This week's setup</h2>
        <SetupSummaryList setup={setup} onEdit={setEditing} />
        {problems.length > 0 && (
          <ul role="alert" className="space-y-1 text-base text-destructive">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        )}
      </section>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button size="lg" className="w-full sm:w-auto" onClick={() => build.mutate(setup)} disabled={problems.length > 0} data-testid="button-build-plan">
          <Sparkles aria-hidden /> Build my plan<CreditNote action="meal_prep_plan" />
        </Button>
        <Button variant="ghost" onClick={() => { setStep(1); setTour(true); }}>
          <RotateCcw aria-hidden /> Go through the guide again
        </Button>
      </div>
      <SetupStepSheet setup={setup} stepId={editing} onClose={() => setEditing(null)} onSave={(s) => { setSetup(s); setEditing(null); }} />
    </>,
  );
}


export function ResumeList({ plans }: { plans: PrepPlanSummary[] }) {
  return (
    <section aria-labelledby="resume-heading" className="mb-8 space-y-3">
      <h2 id="resume-heading" className="text-xl font-semibold">Pick up where you left off</h2>
      <ul className="space-y-2">
        {plans.map((p) => (
          <li key={p.id}>
            <Link
              href={`/meal-prep/${p.id}`}
              className="flex min-h-16 items-center gap-3 rounded-lg border bg-card px-4 py-3 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-semibold">{p.sessionDate ? `Cooking ${formatDay(p.sessionDate)}` : "Meal prep plan"}</span>
                <span className="block text-sm text-muted-foreground">{planStatusText(p)}</span>
                {p.dishes.length > 0 && <span className="mt-1 block truncate text-sm">{p.dishes.join(" · ")}</span>}
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
