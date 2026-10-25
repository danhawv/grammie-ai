import { describe, expect, it } from "vitest";
import type { PrepPlanStatus } from "@shared/meal-prep/api";
import { addDays, currentPlan, nextEatingDay, nextSessionDate, setupFromProfile } from "./this-week";
import { sampleSetup } from "./testing/fakes";

/** A plan cooked on `date` (eaten from the day after), made `createdAt` */
function plan(id: string, status: PrepPlanStatus, date: string, createdAt: string, days = 3) {
  const setup = sampleSetup({ days, session: { ...sampleSetup().session, date } });
  return { id, status, setup, sessionDate: date, createdAt: new Date(createdAt) };
}

describe("currentPlan", () => {
  it("picks the newest draft or approved plan whose eating days aren't over", () => {
    const plans = [
      plan("old", "approved", "2026-10-04", "2026-10-01"), // eaten Oct 5-7, long gone
      plan("a", "approved", "2026-10-11", "2026-10-08"), // eaten Oct 12-14
      plan("b", "draft", "2026-10-11", "2026-10-09"), // same week, newer
    ];
    expect(currentPlan(plans, "2026-10-13")?.id).toBe("b");
    // the last eating day still counts
    expect(currentPlan(plans, "2026-10-14")?.id).toBe("b");
    expect(currentPlan(plans, "2026-10-15")).toBeNull();
  });

  it("ignores cancelled and finished plans", () => {
    const plans = [plan("x", "cancelled", "2026-10-11", "2026-10-10"), plan("y", "done", "2026-10-11", "2026-10-11")];
    expect(currentPlan(plans, "2026-10-12")).toBeNull();
  });

  it("prefers a plan that starts within the week over a newer one far ahead", () => {
    const plans = [
      plan("thisWeek", "draft", "2026-10-18", "2026-10-10"),
      plan("nextMonth", "draft", "2026-11-15", "2026-10-16"),
    ];
    expect(currentPlan(plans, "2026-10-17")?.id).toBe("thisWeek");
    // nothing sooner: the far one is the only one
    expect(currentPlan(plans.slice(1), "2026-10-17")?.id).toBe("nextMonth");
  });
});

describe("eating days and the next cooking day", () => {
  it("finds the first eating day that is today or later", () => {
    const setup = sampleSetup(); // cooked Oct 18, eaten Oct 19-21
    expect(nextEatingDay(setup, "2026-10-17")).toBe(0);
    expect(nextEatingDay(setup, "2026-10-20")).toBe(1);
    expect(nextEatingDay(setup, "2026-10-22")).toBeNull();
  });

  it("cooks on the same weekday as last time, else Sunday; today counts", () => {
    const sat = "2026-10-17";
    expect(nextSessionDate([], sat)).toBe("2026-10-18");
    expect(nextSessionDate([], "2026-10-18")).toBe("2026-10-18");
    // last plan cooked on a Wednesday (Oct 14); the one before on a Sunday is older
    const plans = [
      { sessionDate: "2026-10-04", createdAt: new Date("2026-10-01") },
      { sessionDate: "2026-10-14", createdAt: new Date("2026-10-12") },
    ];
    expect(nextSessionDate(plans, sat)).toBe("2026-10-21");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
});

describe("setupFromProfile", () => {
  it("fills a full setup from the saved answers with the dish pinned", () => {
    const { people, kitchen } = sampleSetup();
    const setup = setupFromProfile({ people, kitchen, days: 4, session: { maxMinutes: 180, cooks: 2, helper: true, skill: "pro" }, topUps: "none" }, "2026-10-18", ["r3"]);
    expect(setup).toMatchObject({
      days: 4,
      pinnedRecipeIds: ["r3"],
      topUps: "none",
      session: { date: "2026-10-18", maxMinutes: 180, cooks: 2, helper: true, skill: "pro" },
    });
    const sparse = setupFromProfile({ people, kitchen }, "2026-10-18", ["r3"])!;
    expect(sparse.days).toBe(5);
    expect(sparse.session).toEqual({ date: "2026-10-18", maxMinutes: 240, cooks: 1, helper: false, skill: "home" });
  });

  it("gives up without people or a kitchen", () => {
    const { people, kitchen } = sampleSetup();
    expect(setupFromProfile({ kitchen }, "2026-10-18", ["r3"])).toBeNull();
    expect(setupFromProfile({ people: [] , kitchen }, "2026-10-18", ["r3"])).toBeNull();
    expect(setupFromProfile({ people }, "2026-10-18", ["r3"])).toBeNull();
  });
});
