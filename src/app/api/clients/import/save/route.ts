import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { commitClients, type ImportRow } from "@/lib/server/clientImport";
import { badRequest, readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { rows: [{ action: "create" | "update" | "skip", clientId?, fields, sendLogin?, guardian? }] } — saves what the coach approved
 * (up to 50). A blank value never erases anything. New clients get a login (shown once; emailed when asked and an address is known).
 */
export const POST = route(async (req) => {
  const body = await readJson(req, 200_000);
  const me = await requireUser(["OWNER", "COACH"]);
  if (!Array.isArray(body.rows)) throw badRequest("Nothing to import.");
  const rows: ImportRow[] = body.rows.map((r: unknown) => {
    const x = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    return {
      action: x.action === "create" ? "create" : x.action === "update" ? "update" : "skip",
      clientId: typeof x.clientId === "string" ? x.clientId : undefined,
      fields: (x.fields && typeof x.fields === "object" ? x.fields : {}) as ImportRow["fields"],
      sendLogin: x.sendLogin === true,
      guardian: x.guardian === true,
    };
  });
  const origin = process.env.APP_URL || new URL(req.url).origin;
  return NextResponse.json({ results: await commitClients(me, rows, origin) });
});
