import type { KitchenSetup, Lane, ScheduledTask } from "@shared/meal-prep/contract";
import type { GraphTask } from "./merge";

// Places the session's task graph in time: resource-constrained list
// scheduling. Each task is a hands-on part (needs a cook) followed by a
// waiting part (the pot simmers, the oven bakes); its pot, burner or oven is
// held for both. Ovens hold one temperature at a time and need ~10 minutes
// to preheat or change. A pot that's freed and needed again is washed first.
//
// Tasks go in priority order (longest remaining chain, plus a bonus for long
// waits so they start early and the cook works during them), each at the
// earliest time everything it needs is free. That's run a few hundred times
// with jittered priorities and the shortest safe schedule wins.

export interface ScheduleOptions {
  cooks: number;
  kitchen: KitchenSetup;
  iterations?: number;
  seed?: number;
  /** minutes to preheat or change an oven's temperature */
  preheatMin?: number;
}

export interface ScheduleResult {
  tasks: ScheduledTask[];
  makespan: number;
  warnings: string[];
  /** penalty-adjusted score of the winning attempt (lower is better) */
  score: number;
  attempts: number;
}

interface Interval { s: number; e: number; q: number }
interface Block { temp: number; start: number; ready: number; end: number; uses: Interval[]; preheatId: string; changed: boolean }
interface VesselInstance { kind: string; n: number; heldBy: string | null; freeAt: number; used: boolean; borrowed: boolean }

/** Pots and pans a home kitchen usually has; anything else counts as two */
const DEFAULT_VESSELS: Record<string, number> = {
  "large pot": 2, "dutch oven": 1, saucepan: 2, skillet: 2, "sheet pan": 3, "baking dish": 2,
  "mixing bowl": 4, blender: 1, "food processor": 1,
};

/** Minutes to wash a vessel before it's used again */
const WASH_MIN: Record<string, number> = {
  "large pot": 4, "dutch oven": 4, saucepan: 3, skillet: 3, "sheet pan": 3, "baking dish": 4,
  "mixing bowl": 2, blender: 4, "food processor": 5,
};

/** Small appliances assumed on hand even if the kitchen setup doesn't list them */
const ASSUMED_APPLIANCES = /blender|food processor|hand mixer|mixer/;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Highest total load on [s, e) */
function maxLoad(list: Interval[], s: number, e: number): number {
  const events: Array<[number, number]> = [];
  for (const iv of list) {
    if (iv.s < e && iv.e > s) {
      events.push([Math.max(iv.s, s), iv.q]);
      events.push([Math.min(iv.e, e), -iv.q]);
    }
  }
  if (!events.length) return 0;
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let load = 0;
  let max = 0;
  for (const [, q] of events) { load += q; max = Math.max(max, load); }
  return max;
}

const busy = (list: Interval[], s: number, e: number) => e > s && list.some((iv) => iv.s < e && iv.e > s);

/** Back-to-back washing by the same cook reads better as one line: "Wash the skillet, saucepan and 2 mixing bowls" */
function coalesceWashing(extra: ScheduledTask[]) {
  const washes = extra.filter((t) => t.kind === "clean" && /^Wash the /.test(t.text) && !t.dependsOn.length)
    .sort((a, b) => a.cook - b.cook || a.start - b.start);
  const isDependedOn = (id: string) => extra.some((t) => t.dependsOn.includes(id));
  let run: ScheduledTask[] = [];
  const flush = () => {
    if (run.length > 1) {
      const counts = new Map<string, number>();
      for (const w of run) { const k = w.text.replace(/^Wash the /, "").replace(/ for the next dish$/, ""); counts.set(k, (counts.get(k) ?? 0) + 1); }
      const parts = Array.from(counts.entries()).map(([k, n]) => (n > 1 ? `${n} ${k}s` : k));
      const head = run[0];
      head.text = `Wash the ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]}`;
      head.end = run[run.length - 1].end;
      head.activeMin = head.end - head.start;
      for (const w of run.slice(1)) extra.splice(extra.indexOf(w), 1);
    }
    run = [];
  };
  for (const w of washes) {
    // Washing done right before a pot is reused stays its own step
    if (isDependedOn(w.id)) { flush(); continue; }
    const last = run[run.length - 1];
    if (last && (last.cook !== w.cook || last.end !== w.start)) flush();
    run.push(w);
  }
  flush();
}

export function laneFor(t: Pick<GraphTask, "kind" | "resources">): Lane {
  if (t.kind === "clean") return "clean";
  if (t.kind === "preheat" || t.resources.some((r) => r.kind === "oven")) return "oven";
  if (t.resources.some((r) => r.kind === "burner")) return "stove";
  const app = t.resources.find((r) => r.kind === "appliance");
  if (app && !ASSUMED_APPLIANCES.test(app.name ?? "")) return "stove";
  if (t.kind === "cook" || t.kind === "simmer") return "stove";
  if (t.kind === "prep" || t.kind === "assemble" || t.kind === "marinate") return "prep";
  return "other";
}

export function schedule(graph: GraphTask[], opts: ScheduleOptions): ScheduleResult {
  const iterations = Math.max(1, opts.iterations ?? 300);
  const rand = mulberry32(opts.seed ?? 42);
  const base = priorities(graph);
  let best: (Attempt & { score: number }) | null = null;
  for (let i = 0; i < iterations; i++) {
    const prio = new Map(base);
    if (i > 0) for (const [id, p] of Array.from(prio)) prio.set(id, p * (1 + (rand() - 0.5) * 0.5));
    const attempt = runOnce(graph, prio, opts);
    const score = attempt.makespan + attempt.penalty;
    if (!best || score < best.score - 1e-9) best = { ...attempt, score };
  }
  return { tasks: best!.tasks, makespan: best!.makespan, warnings: best!.warnings, score: best!.score, attempts: iterations };
}

/** Longest chain of minutes from each task to the end, with a bonus for long waits */
function priorities(graph: GraphTask[]): Map<string, number> {
  const succ = new Map<string, string[]>();
  for (const t of graph) for (const d of t.dependsOn) succ.set(d, [...(succ.get(d) ?? []), t.id]);
  const byId = new Map(graph.map((t) => [t.id, t]));
  const tail = new Map<string, number>();
  const visit = (id: string): number => {
    if (tail.has(id)) return tail.get(id)!;
    tail.set(id, 0); // guards against a loop
    const t = byId.get(id)!;
    const after = Math.max(0, ...(succ.get(id) ?? []).map(visit));
    const v = t.activeMin + t.passiveMin + after;
    tail.set(id, v);
    return v;
  };
  const prio = new Map<string, number>();
  for (const t of graph) prio.set(t.id, visit(t.id) + 0.5 * t.passiveMin);
  return prio;
}

interface Attempt {
  tasks: ScheduledTask[];
  makespan: number;
  penalty: number;
  warnings: string[];
}

function runOnce(graph: GraphTask[], prio: Map<string, number>, opts: ScheduleOptions): Attempt {
  const { kitchen } = opts;
  const preheatMin = opts.preheatMin ?? 10;
  const cooks: Interval[][] = Array.from({ length: Math.max(1, opts.cooks) }, () => []);
  const pools = new Map<string, { cap: number; list: Interval[] }>();
  const warnings = new Set<string>();
  const pool = (key: string, cap: number) => {
    if (!pools.has(key)) pools.set(key, { cap, list: [] });
    return pools.get(key)!;
  };
  pool("board", Math.max(1, opts.cooks));
  pool("burner", Math.max(1, kitchen.burners || 0));
  if (!kitchen.burners && graph.some((t) => t.resources.some((r) => r.kind === "burner"))) warnings.add("This plan needs a stovetop burner.");
  const ovenCount = Math.max(1, kitchen.ovens || 0);
  if (!kitchen.ovens && graph.some((t) => t.resources.some((r) => r.kind === "oven"))) warnings.add("Some dishes need an oven, and your kitchen setup has none.");
  const racks = Math.max(1, kitchen.ovenRacks || 2);
  const ovens: Block[][] = Array.from({ length: ovenCount }, () => []);
  const vessels = new Map<string, VesselInstance[]>();
  const chainLeft = new Map<string, number>();
  const chainInstance = new Map<string, VesselInstance>();
  const chainEnd = new Map<string, number>();
  for (const t of graph) if (t.vessel) chainLeft.set(t.vessel.key, (chainLeft.get(t.vessel.key) ?? 0) + 1);
  // The finished dish stays in its pot until it's portioned
  for (const t of graph) for (const key of t.releases ?? []) if (chainLeft.has(key)) chainLeft.set(key, chainLeft.get(key)! + 1);
  const releaseOne = (key: string, at: number) => {
    chainEnd.set(key, Math.max(chainEnd.get(key) ?? 0, at));
    const left = (chainLeft.get(key) ?? 1) - 1;
    chainLeft.set(key, left);
    const v = chainInstance.get(key);
    if (left === 0 && v) {
      v.heldBy = null;
      v.freeAt = chainEnd.get(key)!;
    }
  };

  const out = new Map<string, ScheduledTask>();
  const extra: ScheduledTask[] = [];
  const done = new Map<string, { end: number; cook: number }>();
  const remaining = new Set(graph.map((t) => t.id));
  const byId = new Map(graph.map((t) => [t.id, t]));
  let preheatN = 0;
  let washN = 0;

  const freeCook = (s: number, a: number, prefer: number | null): number => {
    if (a <= 0) return prefer ?? 0;
    if (prefer != null && !busy(cooks[prefer], s, s + a)) return prefer;
    return cooks.findIndex((c) => !busy(c, s, s + a));
  };

  const applianceCap = (name: string): number => {
    const owned = kitchen.appliances.filter((a) => a.kind.toLowerCase().includes(name) || name.includes(a.kind.toLowerCase())).reduce((s, a) => s + a.count, 0);
    if (owned > 0) return owned;
    if (!ASSUMED_APPLIANCES.test(name)) warnings.add(`This plan uses a ${name}, which isn't in your kitchen setup.`);
    return 1;
  };

  /** Where an oven task at `t` would go: join a block at its temperature or start a new one */
  const ovenSlot = (t: number, d: number, temp: number, q: number): { oven: number; block: Block | null } | null => {
    for (let o = 0; o < ovens.length; o++) {
      const blocks = ovens[o];
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (b.temp !== temp || b.ready > t) continue;
        const next = blocks[i + 1];
        if (next && next.start < t + d) continue;
        if (maxLoad(b.uses, t, t + d) + q > racks) continue;
        return { oven: o, block: b };
      }
    }
    const p = t - preheatMin;
    if (p < 0) return null;
    for (let o = 0; o < ovens.length; o++) {
      if (ovens[o].every((b) => b.end <= p || b.start >= t + d)) return { oven: o, block: null };
    }
    return null;
  };

  const eventTimes = (from: number): number[] => {
    const times = new Set<number>([from]);
    const add = (v: number) => { if (v > from) times.add(v); };
    for (const c of cooks) for (const iv of c) add(iv.e);
    for (const p of Array.from(pools.values())) for (const iv of p.list) add(iv.e);
    for (const blocks of ovens) for (const b of blocks) { add(b.ready); add(b.end); add(b.end + preheatMin); for (const u of b.uses) add(u.e); }
    add(preheatMin);
    return Array.from(times).sort((a, b) => a - b);
  };

  /** Claims a pot or pan for a chain's first task; returns when it's ready (after washing, if it was used) */
  const claimVessel = (task: GraphTask, prefer: number | null): number | "blocked" => {
    if (!task.vessel || chainInstance.has(task.vessel.key)) return 0;
    const kind = task.vessel.kind;
    if (!vessels.has(kind)) {
      const n = DEFAULT_VESSELS[kind] ?? 2;
      vessels.set(kind, Array.from({ length: n }, (_, i) => ({ kind, n: i + 1, heldBy: null, freeAt: 0, used: false, borrowed: false })));
    }
    const list = vessels.get(kind)!;
    const free = list.filter((v) => v.heldBy == null).sort((a, b) => Number(a.used) - Number(b.used) || a.freeAt - b.freeAt);
    const pick = free[0];
    if (!pick) return "blocked";
    pick.heldBy = task.vessel.key;
    chainInstance.set(task.vessel.key, pick);
    if (!pick.used) { pick.used = true; return 0; }
    // Wash it first: a short hands-on task as soon as a cook is free
    const wash = WASH_MIN[kind] ?? 3;
    for (const s of eventTimes(pick.freeAt)) {
      if (s < pick.freeAt) continue;
      const c = freeCook(s, wash, prefer);
      if (c < 0) continue;
      cooks[c].push({ s, e: s + wash, q: 1 });
      const id = `wash${++washN}`;
      extra.push({
        id, recipeIds: [], text: `Wash the ${kind} for the next dish`, kind: "clean", activeMin: wash, passiveMin: 0,
        resources: [{ kind: "cook", qty: 1 }], dependsOn: [], holdMin: 600, lane: "clean", start: s, end: s + wash, cook: c + 1,
      });
      task.dependsOn = [...task.dependsOn, id];
      return s + wash;
    }
    return pick.freeAt + wash;
  };

  const borrowVessel = (task: GraphTask) => {
    const kind = task.vessel!.kind;
    const list = vessels.get(kind)!;
    list.push({ kind, n: list.length + 1, heldBy: null, freeAt: 0, used: false, borrowed: true });
    warnings.add(`You'll need one more ${kind} than usual (${list.length} in all), or wash one partway through.`);
  };

  // Each attempt works on its own copy of dependency lists (washing adds to them)
  const deps = new Map(graph.map((t) => [t.id, Array.from(t.dependsOn)]));
  const local = (t: GraphTask): GraphTask => ({ ...t, dependsOn: deps.get(t.id)! });

  while (remaining.size) {
    const eligible = Array.from(remaining).map((id) => byId.get(id)!).filter((t) => t.dependsOn.every((d) => done.has(d) || !byId.has(d)))
      .sort((a, b) => prio.get(b.id)! - prio.get(a.id)!);
    if (!eligible.length) throw new Error("Task graph has a loop");
    let placed = false;
    for (const original of eligible) {
      const task = local(original);
      const depCooks = task.dependsOn.map((d) => done.get(d)?.cook).filter((c): c is number => c != null);
      const prefer = depCooks.length ? depCooks[depCooks.length - 1] : null;
      const vesselReady = claimVessel(task, prefer);
      if (vesselReady === "blocked") continue;
      deps.set(task.id, task.dependsOn);
      placeTask(task, Math.max(vesselReady, ...task.dependsOn.map((d) => done.get(d)?.end ?? extra.find((x) => x.id === d)?.end ?? 0)), prefer);
      placed = true;
      break;
    }
    if (!placed) {
      // Every ready task is waiting on a pot that's still in use: borrow one
      borrowVessel(eligible[0]);
    }
  }

  function placeTask(task: GraphTask, ready: number, prefer: number | null) {
    const a = task.activeMin;
    const d = a + task.passiveMin;
    const oven = task.resources.find((r) => r.kind === "oven");
    const burner = task.resources.find((r) => r.kind === "burner");
    const board = task.resources.find((r) => r.kind === "board");
    const appliance = task.resources.find((r) => r.kind === "appliance");
    const appPool = appliance ? pool(`app:${appliance.name}`, applianceCap(appliance.name ?? "appliance")) : null;
    const burners = pools.get("burner")!;
    const boards = pools.get("board")!;
    for (const t of eventTimes(ready)) {
      if (t < ready) continue;
      const c = freeCook(t, a, prefer);
      if (c < 0) continue;
      if (board && maxLoad(boards.list, t, t + a) + 1 > boards.cap) continue;
      if (burner && maxLoad(burners.list, t, t + d) + burner.qty > burners.cap) continue;
      if (appPool && maxLoad(appPool.list, t, t + d) + 1 > appPool.cap) continue;
      let slot: ReturnType<typeof ovenSlot> = null;
      if (oven) {
        slot = ovenSlot(t, d, oven.tempF ?? 350, Math.min(oven.qty, racks));
        if (!slot) continue;
      }
      // Commit
      if (a > 0) cooks[c].push({ s: t, e: t + a, q: 1 });
      if (board) boards.list.push({ s: t, e: t + a, q: 1 });
      if (burner) burners.list.push({ s: t, e: t + d, q: burner.qty });
      if (appPool) appPool.list.push({ s: t, e: t + d, q: 1 });
      const dependsOn = Array.from(task.dependsOn);
      if (oven && slot) {
        const blocks = ovens[slot.oven];
        let block = slot.block;
        if (!block) {
          const prev = blocks.filter((b) => b.end <= t - preheatMin).sort((x, y) => y.end - x.end)[0];
          block = { temp: oven.tempF ?? 350, start: t - preheatMin, ready: t, end: t + d, uses: [], preheatId: `preheat${++preheatN}`, changed: !!prev };
          blocks.push(block);
          blocks.sort((x, y) => x.start - y.start);
          const which = ovens.length > 1 ? `oven ${slot.oven + 1}` : "the oven";
          extra.push({
            id: block.preheatId, recipeIds: [], kind: "preheat",
            text: prev && prev.temp !== block.temp ? `Change ${which} to ${block.temp}°F` : `Preheat ${which} to ${block.temp}°F`,
            activeMin: 0, passiveMin: preheatMin, resources: [{ kind: "oven", qty: 0, tempF: block.temp }],
            dependsOn: [], holdMin: 30, lane: "oven", start: block.start, end: block.ready, cook: 1, timerSec: preheatMin * 60,
          });
        }
        block.end = Math.max(block.end, t + d);
        block.uses.push({ s: t, e: t + d, q: Math.min(oven.qty, racks) });
        dependsOn.push(block.preheatId);
      }
      const scheduled: ScheduledTask = {
        id: task.id, recipeIds: task.recipeIds, text: task.text, kind: task.kind, activeMin: a, passiveMin: task.passiveMin,
        resources: task.resources, dependsOn, holdMin: task.holdMin,
        ...(task.doneCue ? { doneCue: task.doneCue } : {}),
        ...(task.passiveMin > 0 ? { timerSec: task.passiveMin * 60 } : {}),
        lane: laneFor(task), start: t, end: t + d, cook: (a > 0 ? c : prefer ?? 0) + 1,
      };
      out.set(task.id, scheduled);
      done.set(task.id, { end: t + d, cook: a > 0 ? c : prefer ?? 0 });
      remaining.delete(task.id);
      if (task.vessel) releaseOne(task.vessel.key, t + d);
      for (const key of task.releases ?? []) if (chainLeft.has(key)) releaseOne(key, t + a);
      return;
    }
    throw new Error(`No time found for task ${task.id}`);
  }

  // Wash as you go: each pot or pan still dirty gets washed in the first free
  // minutes after it's emptied; boards and counters once the cooking's done
  const firstGap = (from: number, len: number): { s: number; c: number } => {
    for (const s of eventTimes(from)) {
      if (s < from) continue;
      const c = freeCook(s, len, null);
      if (c >= 0) return { s, c };
    }
    return { s: from, c: 0 };
  };
  const dirty = Array.from(vessels.values()).flat().filter((v) => v.used && v.heldBy == null).sort((a, b) => a.freeAt - b.freeAt);
  for (const v of dirty) {
    const len = WASH_MIN[v.kind] ?? 3;
    const { s, c } = firstGap(v.freeAt, len);
    cooks[c].push({ s, e: s + len, q: 1 });
    extra.push({
      id: `wash${++washN}`, recipeIds: [], text: `Wash the ${v.kind}`, kind: "clean", activeMin: len, passiveMin: 0,
      resources: [{ kind: "cook", qty: 1 }], dependsOn: [], holdMin: 600, lane: "clean", start: s, end: s + len, cook: c + 1,
    });
  }
  coalesceWashing(extra);
  const cookingDone = Math.max(0, ...Array.from(out.values()).filter((t) => t.lane !== "other" && t.lane !== "clean").map((t) => t.end));
  if (out.size) {
    const { s, c } = firstGap(cookingDone, 5);
    cooks[c].push({ s, e: s + 5, q: 1 });
    extra.push({
      id: "wipe", recipeIds: [], text: "Wash the cutting boards and knives and wipe down the counters", kind: "clean", activeMin: 5, passiveMin: 0,
      resources: [{ kind: "cook", qty: 1 }], dependsOn: [], holdMin: 600, lane: "clean", start: s, end: s + 5, cook: c + 1,
    });
  }

  // Score: length, plus penalties for food left out too long
  const all = Array.from(out.values()).concat(extra).sort((a, b) => a.start - b.start || a.end - b.end);
  const makespan = Math.max(0, ...all.map((t) => t.end));
  let penalty = 0;
  for (const t of graph) {
    if (t.role === "store" && t.fridgeClockFrom?.length) {
      const cooked = Math.max(...t.fridgeClockFrom.map((id) => out.get(id)?.end ?? 0));
      const late = out.get(t.id)!.end - cooked - 120;
      if (late > 0) penalty += 1000 + late * 10;
    }
    // Hot food sitting longer than it should before the next step
    for (const d of t.dependsOn) {
      const dep = byId.get(d);
      const after = out.get(t.id);
      const before = out.get(d);
      if (!dep || !after || !before || !["cook", "simmer", "bake"].includes(dep.kind)) continue;
      const wait = after.start - before.end - dep.holdMin;
      if (wait > 0) penalty += wait * 0.2;
    }
  }
  for (const t of graph) {
    if (t.role !== "store" || !t.fridgeClockFrom?.length) continue;
    const cooked = Math.max(...t.fridgeClockFrom.map((id) => out.get(id)?.end ?? 0));
    const late = out.get(t.id)!.end - cooked - 120;
    if (late > 0) warnings.add(`${t.text.replace(/^Put lids on the (.*) containers.*$/, "$1")} would go in the fridge more than 2 hours after cooking. Cool it in shallower containers sooner.`);
  }
  return { tasks: all, makespan, penalty, warnings: Array.from(warnings) };
}
