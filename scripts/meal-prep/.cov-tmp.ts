import fs from "fs";
import { seedCatalog } from "../../server/meal-prep/food/catalog";
const items: [string, number][] = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const cat = seedCatalog();
let lines = 0, hit = 0; const byMethod: Record<string, number> = {}; const miss: string[] = []; const weak: string[] = [];
for (const [item, n] of items) {
  lines += n;
  const m = cat.matcher.match(item);
  if (m) { hit += n; byMethod[m.method] = (byMethod[m.method] || 0) + n; if (m.method !== "exact" && m.method !== "normalized") weak.push(`${item} -> ${m.id} (${m.method} ${m.score.toFixed(2)}) x${n}`); }
  else miss.push(`${item} x${n}`);
}
console.log({ lines, hit, pct: (hit / lines * 100).toFixed(1), byMethod, distinctMiss: miss.length });
fs.writeFileSync(process.argv[3], "MISS\n" + miss.join("\n") + "\n\nWEAK\n" + weak.join("\n"));
