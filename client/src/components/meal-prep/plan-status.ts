import type { PrepPlanSummary } from "@shared/meal-prep/api";

/** Where a plan stands, in a few plain words, for lists of plans */
export function planStatusText(p: PrepPlanSummary): string {
  if (p.buildStatus === "building") return "Still being planned";
  if (p.buildStatus === "failed") return "Didn't finish · try again";
  if (p.unseenSubstitutions > 0) return "Your cook swapped an ingredient";
  return p.status === "draft" ? "Waiting for your OK" : p.status === "approved" ? "Approved · ready to shop" : p.status === "done" ? "Done" : "Cancelled";
}
