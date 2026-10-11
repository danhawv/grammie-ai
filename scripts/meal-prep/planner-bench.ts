// Times the planner's solver on each scenario at a few time limits.
//   npx tsx scripts/meal-prep/planner-bench.ts
import { buildModel, prepare } from "../../server/meal-prep/planner/model";
import { solveLp, stopSolver } from "../../server/meal-prep/planner/solver";
import { greedyStart } from "../../server/meal-prep/planner/start";
import { scenarios } from "../../server/meal-prep/planner/test-fixtures";

for (const s of scenarios()) {
  const P = prepare(s.setup, s.facts, s.adjusters);
  const B = buildModel(P);
  const lp = B.lp.toString();
  const start = process.env.NOSTART ? undefined : greedyStart(P, B);
  const row: string[] = [`${s.name.padEnd(24)} ${JSON.stringify(B.lp.size)}`];
  for (const t of [0.5, 1, 3, 10]) {
    const r = await solveLp(lp, { timeLimit: t, mipGap: 0.02, start });
    row.push(`t=${t}: ${r.status === "Optimal" ? "opt" : r.status} obj=${r.objective?.toFixed(1)} ${r.ms}ms start=${r.startUsed}`);
  }
  console.log(row.join("\n   "));
}
await stopSolver();
