import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { getSharedPool } from "./pg-pool";

// Standard Postgres connection (a pool), so the app runs on any Postgres:
// Railway's, Neon's, or local. (It used Neon's HTTP driver until the move to
// Railway's database in October 2026.)

if (!process.env.DATABASE_URL) {
  throw new Error(
    `DATABASE_URL environment variable is not set.`
  );
}

export const db = drizzle(getSharedPool(), { schema });
