import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export { schema };

type DrizzleClient = ReturnType<typeof drizzle<typeof schema>>;

interface GlobalCache {
  __clinicTranslatorDb?: DrizzleClient;
  __clinicTranslatorPg?: ReturnType<typeof postgres>;
}

const globalCache = globalThis as unknown as GlobalCache;

function buildClient(): DrizzleClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Required for the Drizzle client (see .env.example).",
    );
  }
  // Vercel functions are short-lived; small pool, prepared off (pgbouncer-friendly).
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  globalCache.__clinicTranslatorPg = sql;
  return drizzle(sql, { schema });
}

export const db: DrizzleClient =
  globalCache.__clinicTranslatorDb ?? (globalCache.__clinicTranslatorDb = buildClient());
