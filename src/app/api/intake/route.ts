import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { badRequest, readJson, route } from "@/lib/server/http";
import { intakeFor, intakeTodoFor, requestPack, submitForm } from "@/lib/server/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET [?clientId=] — a client: their own forms and what's still to do. A coach: every version of a client's forms. */
export const GET = route(async (req) => {
  const me = await requireUser();
  if (me.role === "CLIENT") return NextResponse.json({ intake: await intakeFor(me, me.id), todo: await intakeTodoFor(me) });
  const clientId = new URL(req.url).searchParams.get("clientId") ?? "";
  if (!clientId) throw badRequest("Choose a client.");
  return NextResponse.json({ intake: await intakeFor(me, clientId) });
});

/**
 * POST — a client submits a form: { kind: "PARQ" | "DECLARATION" | "GOALS", data }. A coach asks a client for the pack:
 * { clientId, kinds? }. Every submission is a new version; older ones are kept.
 */
export const POST = route(async (req) => {
  const body = await readJson(req, 200_000);
  const me = await requireUser();
  if (me.role === "CLIENT") return NextResponse.json({ form: await submitForm(me, body.kind, body.data) });
  if (typeof body.clientId !== "string") throw badRequest("Choose a client.");
  const id = await requestPack(me, body.clientId, body.kinds);
  return NextResponse.json({ ok: true, id });
});
