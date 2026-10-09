import { Pool } from "pg";

let sharedPool: Pool | null = null;

/** Hosted databases reached over the internet need TLS; Railway's private network doesn't */
function sslFor(url: string): false | { rejectUnauthorized: boolean } {
  if (/sslmode=disable/.test(url) || /\.railway\.internal|localhost|127\.0\.0\.1/.test(url)) return false;
  if (/sslmode=require|neon\.tech/.test(url)) return { rejectUnauthorized: false };
  return false;
}

/** The app's one connection pool (Drizzle and the few raw queries share it) */
export function getSharedPool(): Pool {
  if (!sharedPool) {
    const connectionString = process.env.DATABASE_URL!;
    sharedPool = new Pool({
      connectionString,
      ssl: sslFor(connectionString),
      max: Number(process.env.DB_POOL_MAX || 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    });
    sharedPool.on("error", (err) => console.error("[DB] Idle connection error:", err.message));
  }
  return sharedPool;
}
