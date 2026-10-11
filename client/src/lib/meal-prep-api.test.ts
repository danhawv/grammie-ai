import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_SETUP, FIXTURE_VIEW } from "./meal-prep-fixtures";
import { defaultsFromSetup, errorText, MealPrepApiError, mealPrepApi, setupFromDefaults } from "./meal-prep-api";
import { defaultSetup } from "./meal-prep-format";

function reply(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("meal prep api client", () => {
  it("returns a plan that finished building straight away", async () => {
    const fetch = vi.fn(() => reply(201, FIXTURE_VIEW));
    vi.stubGlobal("fetch", fetch);
    const view = await mealPrepApi.createPlan(FIXTURE_SETUP);
    expect(view.id).toBe(FIXTURE_VIEW.id);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("/api/meal-prep/plans");
  });

  it("polls a 202 build until it's ready", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockImplementationOnce(() => reply(202, { id: "p1", buildStatus: "building", poll: "/api/meal-prep/plans/p1" }))
      .mockImplementationOnce(() => reply(200, { ...FIXTURE_VIEW, id: "p1", buildStatus: "building", plan: null }))
      .mockImplementationOnce(() => reply(200, { ...FIXTURE_VIEW, id: "p1" }));
    vi.stubGlobal("fetch", fetch);
    const pending = mealPrepApi.createPlan(FIXTURE_SETUP);
    await vi.advanceTimersByTimeAsync(4100);
    const view = await pending;
    expect(view.buildStatus).toBe("ready");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2][0]).toBe("/api/meal-prep/plans/p1");
  });

  it("keeps the server's plain-words error", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply(409, { error: "This plan is already approved. Start a new plan to change it." })));
    const err = await mealPrepApi.approve("p1", { addToCalendar: true, addToGroceryList: true, groceryMode: "add_to_existing" }).catch((e) => e);
    expect(err).toBeInstanceOf(MealPrepApiError);
    expect(errorText(err)).toBe("This plan is already approved. Start a new plan to change it.");
    expect(errorText(new Error("500: boom"))).toBe("Check your connection and try again.");
  });

  it("explains a switched-off feature", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("", { status: 503 }))));
    const err = await mealPrepApi.getProfile().catch((e) => e);
    expect(errorText(err)).toBe("Meal prep isn't switched on yet.");
  });

  it("treats Instacart 501 as not available", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply(501, { error: "Not set up", code: "instacart_not_configured" })));
    expect(await mealPrepApi.instacart("p1")).toBeNull();
  });
});

describe("profile defaults", () => {
  it("round-trips a setup without its date", () => {
    const base = defaultSetup({ today: "2026-10-13" });
    const defaults = defaultsFromSetup(FIXTURE_SETUP);
    expect("date" in (defaults.session ?? {})).toBe(false);
    const back = setupFromDefaults(defaults, base);
    expect(back.people).toEqual(FIXTURE_SETUP.people);
    expect(back.session.helper).toBe(true);
    expect(back.session.date).toBe("2026-10-18"); // the fresh upcoming Sunday
  });

  it("falls back to the fresh setup when nothing is saved", () => {
    const base = defaultSetup({ today: "2026-10-13", ownerName: "Jean" });
    expect(setupFromDefaults({}, base).people[0].name).toBe("Jean");
    expect(setupFromDefaults(undefined, base)).toBe(base);
  });
});
