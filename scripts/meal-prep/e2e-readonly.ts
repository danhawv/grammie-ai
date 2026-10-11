// Read-only end-to-end run on the live recipes: food facts -> planner -> session.
// Only SELECTs reach the database; structured steps are kept in memory
// (Gemini structures the chosen recipes, a few cents).
//   npx tsx --env-file=.env scripts/meal-prep/e2e-readonly.ts <previous-run.json with setup and titles> <out.json>
import fs from "node:fs";
import { getSharedPool } from "../../server/pg-pool.ts";
import { createFoodData } from "../../server/meal-prep/food/index.ts";
import { createPlanner, stopSolver } from "../../server/meal-prep/planner/index.ts";
import { formatPlan } from "../../server/meal-prep/planner/format.ts";
import { createSessionBuilder } from "../../server/meal-prep/session/index.ts";
import { memoryStepStore } from "../../server/meal-prep/session/step-store.ts";

const prev = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const pool = getSharedPool();
// Guard: only SELECTs reach the database
const query = async (sql: string, params?: unknown[]) => {
  if (!/^\s*(SELECT|WITH)\b/i.test(sql)) throw new Error("read-only run: refused " + sql.slice(0, 40));
  return pool.query(sql, params as any[]);
};
const food = createFoodData({ query });
const ids = Object.keys(prev.titles);
const t0 = Date.now();
const facts = await food.factsFor(ids);
const adjusters = await food.adjusters();
console.log(`facts for ${facts.length} recipes in ${Date.now() - t0} ms; with equipment: ${facts.filter((f) => f.equipment?.length).length}`);
const setup = prev.setup;
const planner = createPlanner();
const builder = createSessionBuilder({ stepStore: memoryStepStore() });
// Same loop as planWithinSession in server/meal-prep/service.ts: if the real
// session runs over 110% of the limit, plan again with a shorter budget.
const limit = setup.session.maxMinutes;
let budget = limit;
let best: { plan: any; s: any; attempt: number } | null = null;
for (let attempt = 0; attempt < 3; attempt++) {
  const planSetup = { ...setup, session: { ...setup.session, maxMinutes: Math.round(budget) } };
  const plan = await planner.plan(planSetup, facts, adjusters);
  const s = await builder.session(setup, plan, facts, adjusters);
  const estimate = plan.notes.find((n) => n.includes("hands-on work"));
  console.log(`attempt ${attempt + 1}: budget ${Math.round(budget)} min -> session ${s.totalMinutes} min (hands-on ${s.handsOnMinutes}); planner: ${estimate}; fit ${plan.fitScore}`);
  if (!best || s.totalMinutes < best.s.totalMinutes) best = { plan, s, attempt: attempt + 1 };
  if (s.totalMinutes <= limit * 1.1 || plan.fitScore < 50) break;
  budget = budget * (limit / s.totalMinutes) * 0.95;
}
const { plan, s } = best!;
console.log(`\nKEPT attempt ${best!.attempt}`);
console.log(formatPlan(plan, setup, facts, adjusters));
console.log(`\nSESSION: ${s.tasks.length} tasks, total ${s.totalMinutes} min, hands-on ${s.handsOnMinutes} min; equipment: ${s.equipment.join(", ")}`);
console.log("WARNINGS:", s.warnings);
fs.writeFileSync(process.argv[3], JSON.stringify({ setup, plan, session: s, titles: prev.titles }, null, 1));
await stopSolver();
await pool.end();
