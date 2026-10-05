import { useState, useEffect } from "react";
import type { UnitSystem } from "@shared/units";

// Viewer-wide unit preference (As written / Metric / US), shared by the
// recipe page, step ingredients, and cooking mode.
//
// The default comes from the account's Display setting ("Units" on the Me
// page, saved in users.preferences.display.units). <DisplayPrefsApplier />
// calls applyAccountUnitDefault() when that preference loads or changes.
// localStorage keeps the last value for an instant first paint and for
// signed-out viewers.
//
// The toggle on a recipe (the setter returned by useUnitSystem) changes the
// units everywhere on this device, as it always has; it does not change the
// saved account default, which is re-applied on the next app start.

const STORAGE_KEY = "grammie-unit-system";
let current: UnitSystem = "original";
const listeners = new Set<(s: UnitSystem) => void>();

function isUnitSystem(v: unknown): v is UnitSystem {
  return v === "metric" || v === "us" || v === "original";
}

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (isUnitSystem(saved)) current = saved;
} catch {
  // storage unavailable — default stands
}

function setCurrent(s: UnitSystem) {
  current = s;
  try { localStorage.setItem(STORAGE_KEY, s); } catch { /* per-viewer nicety only */ }
  listeners.forEach((fn) => fn(s));
}

/** Apply the account's saved default (from the Display preference). */
export function applyAccountUnitDefault(s: UnitSystem | undefined | null) {
  if (isUnitSystem(s) && s !== current) setCurrent(s);
}

export function useUnitSystem(): [UnitSystem, (s: UnitSystem) => void] {
  const [system, setSystem] = useState<UnitSystem>(current);

  useEffect(() => {
    listeners.add(setSystem);
    // Catch a change that happened between render and subscribe
    setSystem(current);
    return () => { listeners.delete(setSystem); };
  }, []);

  return [system, setCurrent];
}
