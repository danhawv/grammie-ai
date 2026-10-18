// Plan options on the food-data fixtures (real family recipes), printed readably.
//   MP_FIXTURES_DIR=<dir> npx tsx scripts/meal-prep/planner-options-real.ts   (FULL=1 also prints the first plan)
import fs from "node:fs";
import { createPlanner, stopSolver } from "../../server/meal-prep/planner/index";
import { formatOptions, formatPlan } from "../../server/meal-prep/planner/format";
import { person, setupFor } from "../../server/meal-prep/planner/test-fixtures";
const dir = process.env.MP_FIXTURES_DIR ?? "shared/meal-prep/fixtures";
const facts = JSON.parse(fs.readFileSync(dir + "/recipe-facts.json", "utf8"));
const adjusters = JSON.parse(fs.readFileSync(dir + "/adjusters.json", "utf8"));
const planner = createPlanner();
const setups = {
  lifter: setupFor([person("sam", "Sam", { targets: { kcal: 2200, protein: 180 }, slots: ["breakfast", "lunch", "dinner", "dessert"] })], { dessertsPerWeek: 3 }),
  family: setupFor([
    person("mom", "Mom", { targets: { kcal: 1800, protein: 120 }, allergies: ["tree nuts"], slots: ["lunch", "dinner", "dessert"] }),
    person("gpa", "Grandpa", { slots: ["dinner", "dessert"], dislikes: ["shrimp"] }),
  ], { days: 6, topUps: "shake" }),
};
for (const [name, setup] of Object.entries(setups)) {
  const t0 = Date.now();
  const opts = await planner.planOptions(setup, facts, adjusters);
  console.log(`\n===== ${name}: ${opts.length} options in ${Date.now() - t0} ms =====`);
  console.log(formatOptions(opts, facts, adjusters));
  if (process.env.FULL) console.log(formatPlan(opts[0].plan, setup, facts, adjusters));
}
await stopSolver();
