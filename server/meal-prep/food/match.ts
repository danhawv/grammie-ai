// Ingredient names -> canonical ingredient ids. Recipes say the same thing
// many ways ("onion", "onions", "1 medium yellow onion, diced", "Fresh
// Cilantro"), so names are normalized the same way on both sides (catalog
// aliases and recipe items) and looked up exactly first; then we try
// dropping words and finally a trigram similarity. Every match carries a
// confidence so a doubtful one can be shown with "≈" or sent to review.

export interface MatchResult {
  id: string;
  /** 0..1 */
  score: number;
  method: "exact" | "normalized" | "head" | "trigram" | "ai" | "manual";
}

// Words that describe the state or quality of an ingredient, not what it is
const DROP_WORDS = new Set([
  "fresh", "freshly", "chopped", "finely", "roughly", "coarsely", "thinly", "diced", "minced", "sliced", "grated",
  "crushed", "peeled", "seeded", "deseeded", "cored", "trimmed", "halved", "quartered", "cubed", "julienned",
  "shaved", "torn", "packed", "loosely", "firmly", "lightly", "softened", "melted", "cold", "warm", "room", "temperature",
  "organic", "good", "quality", "best", "store", "bought", "storebought", "homemade", "prepared", "ripe", "small", "medium",
  "large", "extra", "big", "jumbo", "mini", "baby", "whole", "raw", "uncooked", "plain", "pure", "natural", "high",
  "optional", "divided", "about", "approx", "approximately", "plus", "more", "additional", "some", "of", "a", "an", "the",
  "for", "to", "taste", "garnish", "serving", "drained", "rinsed", "and", "patted", "dry", "dried", "frozen", "thawed",
  "cut", "into", "pieces", "piece", "inch", "chunks", "wedges", "rings", "strips", "bite", "sized", "size", "leftover",
  "brand", "your", "favorite", "choice", "any", "kind", "type", "unsalted", "salted", "boneless", "skinless", "skin",
  "on", "bone", "in", "regular", "original", "classic", "shredded", "toasted",
  "roasted", "cooked", "canned", "jarred", "bottled", "tinned", "stick", "sticks", "can", "jar", "package", "bag",
]);
// Fat and sugar words ("light", "fat free", "sugar free") are kept: they
// change the macros, so "fat free X" falls to a weaker "head" match instead.

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Singular form of one word ("tomatoes" -> "tomato", "leaves" -> "leaf", "berries" -> "berry") */
export function singular(w: string): string {
  if (w.length <= 3) return w;
  if (/(ss|us|is|as|sses)$/.test(w)) return w; // grass, couscous, hummus, molasses...
  if (w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.endsWith("oes")) return w.slice(0, -2);
  if (w.endsWith("ves") && !/(olives|chives|cloves)$/.test(w)) return w.slice(0, -3) + "f";
  if (/(ches|shes|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s")) return w.slice(0, -1);
  return w;
}

/**
 * Normalized key for exact lookups: lowercase, no accents, no
 * parentheses or brand punctuation, singular words. Keeps %, / and digits
 * ("2% milk", "93/7 ground beef") because they change the food.
 */
export function normalizeName(name: string): string {
  let s = stripDiacritics(name.toLowerCase());
  s = s.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
  s = s.replace(/&/g, " and ").replace(/[’']/g, "").replace(/-/g, " ");
  s = s.split(/[,;:]| - /)[0]; // "onion, diced" -> "onion"
  s = s.replace(/[^a-z0-9%/ ]/g, " ");
  return s.split(/\s+/).filter(Boolean).map(singular).join(" ");
}

/** Key with descriptive words removed: "fresh chopped flat leaf parsley" -> "flat leaf parsley" */
export function coreName(name: string): string {
  const words = normalizeName(name).split(" ").filter((w) => !DROP_WORDS.has(w) && !/^\d+(\.\d+)?$/.test(w));
  return words.join(" ");
}

function trigrams(s: string): Set<string> {
  const t = new Set<string>();
  const padded = `  ${s} `;
  for (let i = 0; i < padded.length - 2; i++) t.add(padded.slice(i, i + 3));
  return t;
}

/** Trigram similarity (like Postgres pg_trgm's similarity()), 0..1 */
export function similarity(a: string, b: string): number {
  const A = trigrams(a), B = trigrams(b);
  let common = 0;
  A.forEach((x) => { if (B.has(x)) common++; });
  return common / (A.size + B.size - common);
}

export interface AliasEntry { id: string; alias: string }

export class Matcher {
  private exact = new Map<string, string>();
  private normalized = new Map<string, string>();
  private core = new Map<string, string>();
  private keys: Array<{ key: string; id: string; grams: Set<string> }> = [];

  constructor(aliases: AliasEntry[]) {
    for (const { id, alias } of aliases) {
      const lower = alias.toLowerCase().trim();
      if (!this.exact.has(lower)) this.exact.set(lower, id);
      const n = normalizeName(alias);
      if (n && !this.normalized.has(n)) this.normalized.set(n, id);
      const c = coreName(alias);
      if (c && !this.core.has(c)) this.core.set(c, id);
    }
    this.normalized.forEach((id, key) => this.keys.push({ key, id, grams: trigrams(key) }));
  }

  /** Best deterministic match, or null when nothing is close enough */
  match(item: string): MatchResult | null {
    const lower = item.toLowerCase().trim();
    if (!lower) return null;
    const e = this.exact.get(lower);
    if (e) return { id: e, score: 1, method: "exact" };
    const n = normalizeName(item);
    const nh = this.normalized.get(n);
    if (nh) return { id: nh, score: 0.97, method: "normalized" };
    const c = coreName(item);
    const ch = c && (this.normalized.get(c) ?? this.core.get(c));
    if (ch) return { id: ch, score: 0.92, method: "normalized" };

    // "X or Y" -> X ("chicken thighs or breasts"); "chicken/turkey broth" -> "chicken broth"
    const orPart = lower.split(/\s+or\s+/)[0].replace(/([a-z]+)\/[a-z]+/g, "$1");
    if (orPart !== lower) {
      const m = this.match(orPart);
      if (m) return { ...m, score: Math.min(m.score, 0.85), method: m.method === "exact" ? "normalized" : m.method };
    }

    // Drop words from the front, then the back: "smoked sea salt flakes" -> "sea salt"
    const words = (c || n).split(" ").filter(Boolean);
    for (let len = words.length - 1; len >= 1; len--) {
      for (let start = 0; start + len <= words.length; start++) {
        // Prefer endings (the noun usually comes last in English names)
        const s = words.length - len - start;
        const sub = words.slice(s, s + len).join(" ");
        const hit = this.normalized.get(sub) ?? this.core.get(sub);
        if (hit && sub.length >= 3) return { id: hit, score: 0.7 + 0.2 * (len / words.length), method: "head" };
      }
    }

    const best = this.candidates(item, 1)[0];
    if (best && best.score >= 0.55) return { id: best.id, score: Math.min(0.8, best.score), method: "trigram" };
    return null;
  }

  /** Top-k distinct canonical ids by trigram similarity (for the AI fallback's shortlist) */
  candidates(item: string, k = 10): Array<{ id: string; key: string; score: number }> {
    const q = coreName(item) || normalizeName(item);
    if (!q) return [];
    const qg = trigrams(q);
    const scored = this.keys.map(({ key, id, grams }) => {
      let common = 0;
      qg.forEach((x) => { if (grams.has(x)) common++; });
      return { id, key, score: common / (qg.size + grams.size - common) };
    }).sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    const out: Array<{ id: string; key: string; score: number }> = [];
    for (const s of scored) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
      if (out.length >= k) break;
    }
    return out;
  }
}
