import { useEffect, useState } from "react";
import { usePreferences } from "@/hooks/use-preferences";
import { applyAccountUnitDefault } from "@/hooks/use-unit-system";
import { getDisplayPrefs, isTextSize, type TextSize } from "@shared/food-profile";

// Display preferences (Me → Display): text size and the default units.
//
// Text size sets html[data-text-size] ("large" | "xlarge"; no attribute for
// the default), which scales every rem-based size (client/src/index.css).
// The last value is kept in localStorage so the first paint is already the
// right size and signed-out visitors keep their choice; once the signed-in
// user's saved preference loads, it wins.

const TEXT_SIZE_KEY = "grammie-text-size";
let currentTextSize: TextSize = "default";
const listeners = new Set<(s: TextSize) => void>();

function applyTextSizeToDocument(size: TextSize) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (size === "default") root.removeAttribute("data-text-size");
  else root.setAttribute("data-text-size", size);
}

try {
  const saved = localStorage.getItem(TEXT_SIZE_KEY);
  if (isTextSize(saved)) currentTextSize = saved;
} catch {
  // storage unavailable — default stands
}
// Runs when the app bundle loads, before React renders
applyTextSizeToDocument(currentTextSize);

export function setTextSize(size: TextSize) {
  currentTextSize = size;
  applyTextSizeToDocument(size);
  try { localStorage.setItem(TEXT_SIZE_KEY, size); } catch { /* per-device nicety */ }
  listeners.forEach((fn) => fn(size));
}

export function useTextSize(): [TextSize, (s: TextSize) => void] {
  const [size, setSize] = useState<TextSize>(currentTextSize);
  useEffect(() => {
    listeners.add(setSize);
    setSize(currentTextSize);
    return () => { listeners.delete(setSize); };
  }, []);
  return [size, setTextSize];
}

/**
 * Applies the signed-in user's saved Display preferences (text size and
 * default units) when they load or change. Mount once, at app start.
 */
export function useDisplayPrefs() {
  const { preferences } = usePreferences();
  const { textSize, units } = getDisplayPrefs(preferences);

  useEffect(() => {
    if (textSize && textSize !== currentTextSize) setTextSize(textSize);
  }, [textSize]);

  useEffect(() => {
    applyAccountUnitDefault(units);
  }, [units]);
}

export function DisplayPrefsApplier() {
  useDisplayPrefs();
  return null;
}
