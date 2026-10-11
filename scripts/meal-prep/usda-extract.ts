// Turns the USDA FoodData Central bulk CSVs (SR Legacy + Foundation Foods,
// public domain / CC0) into one compact JSON file: per food, the macros per
// 100 g and its household portions. The CSVs are ~50 MB and stay outside the
// repo; build-catalog.ts reads this extract to make the committed seed.
//   npx tsx scripts/meal-prep/usda-extract.ts <usda-data dir> <out.json>
// (usda-data dir holds the unzipped sr/ and fnd/ folders)
import fs from "fs";
import path from "path";

const [dir, out] = process.argv.slice(2);
if (!dir || !out) throw new Error("usage: usda-extract.ts <usda-data dir> <out.json>");

/** Minimal CSV reader for the FDC files (quoted fields, no embedded newlines) */
function readCsv(file: string): Record<string, string>[] {
  const text = fs.readFileSync(file, "utf8");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

function findDir(sub: string): string {
  const base = path.join(dir, sub);
  const inner = fs.readdirSync(base).find((f) => fs.statSync(path.join(base, f)).isDirectory());
  return inner ? path.join(base, inner) : base;
}

interface UsdaFood {
  fdcId: number;
  source: "sr" | "foundation";
  description: string;
  category: string;
  /** per 100 g */
  kcal: number | null; protein: number | null; carbs: number | null; fat: number | null; fiber: number | null;
  portions: Array<{ amount: number; unit: string; modifier: string; grams: number }>;
}

const NUTRIENTS: Record<string, keyof UsdaFood> = { "1003": "protein", "1004": "fat", "1005": "carbs", "1079": "fiber", "1008": "kcal" };

const foods = new Map<number, UsdaFood>();
for (const [sub, source] of [["sr", "sr"], ["fnd", "foundation"]] as const) {
  const d = findDir(sub);
  const cats = new Map(readCsv(path.join(d, "food_category.csv")).map((c) => [c.id, c.description]));
  const units = new Map(readCsv(path.join(d, "measure_unit.csv")).map((u) => [u.id, u.name]));
  // Foundation's food.csv also lists every lab sample; keep only the foods themselves
  const keep = source === "sr" ? null : new Set(readCsv(path.join(d, "foundation_food.csv")).map((f) => f.fdc_id));
  for (const f of readCsv(path.join(d, "food.csv"))) {
    if (keep && !keep.has(f.fdc_id)) continue;
    foods.set(Number(f.fdc_id), {
      fdcId: Number(f.fdc_id), source, description: f.description, category: cats.get(f.food_category_id) ?? "",
      kcal: null, protein: null, carbs: null, fat: null, fiber: null, portions: [],
    });
  }
  const atwater = new Map<number, number>();
  for (const n of readCsv(path.join(d, "food_nutrient.csv"))) {
    const food = foods.get(Number(n.fdc_id));
    if (!food) continue;
    const key = NUTRIENTS[n.nutrient_id];
    if (key) (food as any)[key] = Number(n.amount);
    // Foundation foods often give energy only as Atwater factors
    if (n.nutrient_id === "2047" || (n.nutrient_id === "2048" && !atwater.has(food.fdcId))) atwater.set(food.fdcId, Number(n.amount));
  }
  for (const [id, kcal] of atwater) { const f = foods.get(id)!; if (f.kcal == null) f.kcal = kcal; }
  for (const p of readCsv(path.join(d, "food_portion.csv"))) {
    const food = foods.get(Number(p.fdc_id));
    if (!food || !Number(p.gram_weight)) continue;
    const unit = units.get(p.measure_unit_id);
    food.portions.push({
      amount: Number(p.amount) || 1,
      unit: unit && unit !== "undetermined" ? unit : "",
      modifier: (p.modifier || p.portion_description || "").trim(),
      grams: Number(p.gram_weight),
    });
  }
}

const list = [...foods.values()].filter((f) => f.kcal != null);
fs.writeFileSync(out, JSON.stringify(list));
console.log(`${list.length} foods (${list.filter((f) => f.source === "sr").length} SR Legacy) -> ${out}`);
