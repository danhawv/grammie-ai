import type {
  ContainerLabel,
  DayFit,
  Lane,
  MacroKey,
  MacroTargets,
  MealSlot,
  Plate,
  PrepPerson,
  PrepSetup,
  ScheduledTask,
} from "@shared/meal-prep/contract";

// Pure helpers for the meal-prep screens: plate wording, macro bars, dates,
// the cook's "Now / Next" view, the target estimator and label sheets. Kept
// free of React so they're easy to test (meal-prep-format.test.ts).

// ---------- Amounts ----------

const QUARTERS: Record<number, string> = { 0: "", 1: "¼", 2: "½", 3: "¾" };

/** 1.25 -> "1¼", 0.5 -> "½", 2 -> "2" (to the nearest quarter) */
export function quarterFraction(n: number): string {
  const q = Math.max(0, Math.round(n * 4));
  const whole = Math.floor(q / 4);
  const frac = QUARTERS[q % 4];
  if (whole === 0) return frac || "0";
  return `${whole}${frac}`;
}

/** "1¼ servings", "½ serving", "1 serving" */
export function formatServings(n: number): string {
  const text = quarterFraction(n);
  const one = Math.round(n * 4) <= 4;
  return `${text} ${one ? "serving" : "servings"}`;
}

/** Grams rounded to a sensible step: 7 g, 150 g, 1.2 kg */
export function formatGrams(g: number): string {
  if (g >= 1000) return `${Math.round(g / 100) / 10} kg`;
  if (g >= 20) return `${Math.round(g / 5) * 5} g`;
  return `${Math.round(g)} g`;
}

/** "rice-cooked" -> "rice", "chicken-breast-cooked" -> "chicken breast" */
export function adjusterLabel(id: string, names?: Record<string, string>): string {
  if (names?.[id]) return names[id];
  return id.replace(/-(cooked|raw|plain)$/, "").replace(/-/g, " ");
}

export interface PlateNames {
  recipeTitle: (id: string) => string;
  adjusterNames?: Record<string, string>;
}

/** "1¼ servings Mom's Chili + 150 g rice" */
export function describePlate(plate: Pick<Plate, "items">, names: PlateNames): string {
  return plate.items
    .map((item) =>
      item.kind === "recipe"
        ? `${formatServings(item.amount)} ${names.recipeTitle(item.refId)}`
        : `${formatGrams(item.amount)} ${adjusterLabel(item.refId, names.adjusterNames)}`,
    )
    .join(" + ");
}

// ---------- Dates ----------

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/** The calendar date of an eating day: the day after the session unless startSameDay */
export function eatingDate(setup: Pick<PrepSetup, "session" | "startSameDay">, day: number): string {
  return addDays(setup.session.date, day + (setup.startSameDay ? 0 : 1));
}

/** "Mon, Oct 13" */
export function formatDay(iso: string, opts: { weekday?: boolean } = {}): string {
  return parseIsoDate(iso).toLocaleDateString("en-US", {
    weekday: opts.weekday === false ? undefined : "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "Eat by Thu" when within the week, else "Eat by Oct 20" */
export function eatByText(eatBy: string, from: string): string {
  const diff = (parseIsoDate(eatBy).getTime() - parseIsoDate(from).getTime()) / 86_400_000;
  if (diff >= 0 && diff < 7) {
    return `Eat by ${parseIsoDate(eatBy).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}`;
  }
  return `Eat by ${formatDay(eatBy, { weekday: false })}`;
}

/** Today's date in local time as YYYY-MM-DD */
export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Minutes as "45 min", "1 hr", "2 hr 15 min" */
export function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}

/** Offset from the session start as a clock: 0 -> "0:00", 75 -> "1:15" */
export function sessionClock(min: number): string {
  const m = Math.max(0, Math.round(min));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

// ---------- Macros ----------

export const MACRO_ORDER: MacroKey[] = ["protein", "kcal", "carbs", "fat"];
export const MACRO_LABELS: Record<MacroKey, string> = { kcal: "Calories", protein: "Protein", carbs: "Carbs", fat: "Fat" };

const DEFAULT_TOLERANCE: Record<MacroKey, number> = { kcal: 0.05, protein: 0.05, carbs: 0.15, fat: 0.15 };

export function toleranceFor(target: MacroTargets, key: MacroKey): number {
  return target.tolerance?.[key] ?? DEFAULT_TOLERANCE[key];
}

/** Calories to the nearest 10, grams to the nearest whole */
export function roundMacro(key: MacroKey, v: number): number {
  return key === "kcal" ? Math.round(v / 10) * 10 : Math.round(v);
}

/** "≈ 520 cal" / "38 g protein" */
export function formatMacro(key: MacroKey, v: number, approx = false): string {
  const n = roundMacro(key, v).toLocaleString("en-US");
  const text = key === "kcal" ? `${n} cal` : `${n} g ${MACRO_LABELS[key].toLowerCase()}`;
  return approx ? `≈ ${text}` : text;
}

export type FitTone = "good" | "close" | "off";

export interface MacroBar {
  key: MacroKey;
  label: string;
  actual: number;
  target: number;
  /** bar fill 0..1, where 1 = the target */
  fill: number;
  tone: FitTone;
  /** plain words for screen readers and the color-blind: "On target", "A little low" */
  verdict: string;
  /** "172 of 180 g" */
  amount: string;
}

/**
 * How one macro sits against its target. Green within tolerance, amber within
 * twice the tolerance, red beyond. Protein is a floor, so going over is fine.
 */
export function macroBar(key: MacroKey, actual: number, target: MacroTargets): MacroBar | null {
  const t = key === "kcal" ? target.kcal : key === "protein" ? target.protein : target[key];
  if (t == null || t <= 0) return null;
  const tol = toleranceFor(target, key);
  const ratio = actual / t;
  const miss = key === "protein" ? Math.max(0, 1 - ratio) : Math.abs(1 - ratio);
  const tone: FitTone = miss <= tol + 1e-9 ? "good" : miss <= tol * 2 + 1e-9 ? "close" : "off";
  const direction = ratio < 1 ? "low" : "high";
  const verdict =
    tone === "good" ? (key === "protein" && ratio > 1 + tol ? "Above target (fine)" : "On target")
    : tone === "close" ? `A little ${direction}`
    : `Too ${direction}`;
  const unit = key === "kcal" ? " cal" : " g";
  return {
    key,
    label: MACRO_LABELS[key],
    actual,
    target: t,
    fill: Math.min(1, Math.max(0, ratio)),
    tone,
    verdict,
    amount: `${roundMacro(key, actual).toLocaleString("en-US")} of ${roundMacro(key, t).toLocaleString("en-US")}${unit}`,
  };
}

/** Bars for one person-day, protein first; empty when the person has no targets */
export function dayBars(fit: Pick<DayFit, "macros" | "target">): MacroBar[] {
  if (!fit.target) return [];
  return MACRO_ORDER.map((k) => macroBar(k, fit.macros[k], fit.target!)).filter((b): b is MacroBar => !!b);
}

/** The worst tone across a day's bars */
export function worstTone(bars: MacroBar[]): FitTone {
  if (bars.some((b) => b.tone === "off")) return "off";
  if (bars.some((b) => b.tone === "close")) return "close";
  return "good";
}

/** Plain words for how a swap changes the week's fit score */
export function fitChangeText(before: number, after: number): string {
  const d = Math.round(after - before);
  if (Math.abs(d) < 3) return "Keeps the week on target";
  if (d > 0) return d >= 10 ? "Fits your goals better" : "Fits a little better";
  return d <= -10 ? "Harder to hit your goals" : "Fits a little less well";
}

// ---------- Daily targets vs. prepped meals ----------

/**
 * Targets are for the whole day; the planner aims each person's prepped
 * meals at their share of it (breakfast 25%, lunch 30%, dinner 35%, snack
 * 10%), so lunch + dinner covers 65%.
 */
export const SLOT_SHARE: Record<MealSlot, number> = { breakfast: 0.25, lunch: 0.3, dinner: 0.35, snack: 0.1 };

export function prepShare(slots: MealSlot[]): number {
  return Math.min(1, Array.from(new Set(slots)).reduce((n, s) => n + SLOT_SHARE[s], 0));
}

/** "lunches and dinners", "breakfasts, lunches and dinners" */
export function slotListText(slots: MealSlot[]): string {
  const words = SLOT_ORDER.filter((s) => slots.includes(s)).map((s) => `${s}${s === "lunch" ? "es" : "s"}`);
  return words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * Plain words for what the prep covers: "Your prepped lunches and dinners
 * will cover about 1,430 of your 2,200 calories a day." Null without targets.
 */
export function prepAimText(person: Pick<PrepPerson, "name" | "slots" | "targets">, opts: { you?: boolean } = {}): string | null {
  if (!person.targets || person.slots.length === 0) return null;
  const share = prepShare(person.slots);
  const aim = Math.round((person.targets.kcal * share) / 10) * 10;
  const kcal = person.targets.kcal.toLocaleString("en-US");
  // Named people get "Dan: …" rather than a guessed pronoun
  const who = opts.you ? "Your prepped" : `${person.name || "This person"}: prepped`;
  const of = opts.you ? "of your" : "of";
  if (share >= 1) return `${who} meals will cover all ${kcal} calories of the day.`;
  return `${who} ${slotListText(person.slots)} will cover about ${aim.toLocaleString("en-US")} ${of} ${kcal} calories a day.`;
}

// ---------- The plan grid ----------

export const SLOT_ORDER: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

/** Plates for one person as rows of days, each with its slots in meal order */
export function personWeek(plates: Plate[], personId: string, days: number): Array<{ day: number; plates: Plate[] }> {
  const mine = plates.filter((p) => p.personId === personId);
  return Array.from({ length: days }, (_, day) => ({
    day,
    plates: mine
      .filter((p) => p.day === day)
      .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot)),
  }));
}

export function plateKey(p: Pick<Plate, "personId" | "day" | "slot">): string {
  return `${p.personId}:${p.day}:${p.slot}`;
}

/**
 * Plate keys whose numbers are only rough. The session's container labels
 * carry a confidence per plate, so the review and the labels agree.
 */
export function roughPlates(labels: Array<Pick<ContainerLabel, "plateKey" | "confidence">> | undefined): Set<string> {
  return new Set((labels ?? []).filter((l) => l.confidence === "low").map((l) => l.plateKey));
}

// ---------- Cook mode ----------

export const LANE_ORDER: Lane[] = ["prep", "stove", "oven", "other", "clean"];
export const LANE_LABELS: Record<Lane, string> = { prep: "Prep", stove: "Stove", oven: "Oven", other: "Other", clean: "Clean" };

/**
 * What to do now and what's coming. "Now" is every unfinished task whose
 * dependencies are done, earliest first (one per cook, plus anything passive
 * already running); "Next" is the following few in schedule order.
 */
export function focusTasks(
  tasks: ScheduledTask[],
  done: Record<string, boolean>,
  opts: { cooks?: number; nextCount?: number } = {},
): { now: ScheduledTask[]; next: ScheduledTask[]; doneCount: number } {
  const cooks = Math.max(1, opts.cooks ?? 1);
  const pending = tasks.filter((t) => !done[t.id]).sort((a, b) => a.start - b.start || a.end - b.end);
  const ready = pending.filter((t) => t.dependsOn.every((d) => done[d] || !tasks.some((x) => x.id === d)));
  const now: ScheduledTask[] = [];
  const busyCooks = new Set<number>();
  for (const t of ready) {
    if (busyCooks.size >= cooks) break;
    // Waiting tasks (simmering, resting) don't need a hand; each cook gets one
    if (t.activeMin === 0 || busyCooks.has(t.cook)) continue;
    busyCooks.add(t.cook);
    now.push(t);
  }
  if (now.length === 0 && ready.length) now.push(ready[0]);
  const nowIds = new Set(now.map((t) => t.id));
  const next = pending.filter((t) => !nowIds.has(t.id)).slice(0, opts.nextCount ?? 3);
  return { now, next, doneCount: tasks.length - pending.length };
}

/** Tasks grouped by lane, lanes in a fixed order, empty lanes left out */
export function tasksByLane(tasks: ScheduledTask[]): Array<{ lane: Lane; tasks: ScheduledTask[] }> {
  return LANE_ORDER.map((lane) => ({ lane, tasks: tasks.filter((t) => t.lane === lane).sort((a, b) => a.start - b.start) }))
    .filter((g) => g.tasks.length > 0);
}

// ---------- Target estimator ----------

export type ActivityLevel = "light" | "moderate" | "active";
export type GoalDirection = "lose" | "maintain" | "gain";

export interface EstimateInput {
  /** used only for the formula; "unspecified" averages the two */
  sex: "female" | "male" | "unspecified";
  age: number;
  weightLb: number;
  heightIn: number;
  activity: ActivityLevel;
  goal: GoalDirection;
}

const ACTIVITY: Record<ActivityLevel, number> = { light: 1.375, moderate: 1.55, active: 1.725 };
const GOAL_SHIFT: Record<GoalDirection, number> = { lose: -0.15, maintain: 0, gain: 0.1 };

/**
 * A starting point, not advice: Mifflin-St Jeor resting energy times an
 * activity factor, nudged for the goal; protein about 1.6 g per kg (2 g when
 * losing). Calories round to 50, protein to 5.
 */
export function estimateTargets(input: EstimateInput): { kcal: number; protein: number } | null {
  const { age, weightLb, heightIn } = input;
  if (!(age >= 13 && age <= 100 && weightLb >= 60 && weightLb <= 600 && heightIn >= 48 && heightIn <= 90)) return null;
  const kg = weightLb * 0.4536;
  const cm = heightIn * 2.54;
  const base = 10 * kg + 6.25 * cm - 5 * age;
  const sexAdj = input.sex === "male" ? 5 : input.sex === "female" ? -161 : -78;
  const kcal = (base + sexAdj) * ACTIVITY[input.activity] * (1 + GOAL_SHIFT[input.goal]);
  const protein = kg * (input.goal === "lose" ? 2 : 1.6);
  return { kcal: Math.round(kcal / 50) * 50, protein: Math.round(protein / 5) * 5 };
}

// ---------- Labels ----------

export interface LabelLayout {
  id: "avery-5163" | "avery-5160";
  name: string;
  cols: number;
  rows: number;
  /** inches */
  width: number;
  height: number;
  top: number;
  side: number;
  colGap: number;
  compact: boolean;
}

export const LABEL_LAYOUTS: LabelLayout[] = [
  { id: "avery-5163", name: "Large — 10 per sheet (Avery 5163, 2 × 5)", cols: 2, rows: 5, width: 4, height: 2, top: 0.5, side: 0.156, colGap: 0.188, compact: false },
  { id: "avery-5160", name: "Small — 30 per sheet (Avery 5160, 3 × 10)", cols: 3, rows: 10, width: 2.625, height: 1, top: 0.5, side: 0.188, colGap: 0.125, compact: true },
];

/** Labels split into printed sheets */
export function labelSheets<T>(labels: T[], layout: Pick<LabelLayout, "cols" | "rows">): T[][] {
  const per = layout.cols * layout.rows;
  const out: T[][] = [];
  for (let i = 0; i < labels.length; i += per) out.push(labels.slice(i, i + per));
  return out;
}

/**
 * "Dan · Lunch Tue, Oct 20" from a label's plate key. Without the setup (a
 * hired cook's view) the day is counted instead: "Dan · Lunch, day 2".
 */
export function labelSlotText(
  label: Pick<ContainerLabel, "plateKey" | "person">,
  setup?: Pick<PrepSetup, "session" | "startSameDay">,
): string {
  const [, dayText, slot] = label.plateKey.split(":");
  const day = Number(dayText);
  const slotName = slot ? slot[0].toUpperCase() + slot.slice(1) : "";
  const when = !Number.isFinite(day) ? "" : setup ? ` ${formatDay(eatingDate(setup, day))}` : `, day ${day + 1}`;
  return [label.person, `${slotName}${when}`].filter(Boolean).join(" · ");
}

// ---------- Defaults ----------

let idCounter = 0;
export function newPersonId(): string {
  idCounter += 1;
  return `p${Date.now().toString(36)}${idCounter}`;
}

export function newPerson(name: string, extras: Partial<PrepPerson> = {}): PrepPerson {
  return { id: newPersonId(), name, targets: null, slots: ["lunch", "dinner"], allergies: [], dislikes: [], ...extras };
}

/** The coming Sunday (a week out if today is Sunday, leaving time to shop) */
export function nextSunday(today: string): string {
  const d = parseIsoDate(today);
  return addDays(today, (7 - d.getUTCDay()) % 7 || 7);
}

/** A complete setup with calm defaults, seeded from what the app already knows */
export function defaultSetup(opts: { today: string; ownerName?: string; allergies?: string[]; dislikes?: string[]; skill?: "beginner" | "home" | "pro" }): PrepSetup {
  return {
    people: [newPerson(opts.ownerName || "Me", { allergies: opts.allergies ?? [], dislikes: opts.dislikes ?? [] })],
    days: 5,
    kitchen: { ovens: 1, ovenRacks: 2, burners: 4, appliances: [], freezerSpace: "some" },
    session: { date: nextSunday(opts.today), maxMinutes: 240, cooks: 1, helper: false, skill: opts.skill ?? "home" },
    maxDishes: 4,
    wishes: "",
  };
}

/** Map the Food profile's skill words onto the session's three levels */
export function sessionSkill(level: string | undefined): "beginner" | "home" | "pro" {
  if (level === "beginner") return "beginner";
  if (level === "advanced" || level === "professional") return "pro";
  return "home";
}
