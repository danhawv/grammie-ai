// Prints a PrepPlan as plain text (debugging, demos, logs).

import type { Adjuster, PlanOption, PrepPlan, PrepSetup, RecipeFacts } from "@shared/meal-prep/contract";

export function formatPlan(plan: PrepPlan, setup: PrepSetup, facts: RecipeFacts[], adjusters: Adjuster[]): string {
  const title = (id: string) => facts.find((f) => f.recipeId === id)?.title ?? adjusters.find((a) => a.id === id)?.name ?? id;
  const out: string[] = [];
  out.push(`Fit score ${plan.fitScore}/100, solved in ${plan.solverMs} ms`);
  out.push("Cook:");
  for (const b of plan.batches) out.push(`  ${b.scale}x ${title(b.recipeId)} -> ${b.servingsMade} servings${b.swapIds?.length ? ` (swaps: ${b.swapIds.join(", ")})` : ""}`);
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
  if (plan.swapsApplied?.length) out.push("Swaps:", ...plan.swapsApplied.map((x) => `  - ${title(x.recipeId)}: ${x.note}`));
  if (plan.notes.length) out.push("Notes:", ...plan.notes.map((n) => "  - " + n));
  if (plan.relaxed.length) out.push("Gave way:", ...plan.relaxed.map((n) => "  - " + n));
  return out.join("\n");
}

/** Plan options side by side, short: label, summary, dishes, swaps and top-ups. */
export function formatOptions(options: PlanOption[], facts: RecipeFacts[], adjusters: Adjuster[]): string {
  const title = (id: string) => facts.find((f) => f.recipeId === id)?.title ?? adjusters.find((a) => a.id === id)?.name ?? id;
  const out: string[] = [];
  options.forEach((o, i) => {
    out.push(`${i + 1}. ${o.label}  [${o.key}]  fit ${o.plan.fitScore}/100, ${o.plan.solverMs} ms`);
    out.push(`   ${o.summary}`);
    out.push(`   Dishes: ${o.plan.batches.map((b) => `${title(b.recipeId)} (${b.scale}x)`).join(", ")}`);
    for (const x of o.plan.swapsApplied ?? []) out.push(`   Swap: ${title(x.recipeId)} - ${x.note}`);
    for (const n of o.plan.notes.filter((n) => n.startsWith("Added"))) out.push(`   ${n}`);
    for (const r of o.plan.relaxed) out.push(`   Gave way: ${r}`);
  });
  return out.join("\n");
}
