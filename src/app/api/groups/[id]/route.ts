import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/server/auth";
import { decryptJson } from "@/lib/server/crypto";
import { db } from "@/lib/server/db";
import {
  assertCoach,
  bookSpot,
  cancelGroup,
  cancelRequest,
  coachAddMember,
  GROUP_MAX,
  leaveGroup,
  loadGroups,
  notify,
  openGroup,
  promoteWaitlist,
  requestJoin,
  requireGroup,
  sealGroup,
  startGroupWorkout,
  whenText,
} from "@/lib/server/groups";
import { badRequest, conflict, forbidden, int, readJson, route, str } from "@/lib/server/http";
import { hasConflict, parsePlace, requestLoc, rulesFor, travelCheck } from "@/lib/server/schedule";
import { attendance, groupMembers, groupSessions, gyms, templates } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const COACH_ACTIONS = ["edit", "cancel", "addMember", "removeMember", "start"];

/**
 * PATCH { action } on one group.
 *  client: book | leave | request | unshare
 *  coach:  edit | cancel | addMember | removeMember | start   (attendance and completing live in /api/attendance)
 * Every action returns the refreshed class screens for the caller.
 */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser();
  const { id } = await ctx.params;
  const g = await requireGroup(id);
  const d = await db();
  const isClient = me.role === "CLIENT";
  const action = String(body.action ?? "");
  const out = async (extra: Record<string, unknown> = {}) => NextResponse.json({ ...(await loadGroups(me)), ...extra });

  if (isClient) {
    if (me.coachId !== g.coachId) throw forbidden();
    switch (action) {
      case "book": {
        const status = await bookSpot(me, g);
        return out({ result: status });
      }
      case "leave": {
        await leaveGroup(g, me.id);
        return out();
      }
      case "request": {
        const rq = await requestJoin(me, g);
        return out({ requestId: rq.id });
      }
      case "cancelRequest": {
        await cancelRequest(me, str(body.requestId, "Request", { max: 80 }));
        return out();
      }
      case "unshare": {
        const [own] = await d.select().from(groupMembers).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.clientId, me.id), eq(groupMembers.role, "OWNER"))).limit(1);
        if (!own || g.kind !== "SHARED") throw forbidden();
        const [marked] = await d.select({ id: attendance.id }).from(attendance).where(and(eq(attendance.kind, "BOOKING"), eq(attendance.sessionId, g.bookingId ?? ""))).limit(1);
        if (marked) throw conflict("Attendance has already been marked for this session.");
        const others = await d.select().from(groupMembers).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.status, "CONFIRMED"), eq(groupMembers.role, "MEMBER")));
        if (others.length) throw conflict("Someone has already joined, so this session can't be closed to partners.");
        await d.update(groupSessions).set({ status: "CANCELLED", rev: g.rev + 1 }).where(eq(groupSessions.id, g.id));
        return out();
      }
      default:
        if (COACH_ACTIONS.includes(action)) throw forbidden();
        throw badRequest("Unknown action.");
    }
  }

  assertCoach(me, g);
  const det = openGroup(g);

  switch (action) {
    case "edit": {
      const next = { ...det };
      let start = g.startAt;
      let end = g.endAt;
      let capacity = g.capacity;
      const rules = await rulesFor(me.id);
      if (g.kind === "CLASS") {
        if ("title" in body) next.title = str(body.title, "Class title", { max: 100 });
        if ("notes" in body) next.notes = str(body.notes, "Notes", { optional: true, max: 500 });
        if ("templateId" in body) {
          if (typeof body.templateId === "string" && body.templateId) {
            const [t] = await (await db()).select().from(templates).where(and(eq(templates.id, body.templateId), eq(templates.ownerId, me.id))).limit(1);
            if (!t) throw badRequest("That routine wasn't found.");
            next.templateId = t.id;
            next.templateName = decryptJson<{ name: string }>(t.dataEnc, `template:${t.id}`).name;
          } else {
            next.templateId = undefined;
            next.templateName = undefined;
          }
        }
        if ("gymId" in body || "customGym" in body || "place" in body) {
          const gymId = typeof body.gymId === "string" && body.gymId ? body.gymId.slice(0, 80) : null;
          const place = gymId ? undefined : parsePlace(body.place);
          const customGym = str(body.customGym, "Location", { optional: true, max: 140 }) || place?.name || "";
          if (!gymId && !customGym) throw badRequest("Please choose where the class is held.");
          if (gymId) {
            const [gy] = await d.select().from(gyms).where(and(eq(gyms.id, gymId), eq(gyms.coachId, me.id))).limit(1);
            if (!gy) throw badRequest("Unknown gym.");
          }
          next.gymId = gymId;
          next.customGym = customGym || undefined;
          next.place = place;
        }
        if ("start" in body || "durationMin" in body) {
          const s = "start" in body ? new Date(str(body.start, "Start time", { max: 40 })) : g.startAt;
          if (Number.isNaN(s.getTime())) throw badRequest("Invalid start time.");
          const mins = "durationMin" in body ? int(body.durationMin, "Length", 15, 300) : Math.round((g.endAt.getTime() - g.startAt.getTime()) / 60000);
          start = s;
          end = new Date(s.getTime() + mins * 60000);
        }
      }
      if ("capacity" in body) {
        capacity = int(body.capacity, "Spots", 2, GROUP_MAX);
        const members = await d.select().from(groupMembers).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.status, "CONFIRMED")));
        if (capacity < members.length) throw badRequest(`${members.length} people are already booked in. Remove someone first to go below that.`);
      }
      const moved = start.getTime() !== g.startAt.getTime() || end.getTime() !== g.endAt.getTime();
      const placeChanged = g.kind === "CLASS" && ("gymId" in body || "customGym" in body || "place" in body);
      if (g.kind === "CLASS" && (moved || placeChanged)) {
        if (moved && (await hasConflict(me.id, start, end, undefined, g.id))) throw conflict("That time overlaps another session.");
        if (body.waiveTravel !== true) {
          const travel = await travelCheck(me.id, start, end, requestLoc({ gymId: next.gymId ?? null, customGym: next.customGym, place: next.place }), rules, g.id, true);
          if (travel) throw conflict(travel);
        }
      }
      await d.update(groupSessions).set({ startAt: start, endAt: end, capacity, rev: g.rev + 1, detailsEnc: sealGroup(g.id, next) }).where(eq(groupSessions.id, g.id));
      if (moved) {
        const members = await d.select().from(groupMembers).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.status, "CONFIRMED")));
        await notify(members.map((m) => m.clientId), "group_moved", { title: "Class time changed", body: `“${next.title}” moved to ${await whenText(g.coachId, start)}. If that doesn't work for you, you can leave the class — no credit is used.`, link: `/classes/${g.id}` });
      }
      const fresh = await requireGroup(g.id);
      if (capacity > g.capacity) await promoteWaitlist(fresh);
      return out();
    }
    case "cancel": {
      if (g.kind !== "CLASS") throw badRequest("Cancel the client's booking to close a shared session.");
      if (g.status !== "OPEN") throw badRequest("This class is already closed.");
      await cancelGroup(g, str(body.reason, "Reason", { optional: true, max: 200 }));
      return out();
    }
    case "addMember": {
      await coachAddMember(me, g, str(body.clientId, "Client", { max: 80 }));
      return out();
    }
    case "removeMember": {
      const clientId = str(body.clientId, "Client", { max: 80 });
      await leaveGroup(g, clientId);
      await notify([clientId], "group_removed", { title: "Removed from a class", body: `Your coach removed you from “${det.title}”. No group credit was used.`, link: "/book" });
      return out();
    }
    case "start": {
      const n = await startGroupWorkout(me, g, { templateId: typeof body.templateId === "string" ? body.templateId : undefined, plan: body.plan, title: typeof body.title === "string" ? body.title : undefined });
      return out({ pushed: n });
    }
    default:
      throw badRequest("Unknown action.");
  }
});

