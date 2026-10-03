// Ingredient formatting shared by the PDF generator (server) and the print
// preview (client) so the printed book always matches the on-screen preview.

// Pseudo-units from ingredient normalization that read as data artifacts in
// print ("4 unit shallots") — the bare quantity is what a cook expects.
const COUNT_UNITS = new Set(["unit", "units", "unité", "each", "ea", "piece", "pieces", "pc", "pcs", "whole", "count", "item", "items"]);

/** Format a numeric quantity + unit as a cook-friendly string, e.g. 0.5/"cup" → "1/2 cup" */
export function formatIngredientQuantity(quantity: number | undefined, unit: string | undefined): string {
  if (!quantity) return "";
  if (unit && COUNT_UNITS.has(unit.trim().toLowerCase())) unit = undefined;
  const fractionMap: Record<number, string> = {
    0.25: "1/4", 0.33: "1/3", 0.5: "1/2", 0.66: "2/3", 0.75: "3/4",
    0.125: "1/8", 0.375: "3/8", 0.625: "5/8", 0.875: "7/8",
  };
  const whole = Math.floor(quantity);
  const decimal = quantity - whole;
  let quantityStr = "";
  if (whole > 0) quantityStr = whole.toString();
  const closestFraction = Object.keys(fractionMap)
    .map(Number)
    .find(f => Math.abs(decimal - f) < 0.05);
  if (closestFraction) {
    quantityStr += (whole > 0 ? " " : "") + fractionMap[closestFraction];
  } else if (decimal > 0) {
    quantityStr = quantity.toFixed(1).replace(/\.0$/, "");
  }
  if (unit) quantityStr += ` ${unit}`;
  return quantityStr.trim();
}

/**
 * One display line for a normalized ingredient. Stored entries use `item` for
 * the ingredient name (`name` and `raw` are fallbacks for older data).
 */
export function formatNormalizedIngredient(ing: {
  quantity?: number;
  unit?: string;
  item?: string;
  name?: string;
  raw?: string;
  preparation?: string | null;
}): string {
  const name = ing.item || ing.name || "";
  const qty = formatIngredientQuantity(ing.quantity, ing.unit);
  let text = [qty, name].filter(Boolean).join(" ");
  if (text && ing.preparation) text += `, ${ing.preparation}`;
  return text || ing.raw || "";
}
