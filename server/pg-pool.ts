import { Pool } from "pg";

let sharedPool: Pool | null = null;

/** Hosted databases reached over the internet need TLS; Railway's private network doesn't */
function sslFor(url: string): false | { rejectUnauthorized: boolean } {
  if (/sslmode=disable/.test(url) || /\.railway\.internal|localhost|127\.0\.0\.1/.test(url)) return false;
  if (/sslmode=require|neon\.tech|proxy\.rlwy\.net/.test(url)) return { rejectUnauthorized: false };
  return false;
}

/** The app's one connection pool (Drizzle and the few raw queries share it) */
export function getSharedPool(): Pool {
  if (!sharedPool) {
    const url = process.env.DATABASE_URL!;
    // sslmode in the URL overrides the ssl option below (and newer pg treats
    // "require" as full certificate checks, which Railway's proxy fails), so
    // TLS is set only here
    const connectionString = url.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, "");
    sharedPool = new Pool({
      connectionString,
      ssl: sslFor(url),
      max: Number(process.env.DB_POOL_MAX || 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    });
    sharedPool.on("error", (err) => console.error("[DB] Idle connection error:", err.message));
  }
  return sharedPool;
}
