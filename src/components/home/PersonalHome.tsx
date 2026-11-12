"use client";

import { format, parseISO } from "date-fns";
import { ChevronRight, Dumbbell, Play, Target, Trophy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { GoalCard } from "@/components/goal/GoalCard";
import { PasswordBanner } from "@/components/PasswordBanner";
import { Badge, Button, Card, EmptyState, PageHeader, SectionTitle, Stat } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { doneWorkouts, formatSet, PR_LABELS, weeklyBuckets, weekStreak, workoutSetCount, workoutVolume } from "@/lib/stats";
import { startWorkout, useNow } from "@/lib/store";
import { cn, fmtDurationShort, fmtVolume } from "@/lib/utils";

/** The home screen for someone training on their own: this week's goal, streak, latest records and quick-start routines. No sessions, credits or coach. */
export function PersonalHome() {
  const { db, user, unit, exMap } = useViewer();
  const now = useNow(60_000);
  const router = useRouter();

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
  const target = profile?.weeklyTarget ?? 3;
  const week = weeklyBuckets(workouts, exMap, 1, now)[0];
  const done = week?.workouts ?? 0;
  const hour = now.getHours();
  const hi = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const mine = db.templates.filter((t) => t.ownerId === user.id).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 4);

  const start = (templateId?: string) => {
    const id = startWorkout({ clientId: user.id, loggedBy: "CLIENT", loggedById: user.id, title: "Workout " + format(new Date(), "d MMM"), ...(templateId ? { templateId } : {}) });
    router.push(`/workout/${id}`);
  };

  return (
    <div className="space-y-8">
      <PageHeader title={`${hi}, ${user.prefs?.nick || user.name.split(" ")[0]}`} subtitle={profile?.personalGoal ? `Goal: ${profile.personalGoal}` : undefined} />
      <PasswordBanner />

      <section data-tour="home-goal">
        <SectionTitle>This week&apos;s goal</SectionTitle>
        <Card className="space-y-3 p-4">
          <div className="flex items-center gap-3">
            <Target size={20} className="shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <div className="text-2xl font-bold">
                {done} <span className="text-base font-semibold text-muted">of {target}{target >= 6 ? "+" : ""} workouts</span>
              </div>
              <div className="text-xs text-muted">{done >= target ? "Goal reached. Nice work!" : `${target - done} to go this week`}</div>
            </div>
          </div>
          <div className="flex gap-1.5" aria-hidden="true">
            {Array.from({ length: target }).map((_, i) => (
              <div key={i} className={cn("h-2 flex-1 rounded-full", i < done ? "bg-accent" : "bg-line")} />
            ))}
          </div>
        </Card>
      </section>

      <GoalCard clientId={user.id} editable canSetTarget />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Workouts this week" value={done} sub={`${week?.sets ?? 0} working sets`} tone="accent" />
        <Stat label="Volume this week" value={fmtVolume(week?.volume ?? 0, unit)} />
        <Stat label="Week streak" value={`${weekStreak(workouts, now)} 🔥`} tone="pr" />
      </div>

      <section>
        <SectionTitle action={<Link href="/workout" className="text-xs font-semibold text-accent">All routines →</Link>}>Quick start</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button size="lg" onClick={() => start()}>
            <Play size={18} /> Start an empty workout
          </Button>
          <Link href="/progress">
            <Button size="lg" variant="secondary" className="w-full">
              <Dumbbell size={18} /> See my progress
            </Button>
          </Link>
        </div>
        {mine.length > 0 && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {mine.map((t) => (
              <button key={t.id} onClick={() => start(t.id)} className="text-left">
                <Card className="flex items-center gap-3 p-3 hover:border-accent/50">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{t.name}</div>
                    <div className="text-xs text-muted">{t.niche ? `${t.niche} · ` : ""}{t.exercises.length} exercises</div>
                  </div>
                  <Play size={16} className="text-accent" />
                </Card>
              </button>
            ))}
          </div>
        )}
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

      <Card className="p-4 text-sm text-muted">
        Hired a coach on CoachFlow? Enter their 6-digit code in{" "}
        <Link href="/settings" className="font-semibold text-accent">
          Profile
        </Link>{" "}
        and they can accept you.
      </Card>
    </div>
  );
}
