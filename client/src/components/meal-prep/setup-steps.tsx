import { useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Check, ChevronDown, Heart, Library, Plus, Trash2 } from "lucide-react";
import type { MacroTargets, MealSlot, PrepPerson, PrepSetup } from "@shared/meal-prep/contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { errorText, mealPrepApi, mealPrepKeys, SHAKE_CHOICES, SLOT_LABELS, type PrepCookbookChoice } from "@/lib/meal-prep-api";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  estimateTargets,
  formatMinutes,
  prepAimText,
  newPerson,
  SLOT_ORDER,
  type ActivityLevel,
  type EstimateInput,
  type GoalDirection,
} from "@/lib/meal-prep-format";
import { ChoiceGroup, NumberStepper, ToggleChips, WordListInput } from "./controls";

// One question per screen. Each step is a small form over the PrepSetup; the
// walkthrough strings them together, and the setup summary / "Adjust" sheet
// reuse them one at a time. Each step says why Grammie asks.

export interface StepProps {
  setup: PrepSetup;
  onChange: (next: PrepSetup) => void;
}

export interface SetupStep {
  id: string;
  /** short name for the progress list and summary */
  label: string;
  title: string;
  why: string;
  /** "Skip" keeps the defaults */
  skippable: boolean;
  render: (p: StepProps) => ReactElement;
}

const setPerson = (setup: PrepSetup, id: string, patch: Partial<PrepPerson>): PrepSetup => ({
  ...setup,
  people: setup.people.map((p) => (p.id === id ? { ...p, ...patch } : p)),
});

// ---------- Who's eating ----------

function PeopleStep({ setup, onChange }: StepProps) {
  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {setup.people.map((p, i) => (
          <li key={p.id} className="flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor={`person-${p.id}`} className="text-base">{i === 0 ? "You" : `Person ${i + 1}`}</Label>
              <Input
                id={`person-${p.id}`}
                value={p.name}
                onChange={(e) => onChange(setPerson(setup, p.id, { name: e.target.value }))}
                autoComplete={i === 0 ? "given-name" : "off"}
                className="h-11 text-base"
                placeholder={i === 0 ? "e.g. Jean" : "e.g. Grandpa"}
              />
            </div>
            {setup.people.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${p.name || `person ${i + 1}`}`}
                onClick={() => onChange({ ...setup, people: setup.people.filter((x) => x.id !== p.id) })}
              >
                <Trash2 aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {setup.people.length < 8 && (
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange({ ...setup, people: [...setup.people, newPerson("", { slots: setup.people[0]?.slots ?? ["lunch", "dinner"] })] })}
        >
          <Plus aria-hidden /> Add someone
        </Button>
      )}
    </div>
  );
}

// ---------- Goals (one screen per person) ----------

function numberOrUndefined(v: string): number | undefined {
  const n = Number(v.replace(/,/g, ""));
  return v.trim() && Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

function Estimator({ onUse }: { onUse: (t: { kcal: number; protein: number }) => void }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState<Partial<EstimateInput>>({ sex: "unspecified", activity: "moderate", goal: "maintain" });
  const feet = input.heightIn ? Math.floor(input.heightIn / 12) : undefined;
  const inches = input.heightIn ? input.heightIn % 12 : undefined;
  const result = input.age && input.weightLb && input.heightIn ? estimateTargets(input as EstimateInput) : null;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex min-h-12 w-full items-center justify-between gap-2 px-4 text-left text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Not sure? Help me estimate
          <ChevronDown className={`h-5 w-5 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t p-4">
        <p className="text-sm text-muted-foreground">
          A rough starting point from a standard formula, not medical advice. If a doctor or dietitian gave you numbers, use theirs.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="est-age" className="text-base">Age</Label>
            <Input id="est-age" inputMode="numeric" className="h-11 text-base" value={input.age ?? ""} onChange={(e) => setInput({ ...input, age: numberOrUndefined(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="est-weight" className="text-base">Weight (lb)</Label>
            <Input id="est-weight" inputMode="decimal" className="h-11 text-base" value={input.weightLb ?? ""} onChange={(e) => setInput({ ...input, weightLb: numberOrUndefined(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="est-ft" className="text-base">Height (ft)</Label>
            <Input id="est-ft" inputMode="numeric" className="h-11 text-base" value={feet ?? ""} onChange={(e) => setInput({ ...input, heightIn: (numberOrUndefined(e.target.value) ?? 0) * 12 + (inches ?? 0) || undefined })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="est-in" className="text-base">and inches</Label>
            <Input id="est-in" inputMode="numeric" className="h-11 text-base" value={inches ?? ""} onChange={(e) => setInput({ ...input, heightIn: (feet ?? 0) * 12 + (Number(e.target.value) || 0) || undefined })} />
          </div>
        </div>
        <ChoiceGroup<EstimateInput["sex"]>
          legend="Body type for the formula"
          value={input.sex!}
          onChange={(sex) => setInput({ ...input, sex })}
          columns={3}
          options={[{ value: "female", label: "Female" }, { value: "male", label: "Male" }, { value: "unspecified", label: "Skip" }]}
        />
        <ChoiceGroup<ActivityLevel>
          legend="How active?"
          value={input.activity!}
          onChange={(activity) => setInput({ ...input, activity })}
          options={[
            { value: "light", label: "Mostly sitting", hint: "Desk work, short walks" },
            { value: "moderate", label: "On my feet a fair bit", hint: "Exercise a few times a week" },
            { value: "active", label: "Very active", hint: "Hard exercise or physical work most days" },
          ]}
        />
        <ChoiceGroup<GoalDirection>
          legend="Goal"
          value={input.goal!}
          onChange={(goal) => setInput({ ...input, goal })}
          columns={3}
          options={[{ value: "lose", label: "Lose" }, { value: "maintain", label: "Stay" }, { value: "gain", label: "Gain" }]}
        />
        <div aria-live="polite">
          {result ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-secondary p-3">
              <p className="text-base">About <strong>{result.kcal.toLocaleString()} cal</strong> and <strong>{result.protein} g protein</strong> a day</p>
              <Button type="button" onClick={() => { onUse(result); setOpen(false); }}>Use these</Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Fill in age, weight and height to see an estimate.</p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function GoalsStep({ setup, onChange, personId }: StepProps & { personId: string }) {
  const person = setup.people.find((p) => p.id === personId);
  if (!person) return <p>That person was removed.</p>;
  const t = person.targets;
  const update = (targets: MacroTargets | null) => onChange(setPerson(setup, person.id, { targets }));
  const patch = (p: Partial<MacroTargets>) => update({ ...(t ?? { kcal: 2000, protein: 100 }), ...p });
  const relaxed = (t?.tolerance?.kcal ?? 0.05) > 0.05;
  return (
    <div className="space-y-6">
      <ChoiceGroup<"targets" | "normal">
        legend={setup.people[0]?.id === person.id ? "What should you aim for?" : `What should ${person.name || "they"} aim for?`}
        value={t ? "targets" : "normal"}
        onChange={(v) => update(v === "normal" ? null : { kcal: 2000, protein: 100 })}
        options={[
          { value: "targets", label: "Calories and protein", hint: "Grammie sizes each plate to land near these numbers." },
          { value: "normal", label: "No targets — normal portions", hint: "One regular serving per meal." },
        ]}
      />
      {t && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="goal-kcal" className="text-base">Calories for the whole day</Label>
              <Input id="goal-kcal" inputMode="numeric" className="h-11 text-base" value={t.kcal || ""} onChange={(e) => patch({ kcal: numberOrUndefined(e.target.value) ?? 0 })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="goal-protein" className="text-base">Protein (g)</Label>
              <Input id="goal-protein" inputMode="numeric" className="h-11 text-base" value={t.protein || ""} onChange={(e) => patch({ protein: numberOrUndefined(e.target.value) ?? 0 })} />
              <p className="text-sm text-muted-foreground">At least this much a day</p>
            </div>
          </div>
          <Estimator onUse={(r) => patch(r)} />
          <Collapsible className="rounded-lg border">
            <CollapsibleTrigger asChild>
              <button type="button" className="flex min-h-12 w-full items-center justify-between px-4 text-left text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Carbs and fat (optional)
                <ChevronDown className="h-5 w-5" aria-hidden />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="grid grid-cols-2 gap-3 border-t p-4">
              <div className="space-y-1">
                <Label htmlFor="goal-carbs" className="text-base">Carbs (g)</Label>
                <Input id="goal-carbs" inputMode="numeric" className="h-11 text-base" value={t.carbs ?? ""} onChange={(e) => patch({ carbs: numberOrUndefined(e.target.value) })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="goal-fat" className="text-base">Fat (g)</Label>
                <Input id="goal-fat" inputMode="numeric" className="h-11 text-base" value={t.fat ?? ""} onChange={(e) => patch({ fat: numberOrUndefined(e.target.value) })} />
              </div>
            </CollapsibleContent>
          </Collapsible>
          <ChoiceGroup<"close" | "relaxed">
            legend="How close is close enough?"
            hint={`Food isn't exact, so each day lands near the target, not on it. At ${t.kcal.toLocaleString()} cal, ±5% is about ${Math.round(t.kcal * 0.05 / 10) * 10} cal either way.`}
            value={relaxed ? "relaxed" : "close"}
            onChange={(v) => patch({ tolerance: { ...t.tolerance, kcal: v === "relaxed" ? 0.1 : 0.05 } })}
            options={[
              { value: "close", label: "Close (±5%)", hint: "Best for steady goals" },
              { value: "relaxed", label: "Relaxed (±10%)", hint: "More dishes to choose from" },
            ]}
          />
        </>
      )}
    </div>
  );
}

// ---------- Meals and days ----------

function MealsStep({ setup, onChange }: StepProps) {
  const [perPerson, setPerPerson] = useState(() => setup.people.some((p) => p.slots.join() !== setup.people[0]?.slots.join()));
  const allSlots = setup.people[0]?.slots ?? [];
  const toggle = (slots: MealSlot[], s: MealSlot) => (slots.includes(s) ? slots.filter((x) => x !== s) : [...slots, s]).sort((a, b) => SLOT_ORDER.indexOf(a) - SLOT_ORDER.indexOf(b));
  const slotOptions = SLOT_ORDER.map((s) => ({ value: s, label: SLOT_LABELS[s] }));
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-base font-semibold">Which meals?</p>
        {!perPerson ? (
          <ToggleChips
            label="Meals to prep for everyone"
            options={slotOptions}
            selected={allSlots}
            onToggle={(s) => {
              const slots = toggle(allSlots, s as MealSlot);
              onChange({ ...setup, people: setup.people.map((p) => ({ ...p, slots })) });
            }}
          />
        ) : (
          <div className="space-y-4">
            {setup.people.map((p) => (
              <div key={p.id} className="space-y-2">
                <p className="text-base">{p.name || "Someone"}</p>
                <ToggleChips label={`Meals for ${p.name}`} options={slotOptions} selected={p.slots} onToggle={(s) => onChange(setPerson(setup, p.id, { slots: toggle(p.slots, s as MealSlot) }))} />
              </div>
            ))}
          </div>
        )}
        {setup.people.length > 1 && (
          <Button type="button" variant="ghost" className="px-0 text-primary" onClick={() => setPerPerson(!perPerson)}>
            {perPerson ? "Same meals for everyone" : "Choose meals for each person"}
          </Button>
        )}
        {setup.people.every((p) => p.slots.length === 0) && <p className="text-sm text-destructive" role="alert">Pick at least one meal.</p>}
        {setup.people.some((p) => p.slots.includes("dessert")) && (
          <NumberStepper
            label="Dessert: how many days a week?"
            hint="Desserts count toward the day's calories, so the other meals make room for them."
            value={setup.dessertsPerWeek ?? 7}
            min={1}
            max={7}
            onChange={(dessertsPerWeek) => onChange({ ...setup, dessertsPerWeek })}
            format={(n) => (n === 7 ? "Every day" : `${n} ${n === 1 ? "day" : "days"}`)}
          />
        )}
        {/* Targets are whole-day; say what share the prep covers */}
        <div aria-live="polite" className="space-y-1">
          {setup.people.map((p, i) => {
            const text = prepAimText(p, { you: i === 0 && setup.people.length === 1, dessertsPerWeek: setup.dessertsPerWeek });
            return text ? <p key={p.id} className="rounded-md bg-secondary p-3 text-base">{text}</p> : null;
          })}
        </div>
      </div>
      <NumberStepper
        label="How many days?"
        hint="Most cooked food keeps 3–4 days in the fridge. Grammie freezes the later days so they stay fresh."
        value={setup.days}
        min={1}
        max={7}
        onChange={(days) => onChange({ ...setup, days })}
        format={(n) => `${n} ${n === 1 ? "day" : "days"}`}
      />
      <label className="flex min-h-12 items-center justify-between gap-4 rounded-lg border p-3">
        <span>
          <span className="block text-base font-medium">Start eating on cooking day</span>
          <span className="block text-sm text-muted-foreground">Off: the first meal is the day after you cook.</span>
        </span>
        <Switch checked={!!setup.startSameDay} onCheckedChange={(v) => onChange({ ...setup, startSameDay: v })} aria-label="Start eating on cooking day" />
      </label>
    </div>
  );
}

// ---------- Plan from ----------

const ROLE_TEXT: Record<PrepCookbookChoice["role"], string> = { owner: "", editor: "Shared with you", viewer: "You follow it" };

function SourceStep({ setup, onChange }: StepProps) {
  const source = setup.recipeSource ?? { kind: "all" as const };
  const chosen = new Set(source.cookbookIds ?? []);
  const books = useQuery({ queryKey: mealPrepKeys.cookbooks, queryFn: mealPrepApi.cookbooks, enabled: source.kind === "cookbooks" });
  const set = (next: NonNullable<PrepSetup["recipeSource"]>) => onChange({ ...setup, recipeSource: next });
  const toggle = (id: number) => {
    const ids = chosen.has(id) ? Array.from(chosen).filter((x) => x !== id) : [...Array.from(chosen), id];
    set({ kind: "cookbooks", cookbookIds: ids });
  };
  const count = (books.data ?? []).filter((b) => chosen.has(b.id)).reduce((n, b) => n + b.recipeCount, 0);
  return (
    <div className="space-y-6">
      <ChoiceGroup<"all" | "cookbooks" | "favorites">
        legend="Pick dishes from"
        value={source.kind}
        onChange={(kind) => set(kind === "cookbooks" ? { kind, cookbookIds: source.cookbookIds ?? [] } : { kind })}
        options={[
          { value: "all", label: <span className="inline-flex items-center gap-2"><Library className="h-4 w-4" aria-hidden /> All my recipes</span>, hint: "Every recipe you've added." },
          { value: "cookbooks", label: <span className="inline-flex items-center gap-2"><BookOpen className="h-4 w-4" aria-hidden /> Pick cookbooks</span>, hint: "Only recipes in the cookbooks you choose, including ones shared with you." },
          { value: "favorites", label: <span className="inline-flex items-center gap-2"><Heart className="h-4 w-4" aria-hidden /> My favourites</span>, hint: "Recipes you've bookmarked." },
        ]}
      />
      {source.kind === "cookbooks" && (
        <fieldset className="space-y-2">
          <legend className="text-base font-semibold">Which cookbooks?</legend>
          {books.isLoading ? (
            <p className="text-base text-muted-foreground" role="status">Loading your cookbooks…</p>
          ) : books.isError ? (
            <div className="space-y-2 rounded-md border border-destructive p-3" role="alert">
              <p className="text-base">{errorText(books.error, "Couldn't load your cookbooks.")}</p>
              <Button type="button" variant="outline" onClick={() => books.refetch()}>Try again</Button>
            </div>
          ) : (books.data ?? []).length === 0 ? (
            <p className="rounded-md bg-secondary p-3 text-base">You don't have any cookbooks yet. Plan from all your recipes, or make a cookbook first.</p>
          ) : (
            <ul className="space-y-2">
              {books.data!.map((b) => {
                const on = chosen.has(b.id);
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggle(b.id)}
                      data-testid={`cookbook-${b.id}`}
                      className={cn(
                        "flex min-h-14 w-full items-center gap-3 rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        on ? "border-primary bg-primary/5" : "hover:bg-accent/50",
                      )}
                    >
                      <span aria-hidden className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded border-2", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground")}>
                        {on && <Check className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-base font-medium">{b.name}</span>
                        <span className="block text-sm text-muted-foreground">
                          {b.recipeCount} {b.recipeCount === 1 ? "recipe" : "recipes"}{ROLE_TEXT[b.role] ? ` · ${ROLE_TEXT[b.role]}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {chosen.size === 0 ? "Pick at least one." : `${chosen.size} ${chosen.size === 1 ? "cookbook" : "cookbooks"} · about ${count} recipes to choose from`}
          </p>
        </fieldset>
      )}
    </div>
  );
}

// ---------- How to hit your numbers ----------

function NumbersStep({ setup, onChange }: StepProps) {
  const topUps = setup.topUps ?? "both";
  const shakeAllowed = topUps === "shake" || topUps === "both";
  return (
    <div className="space-y-6">
      <label className="flex min-h-12 items-center justify-between gap-4 rounded-lg border p-3">
        <span>
          <span className="block text-base font-medium">Allow lighter and higher-protein swaps from your recipes</span>
          <span className="block text-sm text-muted-foreground">
            Like Greek yogurt instead of sour cream. We'll always tell you what we changed, on the plan, the labels and the cook's packet.
          </span>
        </span>
        <Switch
          checked={setup.allowSwaps !== false}
          onCheckedChange={(allowSwaps) => onChange({ ...setup, allowSwaps })}
          aria-label="Allow lighter and higher-protein swaps from your recipes"
        />
      </label>
      <ChoiceGroup<NonNullable<PrepSetup["topUps"]>>
        legend="If you still need protein, add"
        hint="Only when portions and swaps aren't enough. It's added beside the meal, never into the recipe."
        value={topUps}
        onChange={(v) => onChange({ ...setup, topUps: v })}
        columns={2}
        options={[
          { value: "chicken", label: "Chicken", hint: "Plain cooked chicken breast" },
          { value: "shake", label: "A protein shake", hint: "A bottle from the store" },
          { value: "both", label: "Either", hint: "Whichever fits the meal" },
          { value: "none", label: "Nothing extra" },
        ]}
      />
      {shakeAllowed && (
        <fieldset className="space-y-2">
          <legend className="text-base font-semibold">Which shake?</legend>
          <p className="text-sm text-muted-foreground">Numbers are per bottle, from the label.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SHAKE_CHOICES.map((sh) => {
              const on = (setup.shakeId ?? SHAKE_CHOICES.find((x) => x.isDefault)?.id) === sh.id;
              return (
                <button
                  key={sh.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onChange({ ...setup, shakeId: sh.id })}
                  data-testid={`shake-${sh.id}`}
                  className={cn(
                    "flex min-h-12 items-center gap-3 rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on ? "border-primary bg-primary/5" : "hover:bg-accent/50",
                  )}
                >
                  <span aria-hidden className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", on ? "border-primary bg-primary" : "border-muted-foreground")}>
                    {on && <span className="h-2 w-2 rounded-full bg-primary-foreground" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-base font-medium">{sh.product}{sh.isDefault ? " (Grammie's pick)" : ""}</span>
                    <span className="block text-sm text-muted-foreground">{sh.proteinPerBottle} g protein · {sh.kcalPerBottle} cal a bottle</span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
    </div>
  );
}

// ---------- Allergies and dislikes ----------

const COMMON_ALLERGENS = ["peanuts", "tree nuts", "milk", "eggs", "wheat", "soy", "fish", "shellfish", "sesame"];

function AvoidStep({ setup, onChange }: StepProps) {
  return (
    <div className="space-y-8">
      {setup.people.map((p) => (
        <section key={p.id} className="space-y-4" aria-label={p.name || "Someone"}>
          {setup.people.length > 1 && <h3 className="text-lg font-semibold">{p.name || "Someone"}</h3>}
          <WordListInput
            label="Allergies"
            hint="Dishes with these are never chosen."
            values={p.allergies}
            onChange={(allergies) => onChange(setPerson(setup, p.id, { allergies }))}
            placeholder="e.g. peanuts"
            suggestions={COMMON_ALLERGENS}
          />
          <WordListInput
            label="Doesn't like"
            values={p.dislikes}
            onChange={(dislikes) => onChange(setPerson(setup, p.id, { dislikes }))}
            placeholder="e.g. mushrooms, cilantro"
          />
        </section>
      ))}
      <p className="rounded-md bg-secondary p-3 text-sm">
        Grammie checks ingredient lists, but can't see inside store-bought sauces or spice blends. Always read the labels for serious allergies.
      </p>
    </div>
  );
}

// ---------- Kitchen ----------

const APPLIANCES = ["Instant Pot", "Slow cooker", "Air fryer", "Rice cooker", "Grill"];

function KitchenStep({ setup, onChange }: StepProps) {
  const k = setup.kitchen;
  const set = (patch: Partial<typeof k>) => onChange({ ...setup, kitchen: { ...k, ...patch } });
  const has = k.appliances.map((a) => a.kind);
  return (
    <div className="space-y-6">
      <ChoiceGroup<number>
        legend="Ovens"
        value={k.ovens}
        onChange={(ovens) => set({ ovens })}
        columns={3}
        options={[{ value: 0, label: "None" }, { value: 1, label: "One" }, { value: 2, label: "Two" }]}
      />
      <NumberStepper label="Stove burners" value={k.burners} min={0} max={8} onChange={(burners) => set({ burners })} />
      <div className="space-y-2">
        <p className="text-base font-semibold">Anything else that cooks?</p>
        <ToggleChips
          label="Appliances"
          options={APPLIANCES.map((a) => ({ value: a.toLowerCase(), label: a }))}
          selected={has}
          onToggle={(kind) => set({ appliances: has.includes(kind) ? k.appliances.filter((a) => a.kind !== kind) : [...k.appliances, { kind, count: 1 }] })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="containers" className="text-base font-semibold">Containers you have (optional)</Label>
        <Input
          id="containers"
          inputMode="numeric"
          className="h-11 w-32 text-base"
          value={k.containers ?? ""}
          onChange={(e) => set({ containers: numberOrUndefined(e.target.value) })}
        />
        <p className="text-sm text-muted-foreground">Grammie will tell you if you need more.</p>
      </div>
      <ChoiceGroup<"none" | "some" | "plenty">
        legend="Freezer space"
        value={k.freezerSpace ?? "some"}
        onChange={(freezerSpace) => set({ freezerSpace })}
        columns={3}
        options={[{ value: "none", label: "None" }, { value: "some", label: "Some" }, { value: "plenty", label: "Plenty" }]}
      />
    </div>
  );
}

// ---------- Cooking session ----------

function SessionStep({ setup, onChange }: StepProps) {
  const s = setup.session;
  const set = (patch: Partial<typeof s>) => onChange({ ...setup, session: { ...s, ...patch } });
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Label htmlFor="session-date" className="text-base font-semibold">Cooking day</Label>
        <Input id="session-date" type="date" required className="h-11 w-48 text-base" value={s.date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
      </div>
      <ChoiceGroup<number>
        legend="Longest you want to be in the kitchen"
        value={s.maxMinutes}
        onChange={(maxMinutes) => set({ maxMinutes })}
        columns={2}
        options={[120, 180, 240, 300].map((m) => ({ value: m, label: formatMinutes(m) }))}
      />
      <ChoiceGroup<number>
        legend="How many people cooking?"
        value={s.cooks}
        onChange={(cooks) => set({ cooks })}
        columns={2}
        options={[{ value: 1, label: "Just one" }, { value: 2, label: "Two of us", hint: "Tasks are split between you" }]}
      />
      <label className="flex min-h-12 items-center justify-between gap-4 rounded-lg border p-3">
        <span>
          <span className="block text-base font-medium">Someone else is cooking for us</span>
          <span className="block text-sm text-muted-foreground">A hired cook or helper gets a link and a printed packet to follow — no account needed.</span>
        </span>
        <Switch checked={s.helper} onCheckedChange={(helper) => set({ helper })} aria-label="Someone else is cooking for us" />
      </label>
      <ChoiceGroup<"beginner" | "home" | "pro">
        legend="Cook's experience"
        hint="Newer cooks get a little more time for each step."
        value={s.skill}
        onChange={(skill) => set({ skill })}
        options={[
          { value: "beginner", label: "Just learning" },
          { value: "home", label: "Comfortable home cook" },
          { value: "pro", label: "Very experienced" },
        ]}
      />
    </div>
  );
}

// ---------- Wishes ----------

const WISH_IDEAS = ["Something new to try", "Comfort food", "Easy breakfasts", "Nothing spicy", "Keep it cheap", "More vegetables"];

function WishesStep({ setup, onChange }: StepProps) {
  const text = setup.wishes ?? "";
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="wishes" className="text-base font-semibold">In your own words (optional)</Label>
        <Textarea
          id="wishes"
          rows={4}
          className="text-base"
          value={text}
          maxLength={500}
          onChange={(e) => onChange({ ...setup, wishes: e.target.value })}
          placeholder="e.g. More Mexican food, and use up the chicken in the freezer"
        />
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Ideas to add">
        {WISH_IDEAS.filter((w) => !text.toLowerCase().includes(w.toLowerCase())).map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => onChange({ ...setup, wishes: text.trim() ? `${text.trim().replace(/[.,]$/, "")}, ${w.toLowerCase()}` : w })}
            className="inline-flex min-h-11 items-center gap-1 rounded-full border border-dashed px-3 text-sm hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-4 w-4" aria-hidden /> {w}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- The step list ----------

/** The setup questions in order; goals expand to one screen per person */
export function setupSteps(setup: PrepSetup): SetupStep[] {
  return [
    {
      id: "people", label: "People", title: "Who's eating?", skippable: false,
      why: "Each person gets their own plates, sized for them. Add everyone the food is for.",
      render: (p) => <PeopleStep {...p} />,
    },
    {
      id: "source", label: "Plan from", title: "Plan from which recipes?", skippable: true,
      why: "Grammie only picks dishes from here. A cookbook like your high-protein one keeps the week on track.",
      render: (p) => <SourceStep {...p} />,
    },
    ...setup.people.map<SetupStep>((person, i) => ({
      id: `goals:${person.id}`,
      label: setup.people.length > 1 ? `${person.name || `Person ${i + 1}`}'s goals` : "Goals",
      title: setup.people.length > 1 ? `${person.name || `Person ${i + 1}`}'s goals` : "Your goals",
      why: "Enter whole-day numbers; Grammie works out the part your prepped meals cover. It adjusts how much goes on the plate, and may add a plain side like rice or Greek yogurt.",
      skippable: true,
      render: (p) => <GoalsStep {...p} personId={person.id} />,
    })),
    {
      id: "numbers", label: "Hitting your numbers", title: "How to hit your numbers", skippable: true,
      why: "First Grammie sizes the portions. If that isn't enough, it can use a lighter or higher-protein swap from your recipe, and as a last resort add plain protein on the side.",
      render: (p) => <NumbersStep {...p} />,
    },
    {
      id: "meals", label: "Meals", title: "Which meals, for how many days?", skippable: true,
      why: "This sets how many containers you'll fill and how long the food needs to last.",
      render: (p) => <MealsStep {...p} />,
    },
    {
      id: "avoid", label: "Allergies", title: "Allergies and dislikes", skippable: true,
      why: "Grammie leaves out any dish that uses these, and lists allergens on every container label.",
      render: (p) => <AvoidStep {...p} />,
    },
    {
      id: "kitchen", label: "Kitchen", title: "Your kitchen", skippable: true,
      why: "So the plan never needs two things in one oven at different temperatures, or more pots than you have burners.",
      render: (p) => <KitchenStep {...p} />,
    },
    {
      id: "session", label: "Cooking day", title: "The cooking day", skippable: true,
      why: "Everything gets cooked in one go. Grammie overlaps the dishes so the oven and stove keep busy while you chop.",
      render: (p) => <SessionStep {...p} />,
    },
    {
      id: "wishes", label: "Wishes", title: "Anything you're in the mood for?", skippable: true,
      why: "Grammie leans toward dishes that match, from your own recipes. It's a nudge, not a rule.",
      render: (p) => <WishesStep {...p} />,
    },
  ];
}

/** What's missing before a plan can be built, in plain words; empty = ready */
export function setupProblems(setup: PrepSetup): string[] {
  const out: string[] = [];
  if (setup.people.length === 0) out.push("Add at least one person.");
  if (setup.people.some((p) => !p.name.trim())) out.push("Give everyone a name, so labels say whose meal it is.");
  if (setup.people.every((p) => p.slots.length === 0)) out.push("Pick at least one meal to prep.");
  if (setup.people.some((p) => p.targets && (p.targets.kcal < 800 || p.targets.protein <= 0)))
    out.push("Check the calorie and protein numbers — they look too low.");
  if (!setup.session.date) out.push("Pick a cooking day.");
  if (setup.recipeSource?.kind === "cookbooks" && !(setup.recipeSource.cookbookIds?.length)) out.push("Pick at least one cookbook to plan from.");
  return out;
}

/** One-line summary of a step's answers, for the setup summary cards */
export function stepSummary(stepId: string, setup: PrepSetup): string {
  if (stepId === "people") return setup.people.map((p) => p.name || "Someone").join(", ");
  if (stepId.startsWith("goals:")) {
    const p = setup.people.find((x) => `goals:${x.id}` === stepId);
    return p?.targets ? `${p.targets.kcal.toLocaleString()} cal · ${p.targets.protein} g protein` : "Normal portions";
  }
  if (stepId === "meals") {
    const slots = SLOT_ORDER.filter((s) => setup.people.some((p) => p.slots.includes(s)));
    const desserts = setup.dessertsPerWeek ?? 7;
    const words = slots.map((s) => (s === "dessert" && desserts < 7 ? `Dessert (${desserts} days a week)` : SLOT_LABELS[s]));
    return `${words.join(", ") || "No meals"} · ${setup.days} ${setup.days === 1 ? "day" : "days"}`;
  }
  if (stepId === "source") {
    const src = setup.recipeSource;
    if (src?.kind === "favorites") return "My favourites";
    if (src?.kind === "cookbooks") {
      const books = queryClient.getQueryData<PrepCookbookChoice[]>(mealPrepKeys.cookbooks) ?? [];
      const names = (src.cookbookIds ?? []).map((id) => books.find((b) => b.id === id)?.name).filter(Boolean);
      const n = src.cookbookIds?.length ?? 0;
      return names.length === n && n > 0 ? names.join(", ") : `${n} ${n === 1 ? "cookbook" : "cookbooks"}`;
    }
    return "All my recipes";
  }
  if (stepId === "numbers") {
    const top = { chicken: "add chicken if needed", shake: "add a protein shake if needed", both: "add chicken or a shake if needed", none: "nothing extra" }[setup.topUps ?? "both"];
    return `${setup.allowSwaps === false ? "No swaps" : "Swaps allowed"} · ${top}`;
  }
  if (stepId === "avoid") {
    const all = Array.from(new Set(setup.people.flatMap((p) => [...p.allergies, ...p.dislikes])));
    return all.length ? all.join(", ") : "Nothing to avoid";
  }
  if (stepId === "kitchen") {
    const k = setup.kitchen;
    return [`${k.ovens} ${k.ovens === 1 ? "oven" : "ovens"}`, `${k.burners} burners`, ...k.appliances.map((a) => a.kind)].join(" · ");
  }
  if (stepId === "session") {
    const s = setup.session;
    const date = new Date(`${s.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    return `${date} · up to ${formatMinutes(s.maxMinutes)}${s.helper ? " · helper cooking" : ""}`;
  }
  if (stepId === "wishes") return setup.wishes?.trim() || "No wishes";
  return "";
}
