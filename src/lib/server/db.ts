import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { DDL } from "./schema";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Local-only test mode: LOCAL_PGLITE=1 swaps Neon for an in-memory Postgres (PGlite) so the whole app can be exercised
 * end to end without touching production data. The variable is never set on Vercel.
 */
export const isLocalTestMode = () => process.env.LOCAL_PGLITE === "1" && !process.env.VERCEL;

/** Connection string with TLS enforced (Neon requires it; we also pin sslmode=require explicitly). */
function connectionString(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");
  const url = new URL(raw);
  url.searchParams.set("sslmode", "require");
  return url.toString();
}

let handle: Promise<Db> | undefined;

async function open(): Promise<Db> {
  if (isLocalTestMode()) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
    const client = new PGlite();
    for (const stmt of DDL) await client.exec(stmt);
    return drizzlePglite(client, { schema }) as unknown as Db;
  }
  const client = neon(connectionString());
  const d = drizzle(client, { schema });
  // Tables are created on first use, so a fresh Neon database needs no manual migration.
  for (const stmt of DDL) await client.query(stmt);
  return d as unknown as Db;
}

export function db(): Promise<Db> {
  if (!handle) {
    handle = open().catch((e) => {
      handle = undefined;
      throw e;
    });
  }
  return handle;
}
