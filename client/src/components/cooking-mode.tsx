import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  X, ChevronLeft, ChevronRight, Timer, ThermometerSun, UtensilsCrossed,
  ListChecks, Eye, BellRing, Sun, SunDim, Mic, MicOff, Check, RotateCcw, ChefHat,
} from "lucide-react";
import { matchStepIngredients } from "@shared/step-ingredients";
import { ingredientDisplay } from "@shared/recipe-display";
import { formatClock } from "@shared/cooking-session";
import type { VoiceCommand } from "@shared/cooking-session";
import type { UnitSystem } from "@shared/units";
import { useUnitSystem } from "@/hooks/use-unit-system";
import {
  clearSavedStep,
  readSavedStep,
  saveStep,
  speak,
  useKeepAwakePreference,
  useVoiceCommands,
  useWakeLock,
  voiceCommandsSupported,
  type CookingTimers,
} from "@/hooks/use-cooking-session";
import { cn } from "@/lib/utils";

// Full-screen guided cooking: one step at a time in large type, the screen
// kept on (with a visible toggle), per-step ingredients with amounts, timers
// that keep running across steps, "Resume at step N" when coming back, and a
// split view on tablets with the ingredient checklist beside the step.

interface InstructionStep {
  stepNumber?: number;
  text: string;
  ingredients?: string[];
  tools?: string[];
  stepType?: string | null;
  donenessCue?: string | null;
  temperature?: { value?: number | null; scale?: string | null; range?: string | null } | null;
  timeMinutes?: number | null;
}

function timerLength(minutes: number): string {
  return minutes >= 60 ? `${Math.round((minutes / 60) * 10) / 10} hr` : `${minutes} min`;
}

function SwitchPill({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={cn("relative h-6 w-10 shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-muted-foreground/40")}>
      <span className={cn("absolute left-0 top-0.5 h-5 w-5 rounded-full bg-background shadow transition-transform", on ? "translate-x-[1.125rem]" : "translate-x-0.5")} />
    </span>
  );
}

/** Running timers as chips; tapping one jumps to its step */
export function TimerChips({
  timers,
  onGoToStep,
  className,
}: {
  timers: CookingTimers;
  onGoToStep?: (stepIndex: number) => void;
  className?: string;
}) {
  if (timers.timers.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-2", className)} aria-label="Timers">
      {timers.timers.map((t) => {
        const remaining = (t.endsAt - timers.now) / 1000;
        return (
          <li
            key={t.id}
            className={cn(
              "flex shrink-0 items-center rounded-full border text-base",
              t.done ? "border-destructive bg-destructive text-destructive-foreground motion-safe:animate-pulse" : "bg-background",
            )}
            data-testid={`timer-${t.id}`}
          >
            <button
              type="button"
              onClick={() => onGoToStep?.(t.stepIndex)}
              disabled={!onGoToStep}
              className="flex min-h-11 items-center gap-2 rounded-l-full pl-3 pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
              aria-label={`${t.label} timer, ${t.done ? "done" : `${formatClock(remaining)} left`}${onGoToStep ? `. Go to ${t.label.toLowerCase()}` : ""}`}
            >
              {t.done ? <BellRing className="h-5 w-5" aria-hidden /> : <Timer className="h-5 w-5" aria-hidden />}
              <span className="font-semibold tabular-nums">{t.done ? "Done!" : formatClock(remaining)}</span>
              <span className="text-sm">{t.label}</span>
            </button>
            <button
              type="button"
              onClick={() => timers.dismiss(t.id)}
              className="flex h-11 w-11 items-center justify-center rounded-r-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t.done ? `Dismiss ${t.label} timer` : `Stop ${t.label} timer`}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Shown on the recipe page when timers are running and cooking mode is closed */
export function CookingTimerTray({ timers, onOpen }: { timers: CookingTimers; onOpen: () => void }) {
  if (timers.timers.length === 0) return null;
  return (
    <div
      className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px)+0.5rem)] z-30 px-4 md:bottom-4"
      role="region"
      aria-label="Cooking timers"
    >
      <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-xl border bg-card p-2 shadow-lg">
        <TimerChips timers={timers} className="min-w-0 flex-1 flex-nowrap overflow-x-auto" />
        <Button onClick={onOpen} className="shrink-0" data-testid="button-back-to-cooking">
          <ChefHat aria-hidden />
          Cooking
        </Button>
      </div>
    </div>
  );
}

function IngredientChecklist({
  ingredients,
  unitSystem,
  checked,
  onToggle,
}: {
  ingredients: any[];
  unitSystem: UnitSystem;
  checked: Set<number>;
  onToggle: (i: number) => void;
}) {
  return (
    <ul className="space-y-1">
      {ingredients.map((ing: any, i: number) => {
        const d = typeof ing === "string" ? { amount: "", name: ing, preparation: "", optional: false } : ingredientDisplay(ing, unitSystem);
        const isChecked = checked.has(i);
        return (
          <li key={i}>
            <button
              type="button"
              role="checkbox"
              aria-checked={isChecked}
              onClick={() => onToggle(i)}
              className="flex min-h-12 w-full items-start gap-3 rounded-md py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2",
                  isChecked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/60",
                )}
              >
                {isChecked && <Check className="h-4 w-4" strokeWidth={3} />}
              </span>
              <span className={cn("text-lg leading-snug", isChecked && "text-muted-foreground line-through")}>
                {d.amount && <span className="font-semibold">{d.amount} </span>}
                {d.name}
                {d.preparation && `, ${d.preparation}`}
                {d.optional && <span className="text-muted-foreground"> (optional)</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function CookingMode({
  open,
  onClose,
  recipeId,
  title,
  instructions,
  ingredients,
  timers,
  checkedIngredients,
  onToggleIngredient,
  initialStep,
}: {
  open: boolean;
  onClose: () => void;
  recipeId?: string;
  title: string;
  instructions: InstructionStep[];
  ingredients: any[];
  timers: CookingTimers;
  checkedIngredients: Set<number>;
  onToggleIngredient: (index: number) => void;
  /** Open at this step (e.g. from a timer) instead of offering to resume */
  initialStep?: number | null;
}) {
  const [stepIdx, setStepIdx] = useState(0);
  const [resumeOffer, setResumeOffer] = useState<number | null>(null);
  const [showIngredients, setShowIngredients] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [keepAwake, setKeepAwake] = useKeepAwakePreference();
  const wakeStatus = useWakeLock(open && keepAwake);
  const [unitSystem] = useUnitSystem();
  const containerRef = useRef<HTMLDivElement>(null);

  const total = instructions.length;
  const step = instructions[stepIdx];

  // On open: start at step 1 (or the requested step) and offer the saved step.
  // On close: turn the microphone off and give focus back.
  useEffect(() => {
    if (!open) return;
    const returnFocus = document.activeElement as HTMLElement | null;
    if (initialStep != null && initialStep >= 0 && initialStep < total) {
      setStepIdx(initialStep);
      setResumeOffer(null);
    } else {
      setStepIdx(0);
      setResumeOffer(readSavedStep(recipeId, total));
    }
    setShowIngredients(false);
    const raf = requestAnimationFrame(() => containerRef.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
      setVoiceOn(false);
      returnFocus?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Remember where the cook is (not while the resume offer is still showing)
  useEffect(() => {
    if (open && resumeOffer == null) saveStep(recipeId, stepIdx);
  }, [open, recipeId, stepIdx, resumeOffer]);

  const goTo = useCallback((i: number) => {
    setResumeOffer(null);
    setStepIdx(Math.max(0, Math.min(i, total - 1)));
  }, [total]);
  const goNext = useCallback(() => { setResumeOffer(null); setStepIdx((i) => Math.min(i + 1, total - 1)); }, [total]);
  const goPrev = useCallback(() => { setResumeOffer(null); setStepIdx((i) => Math.max(i - 1, 0)); }, []);

  const finish = useCallback(() => {
    clearSavedStep(recipeId);
    onClose();
  }, [recipeId, onClose]);

  const runningForStep = timers.timers.find((t) => t.stepIndex === stepIdx && !t.done);
  const startTimer = useCallback(() => {
    if (!step?.timeMinutes || runningForStep) return;
    timers.start({ label: `Step ${step.stepNumber ?? stepIdx + 1}`, seconds: step.timeMinutes * 60, stepIndex: stepIdx });
  }, [step, stepIdx, timers, runningForStep]);

  // Keyboard: arrows move, Escape closes; Space moves on unless a control has focus
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (showIngredients) return;
      const tag = (e.target as HTMLElement)?.tagName;
      const onControl = tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA" || tag === "A";
      if (e.key === "ArrowRight" || (e.key === " " && !onControl)) { e.preventDefault(); goNext(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, goNext, goPrev, onClose, showIngredients]);

  const voiceSupported = useMemo(() => voiceCommandsSupported(), []);
  const onVoice = useCallback((cmd: VoiceCommand) => {
    if (cmd === "next") goNext();
    else if (cmd === "back") goPrev();
    else if (cmd === "repeat") { if (step) speak(step.text); }
    else if (cmd === "timer") startTimer();
  }, [goNext, goPrev, step, startTimer]);
  const voice = useVoiceCommands(open && voiceOn, onVoice);

  const stepIngredients = useMemo(
    () => matchStepIngredients(step?.ingredients, ingredients, unitSystem),
    [step, ingredients, unitSystem],
  );

  if (!open || !step) return null;

  const isLastStep = stepIdx === total - 1;
  const titleId = "cooking-mode-title";

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[70] flex flex-col bg-background outline-none"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      data-testid="cooking-mode"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">Cooking</p>
          <h2 id={titleId} className="line-clamp-2 text-lg font-semibold leading-tight">{title}</h2>
        </div>
        <Button variant="outline" className="md:hidden" onClick={() => setShowIngredients(true)} data-testid="cooking-mode-ingredients">
          <ListChecks aria-hidden />
          Ingredients
        </Button>
        <Button variant="ghost" className="min-h-12 px-3" onClick={onClose} data-testid="cooking-mode-close">
          <X className="!size-5" aria-hidden />
          Close
        </Button>
      </div>

      {/* Status: step, screen on, voice, timers */}
      <div className="shrink-0 space-y-2 px-4 pt-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="mr-auto text-base font-medium" aria-live="polite">
            Step {stepIdx + 1} of {total}
            {step.stepType && <span className="ml-2 text-sm font-normal capitalize text-muted-foreground">{step.stepType}</span>}
          </p>
          {wakeStatus === "unsupported" ? (
            <p className="flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground" data-testid="wake-lock-unsupported">
              <SunDim className="h-4 w-4" aria-hidden />
              This browser can't keep the screen on
            </p>
          ) : (
            <button
              type="button"
              role="switch"
              aria-checked={keepAwake}
              onClick={() => setKeepAwake(!keepAwake)}
              className="flex min-h-11 items-center gap-2 rounded-md px-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="wake-lock-toggle"
            >
              {keepAwake ? <Sun className="h-4 w-4 text-primary" aria-hidden /> : <SunDim className="h-4 w-4" aria-hidden />}
              <span>
                {!keepAwake ? "Screen may turn off" : wakeStatus === "blocked" ? "Couldn't keep the screen on" : "Screen stays on"}
              </span>
              <SwitchPill on={keepAwake} />
            </button>
          )}
          {voiceSupported && (
            <button
              type="button"
              role="switch"
              aria-checked={voiceOn}
              onClick={() => setVoiceOn(!voiceOn)}
              className="flex min-h-11 items-center gap-2 rounded-md px-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="voice-commands-toggle"
            >
              {voiceOn ? <Mic className="h-4 w-4 text-primary" aria-hidden /> : <MicOff className="h-4 w-4" aria-hidden />}
              Voice commands
              <SwitchPill on={voiceOn} />
            </button>
          )}
        </div>
        {voiceOn && (
          <p className="text-sm text-muted-foreground" role="status">
            {voice.error ?? (voice.listening ? "Listening. Say “next”, “back”, “repeat” or “start timer”." : "Starting the microphone…")}
          </p>
        )}
        <Progress value={((stepIdx + 1) / total) * 100} className="h-2" aria-label={`Step ${stepIdx + 1} of ${total}`} />
        <TimerChips timers={timers} onGoToStep={goTo} className="pt-1" />
      </div>

      {/* Body: checklist beside the step on tablets, step only on phones */}
      <div className="flex min-h-0 flex-1 md:grid md:grid-cols-[minmax(16rem,1fr)_2fr]">
        <aside className="hidden overflow-y-auto border-r px-4 py-4 md:block" aria-labelledby="cooking-ingredients-heading">
          <h3 id="cooking-ingredients-heading" className="mb-2 text-lg font-semibold">Ingredients</h3>
          <IngredientChecklist ingredients={ingredients} unitSystem={unitSystem} checked={checkedIngredients} onToggle={onToggleIngredient} />
        </aside>

        <div className="min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
          <div className="mx-auto max-w-2xl space-y-6">
            {resumeOffer != null && (
              <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-4" role="region" aria-label="Resume cooking">
                <p className="text-lg">You were on step {resumeOffer + 1} last time.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button className="min-h-12" onClick={() => goTo(resumeOffer)} data-testid="cooking-resume">
                    Resume at step {resumeOffer + 1}
                  </Button>
                  <Button variant="outline" className="min-h-12" onClick={() => setResumeOffer(null)} data-testid="cooking-start-over">
                    <RotateCcw aria-hidden />
                    Start from step 1
                  </Button>
                </div>
              </div>
            )}

            <p className="text-2xl font-medium leading-relaxed sm:text-3xl" data-testid="cooking-step-text">
              {step.text}
            </p>

            {(step.timeMinutes || step.temperature?.value != null) && (
              <div className="flex flex-wrap items-center gap-2">
                {step.timeMinutes ? (
                  runningForStep ? (
                    <p className="inline-flex min-h-12 items-center gap-2 rounded-md bg-muted px-4 text-lg font-medium">
                      <Timer className="h-5 w-5" aria-hidden />
                      Timer running: <span className="tabular-nums">{formatClock((runningForStep.endsAt - timers.now) / 1000)}</span>
                    </p>
                  ) : (
                    <Button variant="secondary" className="min-h-12 text-base" onClick={startTimer} data-testid="start-step-timer">
                      <Timer aria-hidden />
                      Start {timerLength(step.timeMinutes)} timer
                    </Button>
                  )
                ) : null}
                {step.temperature?.value != null && (
                  <span className="inline-flex min-h-12 items-center gap-1.5 rounded-md bg-muted px-4 text-lg font-medium">
                    <ThermometerSun className="h-5 w-5" aria-hidden />
                    {step.temperature.value}°{step.temperature.scale || ""}
                  </span>
                )}
              </div>
            )}

            {stepIngredients.length > 0 && (
              <div className="rounded-lg border bg-muted/40 p-4">
                <h3 className="mb-2 text-base font-semibold">In this step</h3>
                <ul className="space-y-1.5">
                  {stepIngredients.map((ing, i) => (
                    <li key={i} className="text-lg" data-testid={`step-ingredient-${i}`}>
                      {ing.display}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {step.tools && step.tools.length > 0 && (
              <p className="flex items-center gap-2 text-base text-muted-foreground">
                <UtensilsCrossed className="h-5 w-5 shrink-0" aria-hidden />
                {step.tools.join(" · ")}
              </p>
            )}

            {step.donenessCue && (
              <div className="flex gap-3 rounded-lg border-l-4 border-primary bg-primary/5 px-4 py-3">
                <Eye className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden />
                <div>
                  <p className="text-sm font-semibold text-primary">Ready when</p>
                  <p className="text-lg">{step.donenessCue}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Navigation: full width on phones */}
      <div
        className="grid shrink-0 grid-cols-2 gap-3 border-t px-4 pt-3 md:flex md:items-center"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <Button
          variant="outline"
          className="min-h-14 text-lg md:min-w-40"
          onClick={goPrev}
          disabled={stepIdx === 0}
          data-testid="cooking-prev"
        >
          <ChevronLeft className="!size-6" aria-hidden />
          Back
        </Button>
        <div className="hidden flex-1 flex-wrap justify-center md:flex">
          {total <= 24 && instructions.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goTo(i)}
              className="flex h-11 w-7 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Go to step ${i + 1}`}
              aria-current={i === stepIdx ? "step" : undefined}
            >
              <span className={cn("h-2.5 w-2.5 rounded-full", i === stepIdx ? "bg-primary" : i < stepIdx ? "bg-primary/40" : "bg-muted-foreground/40")} />
            </button>
          ))}
        </div>
        <Button
          className="min-h-14 text-lg md:min-w-40"
          onClick={isLastStep ? finish : goNext}
          data-testid="cooking-next"
        >
          {isLastStep ? "Finish" : "Next"}
          {!isLastStep && <ChevronRight className="!size-6" aria-hidden />}
        </Button>
      </div>

      {/* Ingredient checklist (phones) */}
      <Sheet open={showIngredients} onOpenChange={setShowIngredients}>
        <SheetContent side="bottom" className="z-[80] max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Ingredients</SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            <IngredientChecklist ingredients={ingredients} unitSystem={unitSystem} checked={checkedIngredients} onToggle={onToggleIngredient} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
