"use client";

import { format, parseISO } from "date-fns";
import { CalendarPlus, ChevronRight, Dumbbell, MapPin, Play, Trophy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { BookingDetail } from "@/components/booking/BookingDetail";
import { gymName, StatusBadge, timeRange } from "@/components/booking/bookingUi";
import { CalendarQuickLinks } from "@/components/booking/CalendarActions";
import { PasswordBanner } from "@/components/PasswordBanner";
import { Badge, Button, Card, EmptyState, PageHeader, SectionTitle, Stat } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { availableCredits, reservedCount } from "@/lib/scheduling";
import { doneWorkouts, formatSet, PR_LABELS, weeklyBuckets, weekStreak, workoutSetCount, workoutVolume } from "@/lib/stats";
import { startWorkout, useNow } from "@/lib/store";
import { fmtDurationShort, fmtVolume } from "@/lib/utils";

export default function ClientHome() {
  const { db, user, unit, exMap } = useViewer();
  const now = useNow(60_000);
  const router = useRouter();
  const [detail, setDetail] = useState<string | null>(null);

  const workouts = useMemo(() => doneWorkouts(db.workouts, user?.id), [db.workouts, user?.id]);
  const prs = useMemo(() => {
    const out: { id: string; date: string; ex: string; text: string; kinds: string }[] = [];
    for (const w of [...workouts].reverse()) {
      for (const we of w.exercises)
        for (const s of we.sets)
          if (s.pr?.length) out.push({ id: s.id, date: w.startedAt, ex: exMap.get(we.exerciseId)?.name ?? "", text: formatSet(s, exMap.get(we.exerciseId), unit), kinds: s.pr.map((p) => PR_LABELS[p]).join(" · ") });
      if (out.length >= 3) break;
    }
    return out.slice(0, 3);
  }, [workouts, exMap, unit]);

  if (!user) return null;
  const profile = db.clients.find((c) => c.id === user.id);
  const next = db.bookings
    .filter((b) => b.clientId === user.id && (b.status === "CONFIRMED" || b.status === "PENDING") && parseISO(b.end) > now)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  const week = weeklyBuckets(workouts, exMap, 1, now)[0];
  const avail = profile ? availableCredits(profile, db.bookings) : 0;
  const hour = now.getHours();
  const hi = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const start = () => {
    const id = startWorkout({ clientId: user.id, loggedBy: "CLIENT", loggedById: user.id, title: "Workout " + format(new Date(), "d MMM") });
    router.push(`/workout/${id}`);
  };

  return (
    <div className="space-y-8">
      <PageHeader title={`${hi}, ${user.name.split(" ")[0]}`} subtitle={profile ? `Goal: ${profile.goal}` : undefined} />
      <PasswordBanner />

      <section>
        <SectionTitle>Next session</SectionTitle>
        {next ? (
          <div>
          <button onClick={() => setDetail(next.id)} className="block w-full text-left">
            <Card className="border-accent/40 bg-accent-dim/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-accent">{format(parseISO(next.start), "EEEE d MMMM")}</div>
                  <div className="mt-1 text-2xl font-bold">{format(parseISO(next.start), "h:mm a")}</div>
                  <div className="mt-1 text-sm text-muted">{timeRange(next)}</div>
                </div>
                <StatusBadge status={next.status} />
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-sm text-muted">
                <MapPin size={14} /> {gymName(next, db.gyms)} · {next.focus}
              </div>
            </Card>
          </button>
          <div className="px-1 pt-2">
            <CalendarQuickLinks booking={next} />
          </div>
          </div>
        ) : (
          <EmptyState
            icon={<CalendarPlus size={28} />}
            title="No upcoming sessions"
            hint={avail > 0 ? "Pick a time that suits you." : "You’re out of credits — ask your trainer for a new package."}
            action={
              <Link href="/book">
                <Button disabled={avail <= 0}>Book a session</Button>
              </Link>
            }
          />
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Session credits" value={profile?.credits ?? 0} tone="accent" sub={`${avail} bookable · ${profile ? reservedCount(db.bookings, user.id) : 0} reserved`} />
        <Stat label="Workouts this week" value={week.workouts} sub={`${week.sets} working sets`} />
        <Stat label="Volume this week" value={fmtVolume(week.volume, unit)} />
        <Stat label="Week streak" value={`${weekStreak(workouts, now)} 🔥`} tone="pr" />
      </div>

      <section>
        <SectionTitle>Quick start</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          <Button size="lg" onClick={start}>
            <Play size={18} /> Start workout
          </Button>
          <Link href="/workout">
            <Button size="lg" variant="secondary" className="w-full">
              <Dumbbell size={18} /> Routines
            </Button>
          </Link>
          <Link href="/book">
            <Button size="lg" variant="secondary" className="w-full">
              <CalendarPlus size={18} /> Book session
            </Button>
          </Link>
        </div>
      </section>

      {prs.length > 0 && (
        <section>
          <SectionTitle>Latest personal records</SectionTitle>
          <div className="space-y-2">
            {prs.map((p) => (
              <Card key={p.id} className="flex items-center gap-3 p-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pr/15 text-pr">
                  <Trophy size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{p.ex}</div>
                  <div className="truncate text-xs text-muted">
                    {p.text} · {p.kinds}
                  </div>
                </div>
                <Badge>{format(parseISO(p.date), "d MMM")}</Badge>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle action={<Link href="/workout" className="text-xs font-semibold text-accent">See all →</Link>}>Recent workouts</SectionTitle>
        <div className="space-y-2">
          {workouts
            .slice(-3)
            .reverse()
            .map((w) => (
              <Link key={w.id} href={`/workout/${w.id}`}>
                <Card className="flex items-center gap-3 p-3 hover:border-accent/50">
                  <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-field">
                    <div className="text-[10px] font-bold uppercase text-muted">{format(parseISO(w.startedAt), "MMM")}</div>
                    <div className="text-lg font-bold leading-none">{format(parseISO(w.startedAt), "d")}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{w.title}</div>
                    <div className="text-xs text-muted">
                      {fmtDurationShort(w.durationSec)} · {fmtVolume(workoutVolume(w, exMap), unit)} · {workoutSetCount(w)} sets
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-muted" />
                </Card>
              </Link>
            ))}
          {workouts.length === 0 && <EmptyState title="No workouts yet" hint="Start your first workout to see stats here." />}
        </div>
      </section>

      <BookingDetail bookingId={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
