import { describe, expect, it } from "vitest";
import type { ScheduledTask } from "@shared/meal-prep/contract";
import {
  adjusterLabel,
  dayBars,
  defaultSetup,
  describePlate,
  eatByText,
  eatingDate,
  estimateTargets,
  fitChangeText,
  focusTasks,
  formatDay,
  formatGrams,
  formatMacro,
  formatMinutes,
  formatServings,
  labelSheets,
  labelSlotText,
  macroBar,
  nextSunday,
  personWeek,
  prepAimText,
  prepShare,
  plateKey,
  quarterFraction,
  roughPlates,
  sessionClock,
  tasksByLane,
  worstTone,
} from "./meal-prep-format";
import { FIXTURE_VIEW } from "./meal-prep-fixtures";

describe("amounts", () => {
  it("rounds servings to quarters with nice fractions", () => {
    expect(quarterFraction(1.25)).toBe("1¼");
    expect(quarterFraction(0.5)).toBe("½");
    expect(quarterFraction(2.74)).toBe("2¾");
    expect(quarterFraction(3)).toBe("3");
    expect(quarterFraction(0.1)).toBe("0");
    expect(formatServings(1)).toBe("1 serving");
    expect(formatServings(0.75)).toBe("¾ serving");
    expect(formatServings(1.5)).toBe("1½ servings");
  });

  it("rounds grams sensibly", () => {
    expect(formatGrams(7.4)).toBe("7 g");
    expect(formatGrams(148)).toBe("150 g");
    expect(formatGrams(1240)).toBe("1.2 kg");
  });

  it("names adjusters", () => {
    expect(adjusterLabel("rice-cooked")).toBe("rice");
    expect(adjusterLabel("chicken-breast-cooked")).toBe("chicken breast");
    expect(adjusterLabel("greek-yogurt", { "greek-yogurt": "Greek yogurt" })).toBe("Greek yogurt");
  });

  it("describes a plate in words", () => {
    const text = describePlate(
      { items: [
        { kind: "recipe", refId: "r-chili", amount: 1.25, grams: null, macros: { kcal: 0, protein: 0, carbs: 0, fat: 0 } },
        { kind: "adjuster", refId: "rice-cooked", amount: 150, grams: 150, macros: { kcal: 0, protein: 0, carbs: 0, fat: 0 } },
      ] },
      { recipeTitle: (id) => (id === "r-chili" ? "Chili" : "?") },
    );
    expect(text).toBe("1¼ servings Chili + 150 g rice");
  });
});

describe("dates", () => {
  const setup = { session: { date: "2026-10-18", maxMinutes: 240, cooks: 1, helper: false, skill: "home" as const } };

  it("starts eating the day after the session unless told otherwise", () => {
    expect(eatingDate(setup, 0)).toBe("2026-10-19");
    expect(eatingDate({ ...setup, startSameDay: true }, 0)).toBe("2026-10-18");
    expect(eatingDate(setup, 13)).toBe("2026-11-01");
  });

  it("formats days and eat-by text", () => {
    expect(formatDay("2026-10-19")).toBe("Mon, Oct 19");
    expect(eatByText("2026-10-22", "2026-10-18")).toBe("Eat by Thu");
    expect(eatByText("2026-11-30", "2026-10-18")).toBe("Eat by Nov 30");
  });

  it("finds the next Sunday", () => {
    expect(nextSunday("2026-10-11")).toBe("2026-10-18"); // a Sunday: the next one
    expect(nextSunday("2026-10-13")).toBe("2026-10-18");
  });

  it("formats durations", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1 hr");
    expect(formatMinutes(135)).toBe("2 hr 15 min");
    expect(sessionClock(75)).toBe("1:15");
  });
});

describe("macro bars", () => {
  const target = { kcal: 2000, protein: 150, carbs: 200 };

  it("is green within tolerance, amber within double, red beyond", () => {
    expect(macroBar("kcal", 2080, target)!.tone).toBe("good"); // 4%
    expect(macroBar("kcal", 1850, target)!.tone).toBe("close"); // 7.5% low
    expect(macroBar("kcal", 2400, target)!.tone).toBe("off"); // 20% high
    expect(macroBar("kcal", 1850, target)!.verdict).toBe("A little low");
  });

  it("treats protein as a floor", () => {
    expect(macroBar("protein", 190, target)!.tone).toBe("good");
    expect(macroBar("protein", 190, target)!.verdict).toBe("Above target (fine)");
    expect(macroBar("protein", 130, target)!.tone).toBe("off");
  });

  it("skips macros without a target and caps the fill", () => {
    expect(macroBar("fat", 70, target)).toBeNull();
    expect(macroBar("kcal", 4000, target)!.fill).toBe(1);
    expect(macroBar("kcal", 1500, target)!.amount).toBe("1,500 of 2,000 cal");
  });

  it("puts protein first and finds the worst tone", () => {
    const bars = dayBars({ macros: { kcal: 2000, protein: 120, carbs: 200, fat: 60 }, target });
    expect(bars.map((b) => b.key)).toEqual(["protein", "kcal", "carbs"]);
    expect(worstTone(bars)).toBe("off");
    expect(dayBars({ macros: { kcal: 1, protein: 1, carbs: 1, fat: 1 }, target: null })).toEqual([]);
  });

  it("formats macros with an estimate marker", () => {
    expect(formatMacro("kcal", 517)).toBe("520 cal");
    expect(formatMacro("protein", 37.6, true)).toBe("≈ 38 g protein");
  });

  it("describes swap changes in words", () => {
    expect(fitChangeText(80, 81)).toBe("Keeps the week on target");
    expect(fitChangeText(80, 95)).toBe("Fits your goals better");
    expect(fitChangeText(80, 74)).toBe("Fits a little less well");
  });
});

describe("plan grid", () => {
  it("lays out each person's week in meal order", () => {
    const week = personWeek(FIXTURE_VIEW.plan!.plates, "p-dan", 5);
    expect(week).toHaveLength(5);
    expect(week[0].plates.map((p) => p.slot)).toEqual(["breakfast", "lunch", "dinner"]);
  });

  it("flags plates whose labels say the numbers are rough", () => {
    const rough = roughPlates(FIXTURE_VIEW.session!.labels);
    const beefDay = FIXTURE_VIEW.plan!.plates.find((p) => p.items.some((i) => i.refId === "r-beef"))!;
    const chiliDay = FIXTURE_VIEW.plan!.plates.find((p) => p.items.some((i) => i.refId === "r-chili"))!;
    expect(rough.has(plateKey(beefDay))).toBe(true);
    expect(rough.has(plateKey(chiliDay))).toBe(false);
    expect(roughPlates(undefined).size).toBe(0);
  });

  it("fixture plan is internally consistent", () => {
    const { plan, setup } = FIXTURE_VIEW;
    expect(plan!.fit).toHaveLength(setup.people.length * setup.days);
    expect(FIXTURE_VIEW.session!.labels).toHaveLength(plan!.plates.length);
  });
});

describe("cook mode focus", () => {
  const task = (id: string, start: number, extra: Partial<ScheduledTask> = {}): ScheduledTask => ({
    id, recipeIds: [], text: id, kind: "prep", activeMin: 5, passiveMin: 0, resources: [], dependsOn: [], holdMin: 0,
    lane: "prep", start, end: start + 5, cook: 1, ...extra,
  });

  it("shows the earliest ready task now and the following ones next", () => {
    const tasks = [task("a", 0), task("b", 5, { dependsOn: ["a"] }), task("c", 10), task("d", 15)];
    const f = focusTasks(tasks, {});
    expect(f.now.map((t) => t.id)).toEqual(["a"]);
    expect(f.next.map((t) => t.id)).toEqual(["b", "c", "d"]);
    const after = focusTasks(tasks, { a: true });
    expect(after.now.map((t) => t.id)).toEqual(["b"]);
    expect(after.doneCount).toBe(1);
  });

  it("gives each cook a task and skips hands-off waiting", () => {
    const tasks = [
      task("simmer", 0, { activeMin: 0, passiveMin: 30, lane: "stove" }),
      task("chop", 1),
      task("wash", 2, { cook: 2, lane: "clean" }),
      task("mix", 3),
    ];
    expect(focusTasks(tasks, {}, { cooks: 2 }).now.map((t) => t.id)).toEqual(["chop", "wash"]);
    expect(focusTasks(tasks, {}, { cooks: 1 }).now.map((t) => t.id)).toEqual(["chop"]);
  });

  it("still offers something when only waiting is left", () => {
    const tasks = [task("rest", 0, { activeMin: 0 })];
    expect(focusTasks(tasks, {}).now.map((t) => t.id)).toEqual(["rest"]);
    expect(focusTasks(tasks, { rest: true }).now).toEqual([]);
  });

  it("groups by lane in a fixed order", () => {
    const lanes = tasksByLane(FIXTURE_VIEW.session!.tasks).map((g) => g.lane);
    expect(lanes).toEqual(["prep", "stove", "oven", "other", "clean"]);
  });
});

describe("target estimator", () => {
  it("gives a rounded starting point", () => {
    const est = estimateTargets({ sex: "male", age: 40, weightLb: 200, heightIn: 70, activity: "moderate", goal: "maintain" })!;
    expect(est.kcal % 50).toBe(0);
    expect(est.kcal).toBeGreaterThan(2500);
    expect(est.kcal).toBeLessThan(3000);
    expect(est.protein).toBe(145);
  });

  it("eats less to lose and refuses odd inputs", () => {
    const base = { sex: "female" as const, age: 65, weightLb: 150, heightIn: 64, activity: "light" as const };
    const keep = estimateTargets({ ...base, goal: "maintain" })!;
    const lose = estimateTargets({ ...base, goal: "lose" })!;
    expect(lose.kcal).toBeLessThan(keep.kcal);
    expect(lose.protein).toBeGreaterThan(keep.protein);
    expect(estimateTargets({ ...base, goal: "maintain", age: 5 })).toBeNull();
  });
});

describe("labels and defaults", () => {
  it("splits labels into sheets", () => {
    const sheets = labelSheets(Array.from({ length: 25 }, (_, i) => i), { cols: 2, rows: 5 });
    expect(sheets.map((s) => s.length)).toEqual([10, 10, 5]);
  });

  it("says who and when for a label", () => {
    const setup = { session: { date: "2026-10-18", maxMinutes: 240, cooks: 1, helper: false, skill: "home" as const } };
    expect(labelSlotText({ plateKey: "p1:1:lunch", person: "Dan" }, setup)).toBe("Dan · Lunch Tue, Oct 20");
    expect(labelSlotText({ plateKey: "p1:1:lunch", person: "Dan" })).toBe("Dan · Lunch, day 2");
  });

  it("builds a calm default setup", () => {
    const s = defaultSetup({ today: "2026-10-13", ownerName: "Jean", allergies: ["peanuts"] });
    expect(s.people[0].name).toBe("Jean");
    expect(s.people[0].allergies).toEqual(["peanuts"]);
    expect(s.session.date).toBe("2026-10-18");
    expect(s.session.maxMinutes).toBe(240);
  });
});

describe("prepped share of the day", () => {
  it("covers each slot's share of the day", () => {
    expect(prepShare(["lunch", "dinner"])).toBeCloseTo(0.65);
    expect(prepShare(["breakfast", "lunch", "dinner", "snack"])).toBe(1);
  });

  it("says it plainly", () => {
    const person = { name: "Dan", slots: ["lunch", "dinner"] as const, targets: { kcal: 2200, protein: 150 } };
    expect(prepAimText({ ...person, slots: [...person.slots] }, { you: true })).toBe(
      "Your prepped lunches and dinners will cover about 1,430 of your 2,200 calories a day.",
    );
    expect(prepAimText({ ...person, slots: ["breakfast", "lunch", "dinner"] })).toBe(
      "Dan: prepped breakfasts, lunches and dinners will cover about 1,980 of 2,200 calories a day.",
    );
    expect(prepAimText({ ...person, slots: ["lunch"], targets: null })).toBeNull();
  });
});
