import { Pool } from "pg";

const globalForAuthDatabase = globalThis as typeof globalThis & {
  commercePilotAuthPool?: Pool;
  commercePilotDatabaseSecurityCheck?: Promise<void>;
};

export function getAuthDatabase(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for Commerce Pilot authentication.");
  }

  if (!globalForAuthDatabase.commercePilotAuthPool) {
    const pool = new Pool({
      connectionString,
      max: readPoolInteger("COMMERCE_DATABASE_POOL_MAX", process.env.NODE_ENV === "production" ? 20 : 5, 1, 100),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: readPoolInteger("COMMERCE_DATABASE_CONNECT_TIMEOUT_MS", 5_000, 100, 60_000),
    });
    // pg removes the failed idle client before emitting this event. Without a
    // listener, a database restart can terminate the entire Web/worker process.
    pool.on("error", () => {
      globalForAuthDatabase.commercePilotDatabaseSecurityCheck = undefined;
      console.error("Commerce Pilot PostgreSQL pool lost an idle connection; it will be replaced.");
    });
    globalForAuthDatabase.commercePilotAuthPool = pool;
  }

  return globalForAuthDatabase.commercePilotAuthPool;
}

export function assertApplicationDatabaseRoleSecurity(): Promise<void> {
  if (process.env.COMMERCE_DATABASE_ROLE_MODE === "migration") return Promise.resolve();
  if (!globalForAuthDatabase.commercePilotDatabaseSecurityCheck) {
    globalForAuthDatabase.commercePilotDatabaseSecurityCheck = getAuthDatabase()
      .query<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>(
        `
          SELECT current_user, role.rolsuper, role.rolbypassrls
          FROM pg_roles role
          WHERE role.rolname = current_user
        `,
      )
      .then((result) => {
        const role = result.rows[0];
        if (!role) throw new Error("Unable to verify the PostgreSQL application role.");
        const enforce =
          process.env.NODE_ENV === "production" || process.env.COMMERCE_ENFORCE_DATABASE_RLS === "true";
        if (enforce && (role.rolsuper || role.rolbypassrls)) {
          throw new Error(
            "Commerce Pilot refuses to run with a PostgreSQL superuser or BYPASSRLS application role.",
          );
        }
      })
      .catch((error: unknown) => {
        // Fail this request closed, but permit a later request to verify again
        // after a transient outage. Never retry a business query or transaction.
        globalForAuthDatabase.commercePilotDatabaseSecurityCheck = undefined;
        throw error;
      });
  }
  return globalForAuthDatabase.commercePilotDatabaseSecurityCheck;
}

function readPoolInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}
