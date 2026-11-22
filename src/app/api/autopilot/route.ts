import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import * as A from "@/lib/server/autopilot";
import { listPackages } from "@/lib/server/payments";
import { listPrograms } from "@/lib/server/programs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — everything the Autopilot page needs: the rules, drafts and held messages, the recent log, smart-reply settings, and your packages and programs. */
export const GET = route(async () => {
  const me = await requireUser(["OWNER", "COACH"]);
  const [rules, waiting, log, smart, packages, programs] = await Promise.all([
    A.listRules(me),
    A.listEvents(me, { status: ["DRAFT", "HELD"], limit: 100 }),
    A.listEvents(me, { status: ["SENT", "APPROVED", "DISMISSED", "FAILED"], limit: 60 }),
    A.smartSettings(me),
    listPackages(me.id, true),
    listPrograms(me),
  ]);
  return NextResponse.json({ rules, waiting, log, smart, packages, programs: programs.map((p) => ({ id: p.id, name: p.name })) });
});
