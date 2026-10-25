// How a grocery item's amount reads in the user's chosen units. Items store a
// total in a base unit (g, ml or count) plus the recipe lines they came from.
// US: recipe amounts already in US units stay as written ("2 cups"); grams
// and millilitres become oz/lb or cups/tbsp/tsp. Metric: everything weighable
// or measurable shows in g/kg or ml/L.

import { convertToDisplayUnit, formatQuantityForDisplay } from "../unit-conversion";

export type UnitSystem = "us" | "metric";

export interface GroceryEntry { quantity: number; unit: string }

export interface GroceryDisplay {
  displayQuantity: number;
  displayUnit: string;
  displayText: string;
}

const METRIC_UNITS = new Set(["g", "gram", "grams", "kg", "kilogram", "kilograms", "ml", "milliliter", "milliliters", "millilitre", "millilitres", "l", "liter", "liters", "litre", "litres"]);

/** Recipe-style amounts: 0.5 → "1/2", 1.25 → "1.3" */
export function formatQty(qty: number): string {
  if (qty === 0.25) return "1/4";
  if (qty === 0.5) return "1/2";
  if (qty === 0.75) return "3/4";
  if (qty === 0.33 || qty === 0.333) return "1/3";
  if (qty === 0.67 || qty === 0.666) return "2/3";
  if (Number.isInteger(qty)) return qty.toString();
  return qty.toFixed(1).replace(/\.0$/, "");
}

export function groceryDisplay(
  item: { quantity: number; unit: string },
  entries: GroceryEntry[] | null | undefined,
  system: UnitSystem,
): GroceryDisplay {
  const metric = system === "metric";

  // US: keep the recipe's own US units when every line used the same one
  if (!metric && entries?.length) {
    const first = (entries[0].unit || "").toLowerCase().trim();
    const same = entries.every((e) => (e.unit || "").toLowerCase().trim() === first);
    if (same && !METRIC_UNITS.has(first)) {
      const total = entries.reduce((sum, e) => sum + (Number(e.quantity) || 0), 0);
      return { displayQuantity: total, displayUnit: entries[0].unit, displayText: `${formatQty(total)} ${entries[0].unit}`.trim() };
    }
  }

  // Weights and volumes convert to the chosen system
  if (item.unit === "g" || item.unit === "ml") {
    const shown = convertToDisplayUnit(item.quantity, item.unit, metric);
    return {
      displayQuantity: shown.quantity,
      displayUnit: shown.unit,
      displayText: formatQuantityForDisplay(shown.quantity, shown.unit, metric),
    };
  }

  // Counts and units we can't convert stay as they are
  const unit = item.unit === "count" ? "" : item.unit;
  return { displayQuantity: item.quantity, displayUnit: unit, displayText: `${formatQty(item.quantity)} ${unit}`.trim() };
}
