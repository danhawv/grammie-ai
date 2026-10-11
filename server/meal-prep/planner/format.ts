// Prints a PrepPlan as plain text (debugging, demos, logs).

import type { Adjuster, PrepPlan, PrepSetup, RecipeFacts } from "@shared/meal-prep/contract";

export function formatPlan(plan: PrepPlan, setup: PrepSetup, facts: RecipeFacts[], adjusters: Adjuster[]): string {
  const title = (id: string) => facts.find((f) => f.recipeId === id)?.title ?? adjusters.find((a) => a.id === id)?.name ?? id;
  const out: string[] = [];
  out.push(`Fit score ${plan.fitScore}/100, solved in ${plan.solverMs} ms`);
  out.push("Cook:");
  for (const b of plan.batches) out.push(`  ${b.scale}x ${title(b.recipeId)} -> ${b.servingsMade} servings`);
  for (const [id, g] of Object.entries(plan.adjusterCooking)) out.push(`  ${g} g ${title(id)}`);
  for (const p of setup.people) {
    out.push(`${p.name}:`);
    for (let d = 0; d < setup.days; d++) {
      const plates = plan.plates.filter((x) => x.personId === p.id && x.day === d);
      const fit = plan.fit.find((f) => f.personId === p.id && f.day === d);
      const desc = plates.map((x) => `${x.slot}: ${x.items.map((i) => (i.kind === "recipe" ? `${i.amount}x ${title(i.refId)}` : `${i.amount} g ${title(i.refId)}`)).join(" + ")} (${x.macros.kcal} kcal, ${x.macros.protein} P)${x.storage === "freezer" ? " [freezer]" : ""}`);
      const m = fit?.macros;
      const t = fit?.target;
      const st = fit && fit.target ? Object.entries(fit.status).filter(([, s]) => s !== "n/a").map(([k, s]) => `${k} ${s}`).join(", ") : "";
      out.push(`  day ${d + 1}: ${desc.join(" | ")}`);
      if (m) out.push(`         ${m.kcal} kcal, ${m.protein} P, ${m.carbs} C, ${m.fat} F${t ? `  (aim ${t.kcal} kcal, ${t.protein} P${t.carbs ? `, ${t.carbs} C` : ""}${t.fat ? `, ${t.fat} F` : ""}; ${st})` : ""}`);
    }
  }
  if (plan.notes.length) out.push("Notes:", ...plan.notes.map((n) => "  - " + n));
  if (plan.relaxed.length) out.push("Gave way:", ...plan.relaxed.map((n) => "  - " + n));
  return out.join("\n");
}
