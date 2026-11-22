import "server-only";
import { createHash } from "node:crypto";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { DDL as MAIN_DDL } from "./schema";
import { FLOW_DDL } from "./schemaFlow";
import * as schema from "./schema";

/** The main tables, then the programs and Autopilot tables (schemaFlow.ts). */
const DDL = [...MAIN_DDL, ...FLOW_DDL];

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
  await ensureSchema(client);
  return d as unknown as Db;
}

/**
 * Tables are created on first use, so a fresh Neon database needs no manual migration. The DDL is a lot of statements, and over
 * HTTP each one is a round trip, so it is (1) skipped when the stored fingerprint of the DDL matches, and (2) otherwise sent as
 * one batched transaction. A cold start on an up-to-date database therefore costs a single quick query.
 */
async function ensureSchema(client: NeonQueryFunction<false, false>): Promise<void> {
  const fingerprint = createHash("sha1").update(DDL.join(";")).digest("hex");
  try {
    const rows = (await client.query("SELECT v FROM schema_meta WHERE id = 1")) as { v?: string }[];
    if (rows[0]?.v === fingerprint) return;
  } catch {
    /* no schema_meta table yet: first run (or an older database) */
  }
  try {
    await client.transaction((txn) => [
      txn.query("CREATE TABLE IF NOT EXISTS schema_meta (id integer PRIMARY KEY, v text NOT NULL)"),
      ...DDL.map((stmt) => txn.query(stmt)),
      txn.query("INSERT INTO schema_meta (id, v) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET v = EXCLUDED.v", [fingerprint]),
    ]);
  } catch (e) {
    // Never block the app on the fast path: fall back to one statement at a time.
    console.error("Batched schema setup failed, retrying one by one", e instanceof Error ? e.message : "");
    for (const stmt of DDL) await client.query(stmt);
  }
}

/**
 * The local test database lives in memory, and Next keeps separate copies of this module for API routes and for pages rendered on the
 * server; kept on globalThis, both use the same database (otherwise a server-rendered page would see an empty one).
 */
const local = globalThis as unknown as { __coachflowLocalDb?: Promise<Db> };

export function db(): Promise<Db> {
  if (isLocalTestMode()) {
    if (!local.__coachflowLocalDb) {
      local.__coachflowLocalDb = open().catch((e) => {
        local.__coachflowLocalDb = undefined;
        throw e;
      });
    }
    return local.__coachflowLocalDb;
  }
  if (!handle) {
    handle = open().catch((e) => {
      handle = undefined;
      throw e;
    });
  }
  return handle;
}
