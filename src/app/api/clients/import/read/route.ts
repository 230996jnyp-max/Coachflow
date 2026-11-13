import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readClients } from "@/lib/server/clientImport";
import { readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { text, targetClientId? } — reads pasted or uploaded client details (a table, "Name: value" lines, or free text read by AI) into
 * candidate clients, each marked when it matches someone the coach already has. Nothing is saved here: the coach reviews first.
 */
export const POST = route(async (req) => {
  const body = await readJson(req, 40_000);
  const me = await requireUser(["OWNER", "COACH"]);
  return NextResponse.json(await readClients(me, { text: body.text, targetClientId: body.targetClientId }));
});
