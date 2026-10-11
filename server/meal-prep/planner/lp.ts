// A small builder for mixed-integer models in CPLEX LP text, which is what
// the HiGHS one-shot API reads. Variables get short generated names (v0, v1…)
// so recipe ids and person ids never have to be escaped.

export type VarType = "C" | "I" | "B";
export type Term = [string, number];

export interface VarSpec {
  lb?: number;
  ub?: number;
  type?: VarType;
  /** objective coefficient (the model minimizes) */
  obj?: number;
}

interface Row {
  terms: Map<string, number>;
  sense: "<=" | ">=" | "=";
  rhs: number;
}

// LP text must not contain exponents like 1e-7; round to a fixed precision.
function num(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`LP number is not finite: ${v}`);
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? "0" : String(r);
}

export class LpModel {
  private vars: Array<{ name: string; lb: number; ub: number; type: VarType }> = [];
  private obj = new Map<string, number>();
  private rows: Row[] = [];
  /** constant part of the objective, kept outside HiGHS */
  objConstant = 0;

  addVar(spec: VarSpec = {}): string {
    const name = `v${this.vars.length}`;
    const type = spec.type ?? "C";
    this.vars.push({
      name,
      type,
      lb: spec.lb ?? 0,
      ub: spec.ub ?? (type === "B" ? 1 : Infinity),
    });
    if (spec.obj) this.addObj(name, spec.obj);
    return name;
  }

  addObj(name: string, coef: number): void {
    if (coef === 0) return;
    this.obj.set(name, (this.obj.get(name) ?? 0) + coef);
  }

  /** Adds `Σ terms sense rhs`; repeated variables are merged. Empty rows are checked, not sent. */
  addRow(terms: Term[], sense: Row["sense"], rhs: number): void {
    const merged = new Map<string, number>();
    for (const [v, c] of terms) {
      if (c === 0) continue;
      merged.set(v, (merged.get(v) ?? 0) + c);
    }
    for (const [v, c] of Array.from(merged)) if (Math.abs(c) < 1e-9) merged.delete(v);
    if (merged.size === 0) {
      const ok = sense === "<=" ? 0 <= rhs + 1e-9 : sense === ">=" ? 0 >= rhs - 1e-9 : Math.abs(rhs) < 1e-9;
      if (!ok) throw new Error("LP row with no variables can never hold");
      return;
    }
    this.rows.push({ terms: merged, sense, rhs });
  }

  get size(): { vars: number; rows: number; integers: number } {
    return {
      vars: this.vars.length,
      rows: this.rows.length,
      integers: this.vars.filter((v) => v.type !== "C").length,
    };
  }

  toString(): string {
    const out: string[] = ["Minimize"];
    out.push(" obj: " + (this.obj.size ? terms(this.obj) : "0 " + (this.vars[0]?.name ?? "")));
    out.push("Subject To");
    this.rows.forEach((r, i) => out.push(` c${i}: ${terms(r.terms)} ${r.sense} ${num(r.rhs)}`));
    out.push("Bounds");
    // A binary with tightened bounds (a pinned dish) is written as a bounded
    // general integer, since the Binary section would reset it to [0, 1].
    const isPlainBinary = (v: { type: VarType; lb: number; ub: number }) => v.type === "B" && v.lb === 0 && v.ub === 1;
    for (const v of this.vars) {
      if (isPlainBinary(v)) continue;
      const lb = v.lb === -Infinity ? "-inf" : num(v.lb);
      const ub = v.ub === Infinity ? "+inf" : num(v.ub);
      out.push(` ${lb} <= ${v.name} <= ${ub}`);
    }
    const gen = this.vars.filter((v) => v.type === "I" || (v.type === "B" && !isPlainBinary(v))).map((v) => v.name);
    const bin = this.vars.filter(isPlainBinary).map((v) => v.name);
    if (gen.length) out.push("General", ...chunk(gen));
    if (bin.length) out.push("Binary", ...chunk(bin));
    out.push("End");
    return out.join("\n");
  }
}

// Keep lines short; the LP reader copes better with many short lines.
function terms(m: Map<string, number>): string {
  const parts: string[] = [];
  let i = 0;
  for (const [v, c] of Array.from(m)) {
    const s = c < 0 ? `- ${num(-c)} ${v}` : `${i === 0 ? "" : "+ "}${num(c)} ${v}`;
    parts.push((i > 0 && i % 8 === 0 ? "\n  " : "") + s);
    i++;
  }
  return parts.join(" ");
}

function chunk(names: string[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < names.length; i += 20) lines.push(" " + names.slice(i, i + 20).join(" "));
  return lines;
}
