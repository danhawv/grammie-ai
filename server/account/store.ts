// Account deletion storage. The route (routes/account.ts) uses this interface
// so tests can run on the in-memory fake in routes/account.test.ts; the
// Postgres version is below. Plain SQL on the shared pool: it covers tables
// that aren't in Drizzle's view (users.is_guest) and checks what exists first.

import type { Pool } from "pg";
import {
  DELETION_STEPS, EMAIL_STEPS, MEDIA_COLUMNS, MEDIA_OWNER, mediaKeysIn, printOrderInProgress,
  type DeletionResult,
} from "./plan";

export interface AccountStore {
  /** null when there's no such user */
  find(userId: string): Promise<{ isGuest: boolean } | null>;
  /** How many of their print orders are still being paid for, printed or shipped */
  printOrdersInProgress(userId: string): Promise<number>;
  /** Removes everything they own and the users row, all or nothing */
  deleteAll(userId: string): Promise<DeletionResult>;
  /** Of these /media/ keys, the ones no remaining row uses */
  unusedMediaKeys(keys: string[]): Promise<string[]>;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`Bad identifier: ${name}`);
  return `"${name}"`;
}

export function createPgAccountStore(pool: Pool): AccountStore {
  async function existingColumns(q: Pool | { query: Pool["query"] }): Promise<Set<string>> {
    const { rows } = await q.query(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()`,
    );
    return new Set(rows.map((r: any) => `${r.table_name}.${r.column_name}`));
  }

  return {
    async find(userId) {
      const cols = await existingColumns(pool);
      const guestCol = cols.has("users.is_guest") ? "is_guest" : "false AS is_guest";
      const { rows } = await pool.query(`SELECT ${guestCol} FROM users WHERE id = $1`, [userId]);
      return rows[0] ? { isGuest: !!rows[0].is_guest } : null;
    },

    async printOrdersInProgress(userId) {
      try {
        const { rows } = await pool.query(
          `SELECT status, lulu_status, updated_at FROM print_orders WHERE owner_user_id = $1`,
          [userId],
        );
        return rows.filter((r: any) => printOrderInProgress({
          status: r.status, luluStatus: r.lulu_status, updatedAt: new Date(r.updated_at),
        })).length;
      } catch (err: any) {
        if (err?.code === "42P01") return 0; // no print_orders table here
        throw err;
      }
    },

    async deleteAll(userId) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const cols = await existingColumns(client);
        const has = (t: string, c: string) => cols.has(`${t}.${c}`);

        const { rows: [user] } = await client.query(
          `SELECT id, clerk_id, email FROM users WHERE id = $1 FOR UPDATE`, [userId],
        );
        if (!user) throw new Error("No such user");

        // Media files their rows use, read before the rows go
        const mediaValues: unknown[] = [];
        for (const m of MEDIA_COLUMNS) {
          const owner = MEDIA_OWNER[m.table];
          if (!has(m.table, m.column) || !has(m.table, owner)) continue;
          const { rows } = await client.query(
            `SELECT ${ident(m.column)} AS v FROM ${ident(m.table)} WHERE ${ident(owner)} = $1 AND ${ident(m.column)}::text LIKE '%/media/%'`,
            [userId],
          );
          for (const r of rows) mediaValues.push(r.v);
        }

        const counts: Record<string, number> = {};
        const skipped: string[] = [];
        for (const step of DELETION_STEPS) {
          const key = `${step.table}.${step.column}`;
          if (!has(step.table, step.column)) { skipped.push(key); continue; }
          const t = ident(step.table), c = ident(step.column);
          const res = step.action === "nullify"
            ? await client.query(`UPDATE ${t} SET ${c} = NULL WHERE ${c} = $1`, [userId])
            : await client.query(`DELETE FROM ${t} WHERE ${c} = $1`, [userId]);
          counts[key] = res.rowCount ?? 0;
        }

        if (user.email) {
          for (const step of EMAIL_STEPS) {
            const key = `${step.table}.${step.column}`;
            if (!has(step.table, step.column)) { skipped.push(key); continue; }
            const res = await client.query(
              `DELETE FROM ${ident(step.table)} WHERE lower(${ident(step.column)}) = lower($1)`, [user.email],
            );
            counts[key] = res.rowCount ?? 0;
          }
        }

        // Older sign-in sessions (connect-pg-simple) that name this user
        if (has("sessions", "sess")) {
          const res = await client.query(
            `DELETE FROM sessions WHERE sess->'passport'->'user'->'claims'->>'sub' = $1`, [userId],
          );
          counts["sessions.sess"] = res.rowCount ?? 0;
        }

        const res = await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
        counts["users.id"] = res.rowCount ?? 0;

        await client.query("COMMIT");
        return { counts, skipped, clerkId: user.clerk_id ?? null, mediaKeys: mediaKeysIn(mediaValues) };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async unusedMediaKeys(keys) {
      if (keys.length === 0) return [];
      const cols = await existingColumns(pool);
      const unused: string[] = [];
      for (const key of keys) {
        let used = false;
        for (const m of MEDIA_COLUMNS) {
          if (!cols.has(`${m.table}.${m.column}`)) continue;
          const { rows } = await pool.query(
            `SELECT 1 FROM ${ident(m.table)} WHERE ${ident(m.column)}::text LIKE $1 LIMIT 1`,
            [`%/media/${key.replace(/[\\%_]/g, "\\$&")}%`],
          );
          if (rows.length) { used = true; break; }
        }
        if (!used) unused.push(key);
      }
      return unused;
    },
  };
}
