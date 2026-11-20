"use client";

import { addDays, endOfDay, format, isSameDay, parseISO, startOfDay } from "date-fns";
import { AlertTriangle, Check, ChevronRight, UserCheck, UserX, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PendingAttendance } from "@/components/attendance/PendingAttendance";
import { ClientActivityBanner } from "@/components/ClientActivityBanner";
import { NeedsYou } from "@/components/clients/NeedsYou";
import { ProgramSuggestions } from "@/components/programs/ProgramSuggestions";
import { CoachCodeCard, LinkRequests } from "@/components/coachlink/CoachLink";
import { SpecialtiesCard } from "@/components/sports/Focus";
import { BookingDetail } from "@/components/booking/BookingDetail";
import { LocationPill } from "@/components/LocationPill";
import { bookingLocation, StatusBadge, timeRange } from "@/components/booking/bookingUi";
import { FeelingBadge } from "@/components/workout/FeelingCard";
import { GymChip } from "@/components/gym/GymChip";
import { HomeSlot } from "@/components/HomeSlot";
import { Avatar, Button, Card, EmptyState, PageHeader, SectionTitle, Stat } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { availableCredits } from "@/lib/scheduling";
import { doneWorkouts, workoutSetCount } from "@/lib/stats";
import { saveAttendance, setBookingStatus, useNow } from "@/lib/store";
import { fmtDurationShort } from "@/lib/utils";

export default function TrainerDashboard() {
  const { db, user, clients } = useViewer();
  const now = useNow(30_000);
  const [detail, setDetail] = useState<string | null>(null);
  // Until the coach picks their specialties, offer it once on the dashboard (they can dismiss it).
  const [skipSpecialties, setSkipSpecialties] = useState(() => {
    try {
      return localStorage.getItem("coachflow-specialties-skip") === "1";
    } catch {
      return false;
    }
  });
  if (!user) return null;

  const sod = startOfDay(now);
  const eod = endOfDay(now);
  const weekEnd = endOfDay(addDays(now, 6));
  const live = db.bookings.filter((b) => b.status === "CONFIRMED" || b.status === "PENDING" || b.status === "COMPLETED" || b.status === "NO_SHOW");
  const today = live.filter((b) => parseISO(b.start) >= sod && parseISO(b.start) <= eod).sort((a, b) => a.start.localeCompare(b.start));
  const week = db.bookings.filter((b) => (b.status === "CONFIRMED" || b.status === "PENDING") && parseISO(b.start) >= now && parseISO(b.start) <= weekEnd);
  const pending = db.bookings.filter((b) => b.status === "PENDING").sort((a, b) => a.start.localeCompare(b.start));
  const active = clients.filter((c) => !c.profile.archived);
  const low = active.filter((c) => availableCredits(c.profile, db.bookings) <= 2);
  const recentWorkouts = doneWorkouts(db.workouts).slice(-5).reverse();
  const nameOf = (id: string) => db.users.find((u) => u.id === id)?.name ?? "Client";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={`${now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening"}, ${user.prefs?.nick || user.name.split(" ")[1] || user.name}`} subtitle={format(now, "EEEE d MMMM yyyy")} />

      <GymChip />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active clients" value={active.length} tone="accent" />
        <Stat label="Sessions today" value={today.filter((b) => b.status !== "CANCELLED").length} sub={`${today.filter((b) => b.status === "COMPLETED").length} completed`} />
        <Stat label="Next 7 days" value={week.length} sub="booked sessions" />
        <Stat label="Pending requests" value={pending.length} tone={pending.length ? "pr" : undefined} />
      </div>

      <HomeSlot side="coach" id="needs">
        <div className="space-y-6 empty:hidden">
          <NeedsYou />
          <ProgramSuggestions />
        </div>
      </HomeSlot>

      <HomeSlot side="coach" id="requests">
        <div className="space-y-8 empty:hidden">
          <LinkRequests />
          <CoachCodeCard />
        </div>
      </HomeSlot>

      <HomeSlot side="coach" id="activity">
        <div className="space-y-8 empty:hidden">
          <ClientActivityBanner />
          <PendingAttendance />
        </div>
      </HomeSlot>

      {!(db.settings.specialties ?? []).length && !skipSpecialties && (
        <SpecialtiesCard
          compact
          onDismiss={() => {
            setSkipSpecialties(true);
            try {
              localStorage.setItem("coachflow-specialties-skip", "1");
            } catch {
              /* ignore */
            }
          }}
        />
      )}

      {pending.length > 0 && (
        <HomeSlot side="coach" id="bookings">
        <section>
          <SectionTitle>Booking requests</SectionTitle>
          <div className="space-y-2">
            {pending.map((b) => (
              <Card key={b.id} className="flex flex-wrap items-center gap-3 border-pr/30 p-3">
                <Avatar name={nameOf(b.clientId)} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{nameOf(b.clientId)}</div>
                  <div className="text-xs text-muted">
                    {format(parseISO(b.start), "EEE d MMM")} · {timeRange(b)} · <LocationPill small label={bookingLocation(b, db.gyms).label} href={bookingLocation(b, db.gyms).href} className="font-medium align-middle" />
                  </div>
                </div>
                <Button size="sm" variant="success" onClick={() => setBookingStatus(b.id, "CONFIRMED")}>
                  <Check size={14} /> Approve
                </Button>
                <Button size="sm" variant="danger" onClick={() => setBookingStatus(b.id, "DECLINED")}>
                  <X size={14} /> Decline
                </Button>
              </Card>
            ))}
          </div>
        </section>
        </HomeSlot>
      )}

      <HomeSlot side="coach" id="today">
      <section>
        <SectionTitle action={<Link href="/schedule" className="text-xs font-semibold text-accent">Open schedule →</Link>}>Today’s sessions</SectionTitle>
        {today.length === 0 ? (
          <EmptyState title="No sessions today" hint="Enjoy the downtime — or open your schedule to book someone in." />
        ) : (
          <div className="space-y-2">
            {today.map((b) => {
              const isPast = parseISO(b.end) < now;
              return (
                <Card key={b.id} className="flex items-center gap-3 p-3">
                  <button onClick={() => setDetail(b.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <div className="w-[74px] shrink-0 text-center">
                      <div className="text-sm font-bold">{format(parseISO(b.start), "h:mm a")}</div>
                      <div className="text-[10px] text-muted">{isSameDay(parseISO(b.start), now) ? "today" : ""}</div>
                    </div>
                    <Avatar name={nameOf(b.clientId)} size={38} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{nameOf(b.clientId)}</div>
                      <div className="flex items-center gap-1 truncate text-xs text-muted">
                        <LocationPill nested small label={bookingLocation(b, db.gyms).label} href={bookingLocation(b, db.gyms).href} className="font-medium" />
                        <span className="shrink-0">· {b.focus}</span>
                      </div>
                    </div>
                  </button>
                  {b.status === "CONFIRMED" ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button size="sm" variant={b.attendance?.mark === "PRESENT" ? "success" : "secondary"} aria-pressed={b.attendance?.mark === "PRESENT"} onClick={() => saveAttendance({ kind: "BOOKING", id: b.id }, [{ clientId: b.clientId, mark: "PRESENT" }], isPast && !b.sharedGroupId)}>
                        <UserCheck size={14} /> Present
                      </Button>
                      <Button size="sm" variant={b.attendance?.mark === "NO_SHOW" ? "danger" : "secondary"} aria-pressed={b.attendance?.mark === "NO_SHOW"} onClick={() => saveAttendance({ kind: "BOOKING", id: b.id }, [{ clientId: b.clientId, mark: "NO_SHOW", deduct: b.attendance?.deduct }], isPast && !b.sharedGroupId)}>
                        <UserX size={14} /> No-Show
                      </Button>
                    </div>
                  ) : (
                    <StatusBadge status={b.status} />
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>
      </HomeSlot>

      {low.length > 0 && (
        <HomeSlot side="coach" id="low">
        <section>
          <SectionTitle>Low on credits</SectionTitle>
          <div className="space-y-2">
            {low.map(({ user: u, profile }) => (
              <Link key={u.id} href={`/clients/${u.id}`}>
                <Card className="flex items-center gap-3 border-danger/30 p-3">
                  <AlertTriangle size={18} className="shrink-0 text-danger" />
                  <div className="min-w-0 flex-1 text-sm">
                    <span className="font-semibold">{u.name}</span> — {profile.credits} left, {availableCredits(profile, db.bookings)} bookable
                  </div>
                  <ChevronRight size={16} className="text-muted" />
                </Card>
              </Link>
            ))}
          </div>
        </section>
        </HomeSlot>
      )}

      <HomeSlot side="coach" id="recent">
      <section>
        <SectionTitle>Recent client workouts</SectionTitle>
        <div className="space-y-2">
          {recentWorkouts.map((w) => (
            <Link key={w.id} href={`/workout/${w.id}`}>
              <Card className="flex items-center gap-3 p-3 hover:border-accent/50">
                <Avatar name={nameOf(w.clientId)} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {nameOf(w.clientId)} · {w.title}
                  </div>
                  <div className="text-xs text-muted">
                    {format(parseISO(w.startedAt), "EEE d MMM, h:mm a")} · {fmtDurationShort(w.durationSec)} · {workoutSetCount(w)} sets
                  </div>
                </div>
                <FeelingBadge feedback={w.feedback} />
                <ChevronRight size={16} className="text-muted" />
              </Card>
            </Link>
          ))}
        </div>
      </section>
      </HomeSlot>

      <BookingDetail bookingId={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
