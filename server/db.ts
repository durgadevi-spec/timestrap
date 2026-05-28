import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

/* ================================
   Safety Check
================================ */
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?"
  );
}

/* ================================
   PostgreSQL Connection Pool
================================ */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  ssl: {
    rejectUnauthorized: false, // ✅ Required for Neon
  },
});

/* ================================
   Drizzle ORM Instance
================================ */
export const db = drizzle(pool, {
  schema,
  logger: process.env.NODE_ENV === "development",
});
