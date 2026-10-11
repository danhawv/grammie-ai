// Runs the bulk-intake first look and pairing on a folder of photos and
// prints cost per photo; with a hand-checked plan (the October 2026 import's
// grammie-work/ files), also scores it. Calls the AI for real, saves nothing
// to the database. Answers are cached in OUT so re-runs are free.
//   GEMINI_API_KEY=... npx tsx scripts/bench-bulk-intake.ts <photo folder> <out.json> [work dir] [indexes,...]
//   GEMINI_MODEL_BULKCATALOG=gemini-3.1-flash-lite ... to try another model
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { catalogPhoto, pairBacksWithAI } from "../server/bulk-intake/catalog";
import { buildPlan, pairingCandidates, type PairCandidate, type PlanPhoto } from "../shared/bulk-intake";

const [dir, out, work, only] = process.argv.slice(2);
const names = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|heic|webp)$/i.test(f)).sort();
const subset = only ? only.split(",").map(Number) : names.map((_, i) => i);
const cache: Record<string, any> = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : {};

let next = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < subset.length) {
    const n = subset[next++];
    if (cache[n]?.catalog) continue;
    // What the browser uploads: shrunk to 2400px
    const shrunk = await sharp(fs.readFileSync(path.join(dir, names[n]))).rotate().resize(2400, 2400, { fit: "inside" }).jpeg({ quality: 88 }).toBuffer();
    const t = Date.now();
    try {
      cache[n] = { file: names[n], ...(await catalogPhoto(shrunk)), ms: Date.now() - t };
    } catch (e: any) {
      cache[n] = { file: names[n], error: e.message };
    }
  }
}));
fs.writeFileSync(out, JSON.stringify(cache, null, 1));

const done = subset.filter((n) => cache[n]?.catalog);
const spent = done.reduce((s, n) => s + cache[n].usage.costMicros, 0);
const tokens = done.reduce((s, n) => s + cache[n].usage.inputTokens, 0);
const ms = done.map((n) => cache[n].ms).sort((a, b) => a - b);
console.log(`First look: ${done.length}/${subset.length} photos, $${(spent / 1e6).toFixed(4)} (${(spent / done.length).toFixed(0)} µ$/photo, ${Math.round(tokens / done.length)} input tokens/photo), median ${ms[ms.length >> 1]}ms`);

const candidates: PairCandidate[] = done.map((n) => ({ id: String(n), seq: n, catalog: cache[n].catalog }));
const { fronts, backs, others } = pairingCandidates(candidates);
const { pairs, usage } = await pairBacksWithAI(fronts, backs, others);
console.log(`Pairing: ${fronts.length} fronts, ${backs.length} backs, ${others.length} other cards -> ${pairs.size} pairs, $${((usage?.costMicros ?? 0) / 1e6).toFixed(4)}`, Object.fromEntries(pairs));

const photos: PlanPhoto[] = done.map((n) => ({ id: String(n), seq: n, sourceHash: names[n], catalog: cache[n].catalog, pairedTo: pairs.get(String(n)) ?? null, pairLocked: false, includeOverride: null }));
const plan = buildPlan(photos);
console.log("Plan:", plan.summary);

if (work) {
  const truth = JSON.parse(fs.readFileSync(path.join(work, "plan.json"), "utf8"));
  const truthCat = JSON.parse(fs.readFileSync(path.join(work, "catalog.json"), "utf8"));
  const idx = new Map<string, number>(names.map((f, i) => [f, i]));
  const inSet = new Set(done);
  const truthRotate = new Map<number, number>();
  for (const p of [...truth.import, ...truth.hold]) truthRotate.set(p.n, p.rotate);
  for (const [f, c] of Object.entries<any>(truthCat)) if (!truthRotate.has(idx.get(f)!)) truthRotate.set(idx.get(f)!, c.rotate);
  const rot = done.filter((n) => truthRotate.has(n));
  const rotOk = rot.filter((n) => cache[n].catalog.rotate === truthRotate.get(n));
  console.log(`Rotation: ${rotOk.length}/${rot.length} match`, rot.filter((n) => !rotOk.includes(n)).map((n) => `${n}: got ${cache[n].catalog.rotate} want ${truthRotate.get(n)}`));

  const truthPairs = new Map<string, string>();
  for (const p of truth.import) for (const b of p.pages) if (inSet.has(idx.get(b)!) && inSet.has(p.n)) truthPairs.set(String(idx.get(b)), String(p.n));
  const pairOk = Array.from(truthPairs).filter(([b, f]) => pairs.get(b) === f).length;
  const extra = Array.from(pairs).filter(([b, f]) => truthPairs.get(b) !== f);
  console.log(`Pairs: ${pairOk}/${truthPairs.size} found; ${extra.length} not in the hand-checked plan`, extra);

  const held = new Set(truth.hold.map((h: any) => String(h.n)));
  const ourHeld = new Set(plan.groups.filter((g) => g.status === "incomplete").map((g) => g.key));
  const heldIn = Array.from(held).filter((n) => inSet.has(Number(n)));
  console.log(`Held (incomplete): ${heldIn.filter((n) => ourHeld.has(n)).length}/${heldIn.length} of the hand-held ones; also held: ${Array.from(ourHeld).filter((n) => !held.has(n)).join(", ") || "none"}; missed: ${heldIn.filter((n) => !ourHeld.has(n)).join(", ") || "none"}`);

  const dupes: [string, string][] = Object.entries<number>(truth.dropped_dupes).map(([a, b]) => [a, String(b)]).filter(([a, b]) => inSet.has(Number(a)) && inSet.has(Number(b)));
  const ourDup = plan.groups.filter((g) => g.status === "duplicate");
  const dupOk = dupes.filter(([a, b]) => ourDup.some((g) => (g.key === a && g.duplicateOf === b) || (g.key === b && g.duplicateOf === a))).length;
  console.log(`Duplicates: ${dupOk}/${dupes.length} found; ${ourDup.length} flagged in all`);
  for (const g of plan.groups.filter((g) => g.status !== "ready")) console.log(`  ${g.key.padStart(3)} ${g.status.padEnd(10)} ${g.title} — ${g.reason}`);
}
process.exit(0);
