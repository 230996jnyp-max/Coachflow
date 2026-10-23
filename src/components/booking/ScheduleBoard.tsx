"use client";

import { addDays, addWeeks, format, isSameDay, parseISO, startOfWeek } from "date-fns";
import { CalendarPlus, Car, ChevronLeft, ChevronRight, Lock, MapPin, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { GymSelect } from "@/components/GymSelect";
import { classesAsBookings, classTitle, spotsLabel } from "@/components/groups/groupUi";
import { Button, Card, Field, IconButton } from "@/components/ui";
import { gymToBooking, isGymComplete, placeForBooking } from "@/lib/gyms";
import { useViewer } from "@/lib/hooks";
import { blocksForDay, buildDaySlots, OCCUPYING, ymd, type SlotView } from "@/lib/scheduling";
import { fetchTravelNeighbors, useNow } from "@/lib/store";
import { bufferMinutes, locOf, type TravelNeighbor } from "@/lib/travel";
import type { Booking, GroupSession, PlaceInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BookModal } from "./BookModal";
import { BookingDetail } from "./BookingDetail";
import { gymName } from "./bookingUi";
import { TrainerBookModal, type TrainerBookInit } from "./TrainerBookModal";

/** Week calendar shared by clients (tap to book) and the trainer (master schedule). */
export function ScheduleBoard({ mode, clientId }: { mode: "client" | "trainer"; clientId?: string }) {
  const { db } = useViewer();
  const now = useNow(30_000);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selected, setSelected] = useState(() => ymd(new Date()));
  const [bookStart, setBookStart] = useState<Date | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [trainerInit, setTrainerInit] = useState<TrainerBookInit | null>(null);

  // Client: where they will train. The coach's travel time between locations depends on it, so the slots follow it.
  const profile = clientId ? db.clients.find((c) => c.id === clientId) : undefined;
  const [gym, setGym] = useState<string>(() => profile?.defaultGymId ?? "");
  const [place, setPlace] = useState<PlaceInfo | null>(null);
  const [travelFor, setTravelFor] = useState<{ key: string; list: TravelNeighbor[] | null } | null>(null);
  const locKey = `${gym}|${place?.placeId ?? ""}`;
  const locReady = mode === "client" && !!gym && isGymComplete(gym);
  useEffect(() => {
    if (!locReady) return;
    let alive = true;
    const timer = setTimeout(async () => {
      const loc = gymToBooking(gym, db.gyms);
      const list = await fetchTravelNeighbors({ gymId: loc.gymId, customGym: loc.customGym, place: placeForBooking(gym, place) });
      if (alive) setTravelFor({ key: locKey, list });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // db.gyms only matters for resolving a saved gym id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locReady, locKey]);
  const travel = locReady && travelFor?.key === locKey ? travelFor.list : null;

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const role = mode === "trainer" ? "TRAINER" : "CLIENT";
  // Coach group classes take up the calendar like any other session.
  const gridBookings = useMemo(() => [...db.bookings, ...classesAsBookings(db.groups, clientId)], [db.bookings, db.groups, clientId]);
  const src = { slots: db.slots, bookings: gridBookings, settings: db.settings };
  const router = useRouter();

  const perDay = days.map((d) => ({
    day: d,
    key: ymd(d),
    slots: buildDaySlots(d, src, { now, clientId, role, travel }),
    blocks: blocksForDay(d, db.slots),
    travelBlocks: mode === "trainer" ? coachTravelBlocks(d, db, gridBookings) : [],
  }));

  const go = (weeks: number) => {
    const next = addWeeks(weekStart, weeks);
    setWeekStart(next);
    setSelected(ymd(next));
  };
  const today = () => {
    const t = startOfWeek(new Date(), { weekStartsOn: 1 });
    setWeekStart(t);
    setSelected(ymd(new Date()));
  };

  const selectedKey = perDay.some((d) => d.key === selected) ? selected : perDay[0].key;

  const onSlot = (s: SlotView) => {
    if (s.booking && classOf(s.booking.id, db.groups)) {
      router.push(`/classes/${s.booking.id}`);
      return;
    }
    if (s.state === "open") {
      if (mode === "client") setBookStart(s.start);
      else setTrainerInit({ start: s.start });
    } else if (s.booking && (mode === "trainer" || s.state === "mine")) {
      setDetailId(s.booking.id);
    }
  };

  return (
    <div data-tour="schedule-board">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <IconButton label="Previous week" onClick={() => go(-1)}>
            <ChevronLeft size={20} />
          </IconButton>
          <div className="min-w-[150px] text-center text-sm font-bold">
            {format(days[0], "d MMM")} – {format(days[6], "d MMM yyyy")}
          </div>
          <IconButton label="Next week" onClick={() => go(1)}>
            <ChevronRight size={20} />
          </IconButton>
          <Button variant="ghost" size="sm" onClick={today}>
            Today
          </Button>
        </div>
        {mode === "trainer" && (
          <Button data-tour="book-client" onClick={() => setTrainerInit({})}>
            <CalendarPlus size={16} /> Book client
          </Button>
        )}
      </div>

      {mode === "client" && db.settings.travelEnabled && (
        <Card className="mb-4 space-y-2 p-4">
          <Field label="Training at" hint={locReady && travel ? "Times your coach can't reach from another gym are greyed out." : "Pick where you'll train — your coach travels between gyms, so available times depend on it."}>
            <GymSelect value={gym} onChange={setGym} noneLabel="Select a gym…" allowPlaces={db.settings.allowCustomGym} place={place} onPlace={setPlace} />
          </Field>
        </Card>
      )}

      {/* Mobile day selector */}
      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 md:hidden">
        {perDay.map(({ day, key, slots }) => {
          const isSel = key === selectedKey;
          const booked = slots.filter((s) => s.booking && (mode === "trainer" || s.state === "mine")).length;
          const open = slots.filter((s) => s.state === "open").length;
          return (
            <button
              key={key}
              onClick={() => setSelected(key)}
              className={cn(
                "flex min-h-[68px] min-w-[54px] flex-1 flex-col items-center justify-center rounded-2xl border text-center transition-colors",
                isSel ? "border-accent bg-accent text-white" : "border-line bg-surface",
              )}
            >
              <span className={cn("text-[10px] font-bold uppercase", isSel ? "text-white/80" : "text-muted")}>{format(day, "EEE")}</span>
              <span className="text-lg font-bold leading-tight">{format(day, "d")}</span>
              <span className="mt-0.5 flex h-1.5 gap-0.5">
                {booked > 0 && <span className={cn("h-1.5 w-1.5 rounded-full", isSel ? "bg-white" : "bg-success")} />}
                {open > 0 && <span className={cn("h-1.5 w-1.5 rounded-full", isSel ? "bg-white/60" : "bg-accent")} />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 md:grid-cols-7">
        {perDay.map(({ day, key, slots, blocks, travelBlocks }) => {
          const isToday = isSameDay(day, now);
          const entries = [
            ...slots.map((s) => ({ t: s.start.getTime(), s, tb: undefined as TravelBlock | undefined })),
            ...travelBlocks.map((tb) => ({ t: tb.at.getTime() - 1, s: undefined as SlotView | undefined, tb })),
          ].sort((a, b) => a.t - b.t);
          return (
            <div key={key} className={cn(key === selectedKey ? "block" : "hidden", "md:block")}>
              <div className={cn("mb-2 hidden rounded-xl px-2 py-1.5 text-center md:block", isToday ? "bg-accent/15 text-accent" : "bg-surface")}>
                <div className="text-[10px] font-bold uppercase tracking-wider">{format(day, "EEE")}</div>
                <div className="text-base font-bold">{format(day, "d")}</div>
              </div>
              <div className="space-y-2">
                {blocks.map((b) => (
                  <div key={b.id} className="flex items-center gap-2 rounded-xl border border-dashed border-line bg-field/50 px-3 py-2 text-xs text-muted">
                    <Lock size={12} /> {b.start}–{b.end} {b.label ?? "Blocked"}
                  </div>
                ))}
                {slots.length === 0 && blocks.length === 0 && (
                  <div className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-muted">No availability</div>
                )}
                {entries.map((e) =>
                  e.s ? <SlotPill key={e.s.key} s={e.s} mode={mode} onClick={() => onSlot(e.s!)} /> : <TravelPill key={e.tb!.key} tb={e.tb!} />,
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Legend mode={mode} />

      {mode === "client" && clientId && <BookModal start={bookStart} clientId={clientId} initGym={gym} initPlace={place} onClose={() => setBookStart(null)} />}
      <BookingDetail bookingId={detailId} onClose={() => setDetailId(null)} />
      <TrainerBookModal init={trainerInit} onClose={() => setTrainerInit(null)} />
    </div>
  );
}

function classOf(id: string, groups: GroupSession[]): GroupSession | undefined {
  return groups.find((g) => g.id === id && g.kind === "CLASS");
}

function SlotPill({ s, mode, onClick }: { s: SlotView; mode: "client" | "trainer"; onClick: () => void }) {
  const { db } = useViewer();
  const time = format(s.start, "h:mm a");
  const b = s.booking;
  const client = b ? db.users.find((u) => u.id === b.clientId) : undefined;
  const base = "flex min-h-[52px] w-full flex-col justify-center rounded-xl border px-3 py-2 text-left transition-colors";
  const cls = b ? classOf(b.id, db.groups) : undefined;

  if (cls) {
    const mine = cls.mine?.status === "CONFIRMED";
    return (
      <button onClick={onClick} className={cn(base, mine ? "border-success/50 bg-success/15 text-success" : "border-accent/40 bg-accent/15 text-accent hover:brightness-125")}>
        <span className="flex items-center gap-1.5 text-sm font-bold">
          <Users size={12} /> {time}
        </span>
        <span className="truncate text-[11px] font-semibold">
          {classTitle(cls)} · {mode === "trainer" ? `${cls.confirmed}/${cls.capacity} booked` : mine ? "You're in" : spotsLabel(cls)}
        </span>
      </button>
    );
  }

  if (s.state === "open") {
    return (
      <button onClick={onClick} className={cn(base, "border-accent/50 bg-accent/10 text-accent hover:bg-accent/20")}>
        <span className="text-sm font-bold">{time}</span>
        <span className="text-[11px] font-semibold opacity-80">{mode === "client" ? "Available · tap to book" : "Open · tap to book client"}</span>
        {s.backToBack && <span className="mt-0.5 text-[11px] font-semibold text-success">Coach is already at this location — back-to-back slot available!</span>}
      </button>
    );
  }
  if (s.state === "mine" && b) {
    return (
      <button
        onClick={onClick}
        className={cn(base, b.status === "PENDING" ? "border-pr/40 bg-pr/15 text-pr" : b.status === "COMPLETED" ? "border-success/30 bg-success/10 text-success" : "border-success/50 bg-success/15 text-success hover:bg-success/25")}
      >
        <span className="text-sm font-bold">{time}</span>
        <span className="truncate text-[11px] font-semibold">
          {b.status === "PENDING" ? "Awaiting approval" : b.status === "COMPLETED" ? "Completed" : "Your session"} · <MapPin size={10} className="mb-0.5 inline" /> {gymName(b, db.gyms)}
        </span>
      </button>
    );
  }
  if (s.state === "travel") {
    return (
      <div className={cn(base, "cursor-not-allowed border-dashed border-line bg-field/40 text-muted")}>
        <span className="flex items-center gap-1.5 text-sm font-bold">
          <Car size={12} /> {time}
        </span>
        <span className="text-[11px]">Unavailable — Coach travel buffer from another gym location.</span>
      </div>
    );
  }
  if (s.state === "taken") {
    if (mode === "trainer" && b) {
      const tone =
        b.status === "PENDING" ? "border-pr/40 bg-pr/15 text-pr" : b.status === "COMPLETED" ? "border-success/30 bg-success/10 text-success" : b.status === "NO_SHOW" ? "border-danger/30 bg-danger/10 text-danger" : "border-accent/40 bg-accent/15 text-accent";
      return (
        <button onClick={onClick} className={cn(base, tone, "hover:brightness-125")}>
          <span className="text-sm font-bold">{time}</span>
          <span className="truncate text-[11px] font-semibold">
            {client?.name ?? "Client"} · <MapPin size={10} className="mb-0.5 inline" /> {gymName(b, db.gyms)}
          </span>
        </button>
      );
    }
    return (
      <div className={cn(base, "cursor-not-allowed border-line bg-field/60 text-muted")}>
        <span className="flex items-center gap-1.5 text-sm font-bold">
          <Lock size={12} /> {time}
        </span>
        <span className="text-[11px]">Unavailable / Booked</span>
      </div>
    );
  }
  return (
    <div className={cn(base, "cursor-not-allowed border-line/60 bg-transparent text-muted/50")}>
      <span className="text-sm font-semibold">{time}</span>
      <span className="text-[11px]">{s.state === "late" ? "Too soon to book" : "Past"}</span>
    </div>
  );
}

function Legend({ mode }: { mode: "client" | "trainer" }) {
  const items =
    mode === "client"
      ? [
          ["bg-accent", "Available"],
          ["bg-success", "Your session"],
          ["bg-pr", "Awaiting approval"],
          ["bg-line", "Booked by others"],
          ["bg-line border border-dashed border-muted", "Coach travelling"],
        ]
      : [
          ["bg-accent", "Open / confirmed"],
          ["bg-pr", "Pending"],
          ["bg-success", "Completed"],
          ["bg-danger", "No-show"],
          ["bg-line border border-dashed border-muted", "Travel buffer"],
        ];
  return (
    <Card className="mt-4 flex flex-wrap gap-x-4 gap-y-2 p-3 text-xs text-muted">
      {items.map(([c, l]) => (
        <span key={l} className="flex items-center gap-1.5">
          <span className={cn("h-2.5 w-2.5 rounded-full", c)} /> {l}
        </span>
      ))}
    </Card>
  );
}

/* ---------------- Coach: travel between sessions at different locations ---------------- */
interface TravelBlock {
  key: string;
  at: Date;
  from: string;
  to: string;
  need: number;
  gap: number;
}

function coachTravelBlocks(day: Date, db: ReturnType<typeof useViewer>["db"], all: Booking[]): TravelBlock[] {
  const r = db.settings;
  if (!r.travelEnabled) return [];
  const list = all.filter((b) => OCCUPYING.includes(b.status) && ymd(parseISO(b.start)) === ymd(day) && b.clientId !== "other").sort((a, b) => a.start.localeCompare(b.start));
  const out: TravelBlock[] = [];
  for (let i = 0; i + 1 < list.length; i++) {
    const a = list[i];
    const b = list[i + 1];
    const gap = Math.round((parseISO(b.start).getTime() - parseISO(a.end).getTime()) / 60000);
    if (gap < 0) continue;
    const need = bufferMinutes(locOf(a), locOf(b), r);
    if (need > 0) out.push({ key: `tr_${a.id}_${b.id}`, at: parseISO(a.end), from: gymName(a, db.gyms), to: gymName(b, db.gyms), need, gap });
  }
  return out;
}

function TravelPill({ tb }: { tb: TravelBlock }) {
  const tight = tb.gap < tb.need;
  return (
    <div className={cn("flex items-start gap-2 rounded-xl border border-dashed px-3 py-2 text-[11px]", tight ? "border-pr/50 bg-pr/10 text-pr" : "border-line bg-field/50 text-muted")}>
      <Car size={13} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="font-semibold">Travel buffer · {tb.need} min</div>
        <div className="truncate">
          {tb.from} → {tb.to}
        </div>
        {tight && <div>Only {tb.gap} min free — buffer waived</div>}
      </div>
    </div>
  );
}
