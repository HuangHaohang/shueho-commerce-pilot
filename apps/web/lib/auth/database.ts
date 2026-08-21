import { Pool } from "pg";

const globalForAuthDatabase = globalThis as typeof globalThis & {
  commercePilotAuthPool?: Pool;
};

export function getAuthDatabase(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for Commerce Pilot authentication.");
  }

  if (!globalForAuthDatabase.commercePilotAuthPool) {
    globalForAuthDatabase.commercePilotAuthPool = new Pool({
      connectionString,
      max: process.env.NODE_ENV === "production" ? 20 : 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  return globalForAuthDatabase.commercePilotAuthPool;
}
