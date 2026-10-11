import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarCheck, ChefHat, Printer, Scale, ShoppingBasket, Sparkles } from "lucide-react";
import type { PrepSetup } from "@shared/meal-prep/contract";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CreditNote } from "@/components/credits";
import { setupProblems, setupSteps, stepSummary } from "./setup-steps";

// The first-run guide: a welcome, one question per screen with sensible
// defaults (Skip keeps them), and a last look before "Build my plan". The
// heading takes focus on every step so screen readers announce where you are.

const WELCOME_POINTS = [
  { icon: ChefHat, text: "Pick a few dishes from your own recipes" },
  { icon: Scale, text: "Hit everyone's goals by adjusting portions — never the recipe" },
  { icon: ShoppingBasket, text: "Make one shopping list for the whole week" },
  { icon: CalendarCheck, text: "Plan one cooking session, with the oven and stove overlapping" },
  { icon: Printer, text: "Print a packet a helper can follow, with container labels" },
];

export function Walkthrough({
  setup,
  onChange,
  onBuild,
  onExit,
  building,
  initialStep = 0,
  onStepChange,
}: {
  setup: PrepSetup;
  onChange: (s: PrepSetup) => void;
  onBuild: () => void;
  onExit?: () => void;
  building?: boolean;
  initialStep?: number;
  onStepChange?: (i: number) => void;
}) {
  const steps = useMemo(() => setupSteps(setup), [setup]);
  // Screens: 0 = welcome, 1..n = questions, n+1 = review
  const total = steps.length + 2;
  const [index, setIndex] = useState(() => Math.min(initialStep, total - 1));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  useEffect(() => {
    onStepChange?.(index);
    if (first.current) { first.current = false; return; }
    headingRef.current?.focus();
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (i: number) => setIndex(Math.max(0, Math.min(total - 1, i)));
  const step = index >= 1 && index <= steps.length ? steps[index - 1] : null;
  const isReview = index === total - 1;
  const problems = setupProblems(setup);

  return (
    <div className="mx-auto max-w-xl pb-32">
      {index > 0 && (
        <div className="mb-6 space-y-2">
          <p className="text-sm text-muted-foreground">
            Step {index} of {total - 1}{step ? ` · ${step.label}` : ""}
          </p>
          <Progress value={(index / (total - 1)) * 100} aria-label={`Step ${index} of ${total - 1}`} className="h-2" />
        </div>
      )}

      {index === 0 && (
        <section aria-labelledby="mp-step-heading" className="space-y-6">
          <div>
            <p className="text-sm font-medium text-primary">Meal prep</p>
            <h1 id="mp-step-heading" ref={headingRef} tabIndex={-1} className="font-serif text-3xl font-bold leading-tight focus:outline-none">
              Cook once, eat well all week
            </h1>
          </div>
          <p className="text-lg">Answer a few questions and Grammie will:</p>
          <ul className="space-y-3">
            {WELCOME_POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-base">
                <Icon className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden />
                {text}
              </li>
            ))}
          </ul>
          <p className="text-base text-muted-foreground">
            It takes about two minutes. Everything has a sensible default, so you can skip anything you're unsure about and change it later.
          </p>
        </section>
      )}

      {step && (
        <section aria-labelledby="mp-step-heading" className="space-y-6">
          <div className="space-y-2">
            <h1 id="mp-step-heading" ref={headingRef} tabIndex={-1} className="font-serif text-3xl font-bold leading-tight focus:outline-none">
              {step.title}
            </h1>
            <p className="text-base text-muted-foreground">{step.why}</p>
          </div>
          {step.render({ setup, onChange })}
        </section>
      )}

      {isReview && (
        <section aria-labelledby="mp-step-heading" className="space-y-6">
          <div className="space-y-2">
            <h1 id="mp-step-heading" ref={headingRef} tabIndex={-1} className="font-serif text-3xl font-bold leading-tight focus:outline-none">
              Ready when you are
            </h1>
            <p className="text-base text-muted-foreground">
              Here's what you told Grammie. Tap any line to change it. Nothing is final until you approve the plan.
            </p>
          </div>
          <ul className="divide-y rounded-lg border">
            {steps.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => go(i + 1)}
                  className="flex min-h-14 w-full flex-col items-start px-4 py-3 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="text-sm text-muted-foreground">{s.label}</span>
                  <span className="text-base">{stepSummary(s.id, setup)}</span>
                </button>
              </li>
            ))}
          </ul>
          {problems.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-md border border-destructive p-3 text-base text-destructive">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
        </section>
      )}

      {/* Back / Skip / Next, above the phone tab bar */}
      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-30 border-t bg-background/95 backdrop-blur md:bottom-0">
        <div className="mx-auto flex max-w-xl items-center gap-2 px-4 py-3">
          {index > 0 ? (
            <Button variant="outline" onClick={() => go(index - 1)} aria-label="Back to the previous step">
              <ArrowLeft aria-hidden /> <span className="hidden sm:inline">Back</span>
            </Button>
          ) : onExit ? (
            <Button variant="ghost" onClick={onExit}>Not now</Button>
          ) : null}
          {step?.skippable && (
            <Button variant="ghost" onClick={() => go(index + 1)} className="ml-auto">
              Skip
            </Button>
          )}
          {isReview ? (
            <Button size="lg" className="ml-auto" onClick={onBuild} disabled={problems.length > 0 || building} data-testid="button-build-plan">
              <Sparkles aria-hidden /> Build my plan<CreditNote action="meal_prep_plan" />
            </Button>
          ) : (
            <Button size="lg" className={step?.skippable ? "" : "ml-auto"} onClick={() => go(index + 1)} data-testid="button-next-step">
              {index === 0 ? "Let's start" : "Next"} <ArrowRight aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
