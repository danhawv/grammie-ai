// Adds one ingredient line to the meal-plan grocery tally. Lines merge only
// on the same name + recipe unit (groceryMergeKey), so two lines with the
// same key always convert the same way and their amounts can be added even
// when the unit has no base conversion ("2 cloves" + "1 clove"). Before this
// helper an unconvertible repeat replaced the earlier line and its amount
// was lost.

export interface AggregatedGroceryItem<P> {
  item: string;
  quantity: number;
  unit: string;
  displayName: string;
  aisle: string;
  category: string | null;
  emoji: string | null;
  originalEntries: P[];
}

export function addToGroceryAggregate<P>(
  aggregated: Map<string, AggregatedGroceryItem<P>>,
  key: string,
  line: Omit<AggregatedGroceryItem<P>, "originalEntries">,
  provenance: P,
): void {
  const existing = aggregated.get(key);
  if (existing) {
    existing.quantity += line.quantity;
    existing.originalEntries.push(provenance);
    return;
  }
  aggregated.set(key, { ...line, originalEntries: [provenance] });
}
