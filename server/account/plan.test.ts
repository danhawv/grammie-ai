import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getTableName, is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";
import { DELETION_STEPS, EMAIL_STEPS, mediaKeysIn, printOrderInProgress } from "./plan";

const covered = new Set(DELETION_STEPS.map((s) => `${s.table}.${s.column}`));

/** "table.column" for every column in shared/schema.ts with a foreign key to users */
function schemaUserRefs(): string[] {
  const out: string[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const cfg = getTableConfig(value);
    for (const fk of cfg.foreignKeys) {
      const ref = fk.reference();
      if (getTableName(ref.foreignTable) !== "users") continue;
      for (const col of ref.columns) out.push(`${cfg.name}.${col.name}`);
    }
  }
  return out;
}

/** "table.column" for every `col ... REFERENCES users` in migrations/*.sql */
function migrationUserRefs(): string[] {
  const dir = path.resolve(import.meta.dirname, "../../migrations");
  const out: string[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8").replace(/--.*$/gm, "");
    // CREATE TABLE blocks: columns written inline
    for (const m of Array.from(sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+"?(\w+)"?\s*\(([\s\S]*?)\n\);/gi))) {
      for (const line of m[2].split("\n")) {
        const c = line.match(/^\s*"?(\w+)"?\s.*REFERENCES\s+"?(?:public"?\."?)?users"?\s*\(/i);
        if (c) out.push(`${m[1]}.${c[1]}`);
      }
    }
    // ALTER TABLE ... FOREIGN KEY (col) REFERENCES users
    for (const m of Array.from(sql.matchAll(/ALTER TABLE\s+"?(\w+)"?[^;]*?FOREIGN KEY\s*\("?(\w+)"?\)\s*REFERENCES\s+"?(?:public"?\."?)?"?users"?/gi))) {
      out.push(`${m[1]}.${m[2]}`);
    }
    // ALTER TABLE ... ADD COLUMN col ... REFERENCES users
    for (const m of Array.from(sql.matchAll(/ALTER TABLE\s+"?(\w+)"?\s+ADD COLUMN(?: IF NOT EXISTS)?\s+"?(\w+)"?[^;]*?REFERENCES\s+"?users"?/gi))) {
      out.push(`${m[1]}.${m[2]}`);
    }
  }
  return out;
}

describe("account deletion plan", () => {
  it("covers every column in shared/schema.ts that references users", () => {
    const refs = schemaUserRefs();
    expect(refs.length).toBeGreaterThan(30);
    const missing = refs.filter((r) => !covered.has(r));
    expect(missing, "add these to DELETION_STEPS in server/account/plan.ts").toEqual([]);
  });

  it("covers every column in migrations/*.sql that references users", () => {
    const refs = migrationUserRefs();
    expect(refs).toContain("parties.owner_user_id");
    expect(refs).toContain("guest_sessions.user_id");
    expect(refs).toContain("bookmarks.user_id");
    const missing = refs.filter((r) => !covered.has(r));
    expect(missing, "add these to DELETION_STEPS in server/account/plan.ts").toEqual([]);
  });

  it("lists only real tables and columns, once each", () => {
    const known = new Set([...schemaUserRefs(), ...migrationUserRefs()]);
    for (const key of Array.from(covered)) expect(known.has(key), key).toBe(true);
    expect(covered.size).toBe(DELETION_STEPS.length);
    for (const s of [...DELETION_STEPS, ...EMAIL_STEPS]) expect(s.table + s.column).toMatch(/^[a-z_]+$/);
  });

  it("only clears (doesn't delete) rows that belong to someone else", () => {
    const nullified = DELETION_STEPS.filter((s) => s.action === "nullify").map((s) => `${s.table}.${s.column}`);
    expect(nullified).toEqual(["meal_plan_entries.assigned_user_id"]);
  });

  it("finds /media/ keys in URLs and JSON", () => {
    expect(mediaKeysIn([
      "/media/template-bg-abc123.png",
      [{ name: "Font", format: "woff2", dataUrl: "/media/template-font-def.woff2" }],
      "data:image/png;base64,AAAA",
      null,
      "/media/../etc/passwd",
    ]).sort()).toEqual(["template-bg-abc123.png", "template-font-def.woff2"]);
  });

  it("knows which print orders are still in progress", () => {
    const now = new Date("2026-11-21T12:00:00Z");
    const recent = new Date("2026-11-21T11:30:00Z");
    const old = new Date("2026-11-20T11:00:00Z");
    const o = (status: string, luluStatus: string | null = null, updatedAt = recent) => printOrderInProgress({ status, luluStatus, updatedAt }, now);
    expect(o("paid")).toBe(true);
    expect(o("submitted", "IN_PRODUCTION")).toBe(true);
    expect(o("submitted", null)).toBe(true);
    expect(o("submitted", "SHIPPED")).toBe(false);
    expect(o("submitted", "REJECTED")).toBe(false);
    expect(o("awaiting_payment")).toBe(true);
    expect(o("awaiting_payment", null, old)).toBe(false);
    expect(o("preparing", null, old)).toBe(false);
    expect(o("failed")).toBe(false);
    expect(o("refunded")).toBe(false);
    expect(o("canceled")).toBe(false);
  });
});
