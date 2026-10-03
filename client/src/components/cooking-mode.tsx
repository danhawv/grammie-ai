import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import {
  X, ChevronLeft, ChevronRight, Timer, ThermometerSun, UtensilsCrossed,
  ListChecks, Eye, BellRing, Square, Sun,
} from "lucide-react";
import { matchStepIngredients } from "@shared/step-ingredients";
import { formatIngredientInSystem } from "@shared/units";
import { useUnitSystem } from "@/hooks/use-unit-system";

// Full-screen guided cooking: one step at a time in large type, screen kept
// awake, per-step ingredients with quantities, tappable timers with a HUD,
// and an ingredient checklist — modeled on Crouton/NYT Cooking cook modes.

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

interface ActiveTimer {
  id: number;
  label: string;
  endsAt: number; // epoch ms
  totalSeconds: number;
  done: boolean;
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

/** Keep the screen awake while cooking (re-acquires when the tab returns) */
function useWakeLock(active: boolean): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: any = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = await (navigator as any).wakeLock.request("screen");
        if (cancelled) { lock.release(); return; }
        setHeld(true);
        lock.addEventListener("release", () => setHeld(false));
      } catch {
        setHeld(false);
      }
    };
    acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release?.().catch(() => {});
      setHeld(false);
    };
  }, [active]);
  return held;
}

function playTimerChime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    [0, 0.25, 0.5].forEach((delay, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = i === 2 ? 1046 : 880;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.22);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.25);
    });
  } catch {
    // audio unavailable — the visual alert still shows
  }
}

export function CookingMode({ open, onClose, title, instructions, ingredients }: {
  open: boolean;
  onClose: () => void;
  title: string;
  instructions: InstructionStep[];
  ingredients: any[];
}) {
  const [stepIdx, setStepIdx] = useState(0);
  const [timers, setTimers] = useState<ActiveTimer[]>([]);
  const [now, setNow] = useState(Date.now());
  const [showIngredients, setShowIngredients] = useState(false);
  const [checkedIngredients, setCheckedIngredients] = useState<Set<number>>(new Set());
  const timerIdRef = useRef(1);
  const wakeLockHeld = useWakeLock(open);
  const [unitSystem] = useUnitSystem();

  const step = instructions[stepIdx];
  const total = instructions.length;

  // Tick for countdowns + fire chime when a timer crosses zero
  useEffect(() => {
    if (!open || timers.length === 0) return;
    const iv = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setTimers((prev) => {
        let changed = false;
        const next = prev.map((timer) => {
          if (!timer.done && t >= timer.endsAt) {
            changed = true;
            playTimerChime();
            return { ...timer, done: true };
          }
          return timer;
        });
        return changed ? next : prev;
      });
    }, 500);
    return () => clearInterval(iv);
  }, [open, timers.length]);

  // Reset when a new session opens
  useEffect(() => {
    if (open) {
      setStepIdx(0);
      setTimers([]);
      setCheckedIngredients(new Set());
    }
  }, [open]);

  const goNext = useCallback(() => setStepIdx((i) => Math.min(i + 1, total - 1)), [total]);
  const goPrev = useCallback(() => setStepIdx((i) => Math.max(i - 1, 0)), []);

  // Arrow-key navigation
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); goNext(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, goNext, goPrev, onClose]);

  const stepIngredients = useMemo(
    () => matchStepIngredients(step?.ingredients, ingredients, unitSystem),
    [step, ingredients, unitSystem]
  );

  if (!open || !step) return null;

  const startTimer = () => {
    if (!step.timeMinutes) return;
    const seconds = step.timeMinutes * 60;
    setTimers((prev) => [...prev, {
      id: timerIdRef.current++,
      label: `Step ${step.stepNumber ?? stepIdx + 1}`,
      endsAt: Date.now() + seconds * 1000,
      totalSeconds: seconds,
      done: false,
    }]);
  };

  const dismissTimer = (id: number) => setTimers((prev) => prev.filter((t) => t.id !== id));
  const isLastStep = stepIdx === total - 1;

  return (
    <div className="fixed inset-0 z-[70] bg-background flex flex-col" data-testid="cooking-mode">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Cooking</p>
          <h2 className="font-semibold truncate">{title}</h2>
        </div>
        {wakeLockHeld && (
          <span className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground" title="Your screen will stay on while cooking">
            <Sun className="w-3.5 h-3.5" /> Screen on
          </span>
        )}
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowIngredients(true)} data-testid="cooking-mode-ingredients">
          <ListChecks className="w-4 h-4" />
          Ingredients
        </Button>
        <Button variant="ghost" size="icon" onClick={onClose} data-testid="cooking-mode-close">
          <X className="w-5 h-5" />
        </Button>
      </div>

      {/* Active timer HUD */}
      {timers.length > 0 && (
        <div className="flex gap-2 px-4 py-2 border-b bg-muted/50 overflow-x-auto shrink-0">
          {timers.map((t) => {
            const remaining = (t.endsAt - now) / 1000;
            return (
              <div
                key={t.id}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm shrink-0 ${
                  t.done ? "bg-destructive text-destructive-foreground animate-pulse" : "bg-background border"
                }`}
                data-testid={`timer-${t.id}`}
              >
                {t.done ? <BellRing className="w-4 h-4" /> : <Timer className="w-4 h-4" />}
                <span className="font-mono font-semibold">{t.done ? "Done!" : formatClock(remaining)}</span>
                <span className="text-xs opacity-70">{t.label}</span>
                <button onClick={() => dismissTimer(t.id)} className="opacity-70 hover:opacity-100">
                  <Square className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Progress */}
      <div className="px-4 pt-3 shrink-0">
        <div className="flex items-center justify-between text-sm text-muted-foreground mb-1.5">
          <span>Step {stepIdx + 1} of {total}</span>
          {step.stepType && <span className="uppercase tracking-wide text-xs">{step.stepType}</span>}
        </div>
        <Progress value={((stepIdx + 1) / total) * 100} className="h-1.5" />
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="max-w-2xl mx-auto space-y-6">
          <p className="text-2xl sm:text-3xl leading-relaxed font-medium" data-testid="cooking-step-text">
            {step.text}
          </p>

          {/* Timer / temperature actions */}
          <div className="flex flex-wrap gap-2">
            {step.timeMinutes ? (
              <Button variant="secondary" className="gap-2" onClick={startTimer} data-testid="start-step-timer">
                <Timer className="w-4 h-4" />
                Start {step.timeMinutes >= 60 ? `${Math.round(step.timeMinutes / 60 * 10) / 10}h` : `${step.timeMinutes} min`} timer
              </Button>
            ) : null}
            {step.temperature?.value != null && (
              <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-muted text-sm font-medium">
                <ThermometerSun className="w-4 h-4" />
                {step.temperature.value}°{step.temperature.scale || ''}
              </span>
            )}
          </div>

          {/* Ingredients for this step */}
          {stepIngredients.length > 0 && (
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                In this step
              </p>
              <ul className="space-y-1.5">
                {stepIngredients.map((ing, i) => (
                  <li key={i} className="text-base" data-testid={`step-ingredient-${i}`}>
                    {ing.display}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Tools */}
          {step.tools && step.tools.length > 0 && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <UtensilsCrossed className="w-4 h-4 shrink-0" />
              {step.tools.join(" · ")}
            </p>
          )}

          {/* Doneness cue */}
          {step.donenessCue && (
            <div className="flex gap-2 rounded-lg border-l-4 border-primary bg-primary/5 px-4 py-3">
              <Eye className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-0.5">Ready when</p>
                <p className="text-sm">{step.donenessCue}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-3 px-4 py-4 border-t shrink-0">
        <Button
          variant="outline"
          size="lg"
          className="gap-1.5"
          onClick={goPrev}
          disabled={stepIdx === 0}
          data-testid="cooking-prev"
        >
          <ChevronLeft className="w-5 h-5" />
          Back
        </Button>
        <div className="flex-1 flex justify-center gap-1.5">
          {instructions.map((_, i) => (
            <button
              key={i}
              onClick={() => setStepIdx(i)}
              className={`w-2 h-2 rounded-full transition-colors ${i === stepIdx ? "bg-primary" : i < stepIdx ? "bg-primary/40" : "bg-muted-foreground/25"}`}
              aria-label={`Go to step ${i + 1}`}
            />
          ))}
        </div>
        <Button
          size="lg"
          className="gap-1.5"
          onClick={isLastStep ? onClose : goNext}
          data-testid="cooking-next"
        >
          {isLastStep ? "Finish" : "Next"}
          {!isLastStep && <ChevronRight className="w-5 h-5" />}
        </Button>
      </div>

      {/* Ingredient checklist */}
      <Sheet open={showIngredients} onOpenChange={setShowIngredients}>
        <SheetContent side="right" className="w-full sm:max-w-md z-[80]">
          <SheetHeader>
            <SheetTitle>Ingredients</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3 overflow-y-auto">
            {ingredients.map((ing: any, i: number) => ({
              display: typeof ing === 'string' ? ing : formatIngredientInSystem(ing, unitSystem),
            })).map((ing, i) => (
              <label key={i} className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  checked={checkedIngredients.has(i)}
                  onCheckedChange={(c) => {
                    setCheckedIngredients((prev) => {
                      const next = new Set(prev);
                      if (c) next.add(i); else next.delete(i);
                      return next;
                    });
                  }}
                  className="mt-0.5"
                />
                <span className={`text-base ${checkedIngredients.has(i) ? "line-through text-muted-foreground" : ""}`}>
                  {ing.display}
                </span>
              </label>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
