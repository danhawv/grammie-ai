import { describe, expect, it } from "vitest";
import { heuristicSteps, normalizePrepForm, normalizeVessel, plainName, scaleTask, stepTempF, validateSteps } from "./structure";
import { AI_ANSWERS, SOURCES } from "./fixtures";
import type { RecipeTask } from "./types";

const source = (id: string) => SOURCES.find((s) => s.id === id)!;

function isAcyclic(tasks: RecipeTask[]): boolean {
  const seen = new Set<string>();
  for (const t of tasks) {
    if (!t.dependsOn.every((d) => seen.has(d))) return false; // ordered: deps first
    seen.add(t.id);
  }
  return true;
}

describe("validateSteps", () => {
  it("moves a long simmer's time from hands-on to waiting", () => {
    const v = validateSteps(AI_ANSWERS.chili, source("chili"))!;
    const simmer = v.tasks.find((t) => t.kind === "simmer")!;
    expect(simmer.activeMin).toBeLessThanOrEqual(5);
    expect(simmer.activeMin + simmer.passiveMin).toBe(45);
  });

  it("adds forgotten ingredient lines to a task, but not garnishes or serving items", () => {
    const v = validateSteps(AI_ANSWERS.chili, source("chili"))!;
    const used = new Set(v.tasks.flatMap((t) => t.ingredients.map((g) => g.index)));
    expect(used.has(3)).toBe(true); // beans
    expect(used.has(4)).toBe(true); // tomatoes
    expect(used.has(7)).toBe(false); // cheese for garnish
    expect(used.has(6)).toBe(false); // rice: "serve over the rice"
    // Beans went to the task that mentions them
    expect(v.tasks.find((t) => t.ingredients.some((g) => g.index === 3))!.text).toMatch(/beans/);
  });

  it("drops preheat tasks and reads Celsius oven temperatures", () => {
    const v = validateSteps(AI_ANSWERS.thighs, source("thighs"))!;
    expect(v.tasks.some((t) => /preheat/i.test(t.text))).toBe(false);
    const roast = v.tasks.find((t) => t.kind === "bake")!;
    expect(roast.heat).toBe("oven");
    expect(roast.tempF).toBe(430); // 220°C, rounded to 5°F
    expect(roast.dependsOn).not.toContain("t0");
  });

  it("normalizes vessel names", () => {
    const chili = validateSteps(AI_ANSWERS.chili, source("chili"))!;
    expect(chili.tasks.find((t) => t.kind === "cook")!.vessel).toBe("large pot");
    const tuna = validateSteps(AI_ANSWERS.tuna, source("tuna"))!;
    expect(tuna.tasks.find((t) => t.kind === "assemble")!.vessel).toBe("baking dish");
    expect(normalizeVessel("Baking sheet")).toBe("sheet pan");
    expect(normalizeVessel("large frying pan")).toBe("skillet");
  });

  it("breaks dependency loops and drops unknown ids", () => {
    const raw = {
      tasks: [
        { id: "a", text: "Brown the beef", kind: "cook", activeMin: 5, passiveMin: 0, heat: "burner", dependsOn: ["b", "zzz"], holdMin: 10, ingredients: [{ index: 0, fraction: 1 }], fromSteps: [1] },
        { id: "b", text: "Simmer everything", kind: "simmer", activeMin: 2, passiveMin: 20, heat: "burner", dependsOn: ["a"], holdMin: 10, ingredients: [], fromSteps: [2] },
      ],
      atServing: [],
    };
    const v = validateSteps(raw, source("chili"))!;
    expect(isAcyclic(v.tasks)).toBe(true);
    expect(v.tasks.find((t) => t.id === "a")!.dependsOn).toEqual([]);
    expect(v.fixes.join(" ")).toMatch(/loop/);
  });

  it("adds a cutting task when an ingredient needs cutting and no task cuts it", () => {
    const raw = {
      tasks: [{ id: "t1", text: "Toss the chicken and onion on a sheet pan", kind: "assemble", activeMin: 4, passiveMin: 0, heat: "none", dependsOn: [], holdMin: 30,
        ingredients: [{ index: 0, fraction: 1 }, { index: 1, fraction: 1, prep: "sliced" }, { index: 2, fraction: 1 }], fromSteps: [2] },
      { id: "t2", text: "Roast", kind: "bake", activeMin: 1, passiveMin: 35, heat: "oven", tempF: 425, dependsOn: ["t1"], holdMin: 20, ingredients: [], fromSteps: [2] }],
      atServing: [],
    };
    const v = validateSteps(raw, source("thighs"))!;
    const cut = v.tasks.find((t) => t.kind === "prep")!;
    expect(cut.text).toBe("Slice the onion");
    expect(v.tasks.find((t) => t.id === "t1")!.dependsOn).toContain(cut.id);
    expect(isAcyclic(v.tasks)).toBe(true);
  });

  it("returns null when there's nothing usable", () => {
    expect(validateSteps({ tasks: [] }, source("soup"))).toBeNull();
    expect(validateSteps("nonsense", source("soup"))).toBeNull();
  });

  it("pulls task times back toward the recipe's step times", () => {
    const raw = {
      tasks: [{ id: "t1", text: "Add the broth and simmer", kind: "simmer", activeMin: 2, passiveMin: 120, heat: "burner", dependsOn: [], holdMin: 30, ingredients: [], fromSteps: [2] }],
      atServing: [],
    };
    const v = validateSteps(raw, source("soup"))!;
    const t = v.tasks.find((x) => x.id === "t1")!;
    expect(t.activeMin + t.passiveMin).toBeLessThan(40);
  });
});

describe("heuristicSteps", () => {
  it("builds an ordered task list without AI", () => {
    for (const s of SOURCES) {
      const h = heuristicSteps(s);
      expect(h.tasks.length).toBeGreaterThan(0);
      expect(isAcyclic(h.tasks)).toBe(true);
    }
    const thighs = heuristicSteps(source("thighs"));
    const roast = thighs.tasks.find((t) => t.kind === "bake")!;
    expect(roast.tempF).toBe(428);
    expect(roast.passiveMin).toBeGreaterThan(25);
    const chili = heuristicSteps(source("chili"));
    expect(chili.atServing.join(" ")).toMatch(/rice/);
    expect(chili.tasks.some((t) => t.text === "Dice the onion")).toBe(true);
  });
});

describe("scaleTask", () => {
  it("grows chopping slower than the amount and leaves simmering about the same", () => {
    const chop = scaleTask({ kind: "prep", activeMin: 10, passiveMin: 0 }, 2);
    expect(chop.activeMin).toBeGreaterThan(10);
    expect(chop.activeMin).toBeLessThan(20);
    const simmer = scaleTask({ kind: "simmer", activeMin: 2, passiveMin: 60 }, 2);
    expect(simmer.passiveMin).toBeGreaterThanOrEqual(60);
    expect(simmer.passiveMin).toBeLessThanOrEqual(70);
    const half = scaleTask({ kind: "bake", activeMin: 2, passiveMin: 30 }, 0.5);
    expect(half.passiveMin).toBeLessThan(30);
    expect(half.passiveMin).toBeGreaterThan(25);
  });
});

describe("small helpers", () => {
  it("normalizes cuts", () => {
    expect(normalizePrepForm("finely chopped")).toBe("minced");
    expect(normalizePrepForm("cut into cubes")).toBe("diced");
    expect(normalizePrepForm("peeled and diced")).toBe("diced");
    expect(normalizePrepForm("melted")).toBeNull();
  });
  it("reads step temperatures", () => {
    expect(stepTempF({ text: "Bake", temperature: { value: 180, scale: "C" } })).toBe(356);
    expect(stepTempF({ text: "Bake at 400°F until golden" })).toBe(400);
  });
  it("names ingredients plainly", () => {
    expect(plainName("1 lb chix breast - cooked in cubes")).toBe("chix breast");
    expect(plainName("1 1/2 T chopped hot cherry peppers")).toBe("hot cherry peppers");
  });
});
