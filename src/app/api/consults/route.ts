import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { soloBoard, startConsult, trainerBoard } from "@/lib/server/consult";
import { assertSameOrigin, readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — someone training on their own: whether they can book and their consults. A trainer: requests waiting, their live consult, history. */
export const GET = route(async () => {
  const me = await requireUser();
  return NextResponse.json(me.role === "CLIENT" ? { role: "SOLO", ...(await soloBoard(me)) } : { role: "TRAINER", ...(await trainerBoard(me)) });
});

/** POST { question?, shareHealth? } — ask for a consult: returns the Stripe Checkout address (the card is only held until a trainer accepts). */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const body = await readJson(req);
  const me = await requireUser(["CLIENT"]);
  const origin = process.env.APP_URL || new URL(req.url).origin;
  return NextResponse.json(await startConsult(me, body, origin));
});
