import { defaultFilters, type FiltersState } from "./filters";

// Persists the home page's browsing state (filters, sort, collection, view)
// across navigation, so clicking into a recipe and coming back doesn't wipe
// the filters the user set. sessionStorage on purpose: state survives the
// round-trip but resets when the tab closes, so stale filters don't linger
// for days.

const KEY = "grammie-home-state-v1";

export interface PersistedHomeState {
  filters: FiltersState;
  sortBy: string;
  collectionFilter: string;
  viewMode: string;
  selectedCookbookIds: number[];
  selectedCreatorId?: string;
}

export function loadHomeState(): Partial<PersistedHomeState> {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveHomeState(state: PersistedHomeState): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage unavailable (private mode, quota) — persistence is a nicety
  }
}

/** Merge saved filters over defaults so new filter fields added later don't break old saved state */
export function restoreFilters(saved?: Partial<FiltersState>): FiltersState {
  if (!saved) return defaultFilters;
  return {
    ...defaultFilters,
    ...saved,
    dietary: { ...defaultFilters.dietary, ...(saved.dietary || {}) },
  };
}
