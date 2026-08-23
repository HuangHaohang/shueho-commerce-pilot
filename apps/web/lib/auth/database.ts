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
    globalForAuthDatabase.commercePilotAuthPool = new Pool({
      connectionString,
      max: process.env.NODE_ENV === "production" ? 20 : 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
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
      });
  }
  return globalForAuthDatabase.commercePilotDatabaseSecurityCheck;
}
