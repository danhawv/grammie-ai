// Runs the planner on the test fixtures and prints the plans readably.
//   npx tsx scripts/meal-prep/planner-demo.ts [scenario]
//   npx tsx scripts/meal-prep/planner-demo.ts --options [scenario]   (three plan options side by side)
import { createPlanner, stopSolver } from "../../server/meal-prep/planner/index";
import { formatOptions, formatPlan } from "../../server/meal-prep/planner/format";
import { adjusterFacts, dessertFacts, person, recipeFacts, scenarios, setupFor, shakeAdjusters } from "../../server/meal-prep/planner/test-fixtures";

const args = process.argv.slice(2);
const options = args.includes("--options");
const only = args.find((a) => !a.startsWith("--"));
const planner = createPlanner();
const all = [
  ...scenarios(),
  {
    // dessert three days a week, swaps allowed, shakes as well as chicken
    name: "lifter-dessert-shakes",
    setup: setupFor([person("sam", "Sam", { targets: { kcal: 2200, protein: 180 }, slots: ["lunch", "dinner", "dessert"] })], { dessertsPerWeek: 3 }),
    facts: [...recipeFacts(), ...dessertFacts()],
    adjusters: [...adjusterFacts(), ...shakeAdjusters()],
  },
];
for (const s of all) {
  if (only && s.name !== only) continue;
  const t0 = Date.now();
  if (options) {
    const opts = await planner.planOptions(s.setup, s.facts, s.adjusters);
    console.log(`\n===== ${s.name}: ${opts.length} options in ${Date.now() - t0} ms =====`);
    console.log(formatOptions(opts, s.facts, s.adjusters));
    continue;
  }
  const plan = await planner.plan(s.setup, s.facts, s.adjusters);
  console.log(`\n===== ${s.name} (${Date.now() - t0} ms wall, solverMs ${plan.solverMs}) =====`);
  console.log(formatPlan(plan, s.setup, s.facts, s.adjusters));
}
await stopSolver();
