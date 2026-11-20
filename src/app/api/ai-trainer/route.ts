import { NextResponse } from "next/server";
import { buildPlan, reportHurts, requireSolo, resumeTraining, saveProfile, trainerView } from "@/lib/server/aiTrainer";
import { requireUser } from "@/lib/server/auth";
import { badRequest, readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the signed-in solo trainee's AI trainer: whether it is set up, this week's plan, and whether it is paused. */
export const GET = route(async () => {
  const me = await requireUser(["CLIENT"]);
  return NextResponse.json({ trainer: await trainerView(me) });
});

/**
 * POST { action }
 *  setup  { parq, goals, equipment, accepted, clearance? }  save the health answers and goals (any "yes" needs clearance)
 *  plan                                                     build this week's plan (next week's looks back at how it went)
 *  rebuild                                                  build this week's plan again
 *  hurts  { note? }                                         "something hurts": pause the plan
 *  resume { confirmed }                                     restart after it has been looked at
 */
export const POST = route(async (req) => {
  const body = await readJson(req, 60_000);
  const me = await requireUser(["CLIENT"]);
  requireSolo(me);
  switch (body.action) {
    case "setup":
      return NextResponse.json({ trainer: await saveProfile(me, body) });
    case "plan":
      return NextResponse.json({ trainer: await buildPlan(me) });
    case "rebuild":
      return NextResponse.json({ trainer: await buildPlan(me, { rebuild: true }) });
    case "hurts": {
      const r = await reportHurts(me, body.note);
      const { urgent, ...trainer } = r;
      return NextResponse.json({ trainer, urgent });
    }
    case "resume":
      return NextResponse.json({ trainer: await resumeTraining(me, body.confirmed) });
    default:
      throw badRequest("Unknown action.");
  }
});
