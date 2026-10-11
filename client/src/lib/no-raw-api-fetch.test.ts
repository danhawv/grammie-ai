import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// Requests to our own server must go through apiFetch / apiRequest
// (client/src/lib/platform.ts) so they reach the right host and carry sign-in
// inside the iPhone/iPad app. A plain fetch("/api/...") works in a browser and
// silently breaks in the app, so this test keeps them from creeping back.

const SRC = path.resolve(import.meta.dirname, "..");
const ALLOWED = new Set([path.join(SRC, "lib", "platform.ts")]);

const RULES: { name: string; pattern: RegExp }[] = [
  { name: "fetch() to /api (use apiFetch)", pattern: /(?<![\w.])fetch\(\s*[`"'](\/api|\/media)/ },
  { name: "<img src> straight to /api (use privateImageUrl or mediaUrl)", pattern: /src=\{?\s*[`"']\/api\// },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("requests to our server go through the platform helpers", () => {
  it("has no raw /api fetches or <img> URLs outside platform.ts", () => {
    const found: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (ALLOWED.has(file)) continue;
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        for (const rule of RULES) {
          if (rule.pattern.test(line)) found.push(`${path.relative(SRC, file)}:${i + 1} ${rule.name}`);
        }
      });
    }
    expect(found).toEqual([]);
  });
});
