// Lulu requires US state codes as two uppercase letters ("OH"), so accept
// whatever people type ("Ohio", "oh", " Oh. ") and convert it.

const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  "washington dc": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE",
  nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "puerto rico": "PR", guam: "GU",
  "american samoa": "AS", "us virgin islands": "VI", "virgin islands": "VI",
  "northern mariana islands": "MP",
};

const US_CODES = new Set(Object.values(US_STATES).concat(["AA", "AE", "AP", "FM", "MH", "PW"]));

/** Returns the two-letter code for a US state, or null if it isn't recognized. */
export function normalizeUsState(input: string | undefined | null): string | null {
  const cleaned = (input ?? "").trim().replace(/\./g, "").replace(/\s+/g, " ");
  if (!cleaned) return null;
  const upper = cleaned.toUpperCase();
  if (upper.length === 2 && US_CODES.has(upper)) return upper;
  return US_STATES[cleaned.toLowerCase()] ?? null;
}
