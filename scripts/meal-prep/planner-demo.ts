// Runs the planner on the test fixtures and prints the plans readably.
//   npx tsx scripts/meal-prep/planner-demo.ts [scenario]
import { createPlanner, stopSolver } from "../../server/meal-prep/planner/index";
import { formatPlan } from "../../server/meal-prep/planner/format";
import { scenarios } from "../../server/meal-prep/planner/test-fixtures";

const only = process.argv[2];
const planner = createPlanner();
for (const s of scenarios()) {
  if (only && s.name !== only) continue;
  const t0 = Date.now();
  const plan = await planner.plan(s.setup, s.facts, s.adjusters);
  console.log(`\n===== ${s.name} (${Date.now() - t0} ms wall, solverMs ${plan.solverMs}) =====`);
  console.log(formatPlan(plan, s.setup, s.facts, s.adjusters));
}
await stopSolver();
