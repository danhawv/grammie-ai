import { useState, useEffect } from "react";
import type { UnitSystem } from "@shared/units";

// Viewer-wide unit preference (As written / Metric / US), shared by the
// recipe page, step ingredients, and cooking mode. Persisted per browser.

const STORAGE_KEY = "grammie-unit-system";
let current: UnitSystem = "original";
const listeners = new Set<(s: UnitSystem) => void>();

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "metric" || saved === "us" || saved === "original") current = saved;
} catch {
  // storage unavailable — default stands
}

export function useUnitSystem(): [UnitSystem, (s: UnitSystem) => void] {
  const [system, setSystem] = useState<UnitSystem>(current);

  useEffect(() => {
    listeners.add(setSystem);
    return () => { listeners.delete(setSystem); };
  }, []);

  const update = (s: UnitSystem) => {
    current = s;
    try { localStorage.setItem(STORAGE_KEY, s); } catch { /* per-viewer nicety only */ }
    listeners.forEach((fn) => fn(s));
  };

  return [system, update];
}
