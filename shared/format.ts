// Small display formatters shared by the client (recipe cards, lists) and any
// server-rendered text. Keep wording plain: "1 serving", "45 min", "3 days".

/** "1 recipe", "2 recipes"; pass `plural` for irregular words */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/**
 * Human cook time from minutes. Returns null when there's nothing worth
 * showing (missing, zero, negative, not a number), so callers can hide it.
 *
 *   20 -> "20 min", 60 -> "1 hr", 90 -> "1 hr 30 min",
 *   1950 (32.5 hr) -> "1 day 9 hr", 4350 (72 hr 30 min) -> "3 days"
 */
export function formatDuration(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  const total = Math.round(minutes);
  if (total < 1) return "1 min";
  if (total < 60) return `${total} min`;

  const DAY = 24 * 60;
  if (total < DAY) {
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    return mins ? `${hours} hr ${mins} min` : `${hours} hr`;
  }

  // A day or more: minutes stop mattering. Under two days, keep whole hours
  // ("1 day 6 hr"); beyond that, round to the nearest day ("3 days").
  if (total < 2 * DAY) {
    const hours = Math.round((total - DAY) / 60);
    if (hours === 0) return "1 day";
    if (hours >= 24) return "2 days";
    return `1 day ${hours} hr`;
  }
  return pluralize(Math.round(total / DAY), "day");
}

/** "1 serving", "4 servings"; null when unknown */
export function formatServings(servings: number | null | undefined): string | null {
  if (servings == null || !Number.isFinite(servings) || servings <= 0) return null;
  return pluralize(servings, "serving");
}

/** "45 min · 4 servings" — whichever parts are known, or null */
export function formatTimeAndServings(
  minutes: number | null | undefined,
  servings: number | null | undefined,
): string | null {
  const parts = [formatDuration(minutes), formatServings(servings)].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
