// Runs HiGHS (WebAssembly) on a worker thread so a multi-second solve never
// blocks the web server. One long-lived worker handles solves one at a time;
// if it dies, the next solve starts a fresh one.
//
// The worker is created from inline code (not a separate file) because the
// server is bundled into dist/ by esbuild, which would not copy a worker file.
// The worker loads `highs` from the absolute path we resolve here.

import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";

export interface SolveOptions {
  /** seconds */
  timeLimit: number;
  /** accepted relative MIP gap */
  mipGap: number;
  /** accepted absolute MIP gap, in objective units */
  mipAbsGap?: number;
  /** a known-feasible guess for some integer columns (a MIP start) */
  start?: Array<[string, number]>;
}

export interface SolveResult {
  status: string;
  /** primal value by variable name; null when HiGHS returned no solution */
  values: Record<string, number> | null;
  objective: number | null;
  /** HiGHS accepted the MIP start */
  startUsed?: boolean;
  ms: number;
}

const WORKER_CODE = `
const { parentPort, workerData } = require("node:worker_threads");
const ready = require(workerData.highsPath)();
const NAMES = { 7: "Optimal", 8: "Infeasible", 9: "Infeasible or unbounded", 10: "Unbounded", 13: "Time limit reached" };
parentPort.on("message", async (msg) => {
  const t0 = Date.now();
  let model = null;
  try {
    const highs = await ready;
    model = highs.createModel({ format: "lp", data: msg.lp });
    model.options.set({
      time_limit: msg.timeLimit,
      mip_rel_gap: msg.mipGap,
      // the objective sits near zero (bonuses offset costs), so a relative gap
      // alone would never be met; a small absolute gap is "good enough" too
      mip_abs_gap: msg.mipAbsGap,
      output_flag: false,
    });
    let startUsed = false;
    if (msg.start && msg.start.length) {
      // a MIP start: HiGHS fills in the unlisted (continuous) columns itself
      const indices = [], values = [];
      for (const [name, v] of msg.start) {
        const i = model.getColByName(name);
        if (i >= 0) { indices.push(i); values.push(v); }
      }
      try { model.setSolution({ indices, values }); startUsed = true; } catch (e) { startUsed = false; }
    }
    const run = model.run();
    const code = run.modelStatus;
    const feasible = Number(model.info.get("primal_solution_status")) === 2;
    let values = null, objective = null;
    if (feasible) {
      const col = model.getSolution().colValue;
      values = {};
      for (let i = 0; i < col.length; i++) values[model.getColName(i)] = col[i];
      objective = model.getObjectiveValue();
    }
    parentPort.postMessage({ id: msg.id, status: NAMES[code] || ("Status " + code), values, objective, startUsed, ms: Date.now() - t0 });
  } catch (e) {
    parentPort.postMessage({ id: msg.id, error: String(e && e.message || e), ms: Date.now() - t0 });
  } finally {
    if (model) try { model.dispose(); } catch (e) {}
  }
});
`;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: SolveResult) => void; reject: (e: Error) => void }>();
// Solves run one at a time; HiGHS-wasm is single threaded anyway.
let queue: Promise<unknown> = Promise.resolve();

function getWorker(): Worker {
  if (worker) return worker;
  const highsPath = createRequire(import.meta.url).resolve("highs");
  const w = new Worker(WORKER_CODE, { eval: true, workerData: { highsPath } });
  w.unref(); // never keep the process alive just for the solver
  w.on("message", (m: { id: number; error?: string } & SolveResult) => {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new Error(`Solver failed: ${m.error}`));
    else p.resolve({ status: m.status, values: m.values, objective: m.objective, startUsed: m.startUsed, ms: m.ms });
  });
  const fail = (err: Error) => {
    if (worker === w) worker = null;
    for (const [id, p] of Array.from(pending)) {
      pending.delete(id);
      p.reject(err);
    }
  };
  w.on("error", fail);
  w.on("exit", (code) => fail(new Error(`Solver worker stopped (code ${code})`)));
  worker = w;
  return w;
}

export function solveLp(lp: string, opts: SolveOptions): Promise<SolveResult> {
  const run = () =>
    new Promise<SolveResult>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      const w = getWorker();
      w.ref(); // hold the process open while a solve is in flight
      const done = () => w.unref();
      pending.set(id, {
        resolve: (r) => { done(); resolve(r); },
        reject: (e) => { done(); reject(e); },
      });
      w.postMessage({ id, lp, timeLimit: opts.timeLimit, mipGap: opts.mipGap, mipAbsGap: opts.mipAbsGap ?? 2, start: opts.start });
    });
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}

/** Stops the worker (tests and shutdown). */
export async function stopSolver(): Promise<void> {
  const w = worker;
  worker = null;
  if (w) await w.terminate();
}
