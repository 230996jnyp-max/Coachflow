"use client";

import { differenceInCalendarDays, format, formatDistanceToNowStrict, parseISO, startOfMonth, subDays } from "date-fns";
import { Activity, HeartPulse, Mail, MessageCircle, MessagesSquare, Phone, Ruler, Trophy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { GoalCard } from "@/components/goal/GoalCard";
import { badgeStatuses } from "@/lib/badges";
import { Sparkline } from "@/components/progress/Sparkline";
import { Badge, Button, Card, Input, Notice, SectionTitle, Stat } from "@/components/ui";
import { FeelingBadge } from "@/components/workout/FeelingCard";
import { clientThread, requestThread } from "@/lib/chat";
import { buildFeed } from "@/lib/clientFeed";
import { useViewer } from "@/lib/hooks";
import { reservedCount } from "@/lib/scheduling";
import { doneWorkouts, formatSet, PR_LABELS, weekStreak, workoutVolume } from "@/lib/stats";
import { updateClient, useNow } from "@/lib/store";
import { cn, fmtLength, fmtVolume, fmtWeight, round } from "@/lib/utils";
import { CoachNotes } from "./CoachNotes";
import { FeedIcon } from "./FeedIcon";
import { PctBar, PctPill, ReasonBadges, useStatuses } from "./status";

type JumpTab = "workouts" | "progress" | "plan";

/** When the client's package ends. Set a date and the client and coach are told a week before and the day before, while sessions remain. */
function PackageEnds({ clientId, expires, credits, now }: { clientId: string; expires?: string; credits: number; now: Date }) {
  const left = expires ? differenceInCalendarDays(parseISO(expires), now) : null;
  const text =
    left === null ? "No end date set. Add one and you and your client are reminded before the sessions run out of time." : left < 0 ? `Ended ${-left} day${left === -1 ? "" : "s"} ago${credits > 0 ? `, with ${credits} credit${credits === 1 ? "" : "s"} unused` : ""}.` : left === 0 ? "Ends today." : `${left} day${left === 1 ? "" : "s"} left (${format(parseISO(expires!), "d MMM yyyy")}).`;
  return (
    <Card className={cn("flex flex-wrap items-center gap-3 p-3", left !== null && left <= 7 && credits > 0 && "border-pr/40")}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">Package valid until</div>
        <div className="text-xs text-muted">{text}</div>
      </div>
      <Input type="date" aria-label="Package valid until" className="w-44" value={expires ?? ""} onChange={(e) => void updateClient(clientId, { profile: { packageExpires: e.target.value } })} />
      {expires && (
        <Button size="sm" variant="ghost" onClick={() => void updateClient(clientId, { profile: { packageExpires: "" } })}>
          Clear
        </Button>
      )}
    </Card>
  );
}

/**
 * A coach's view of one client at a glance: training score against the weekly target, the last workout, this month's highlights,
 * body trends, before / after photos, the goal and countdown, private coach notes and the latest activity.
 */
export function ClientOverview({ clientId, onTab }: { clientId: string; onTab: (t: JumpTab) => void }) {
  const { db, unit, exMap, clients } = useViewer();
  const router = useRouter();
  const now = useNow(60_000);
  const statuses = useStatuses();
  const profile = db.clients.find((c) => c.id === clientId)!;
  const st = statuses.get(clientId);
  const person = clients.find((c) => c.user.id === clientId)?.user;

  const workouts = useMemo(() => doneWorkouts(db.workouts, clientId), [db.workouts, clientId]);
  const last = workouts[workouts.length - 1];
  const monthStart = startOfMonth(now);
  const month = useMemo(() => workouts.filter((w) => parseISO(w.startedAt) >= monthStart), [workouts, monthStart]);
  const monthPbs = month.reduce((n, w) => n + w.exercises.reduce((m, we) => m + we.sets.filter((s) => s.pr?.length).length, 0), 0);
  const monthVolume = month.reduce((n, w) => n + workoutVolume(w, exMap), 0);
  const reserved = reservedCount(db.bookings, clientId);

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

  const metrics = useMemo(() => db.metrics.filter((m) => m.clientId === clientId).sort((a, b) => a.date.localeCompare(b.date)), [db.metrics, clientId]);
  const photos = useMemo(() => db.photos.filter((p) => p.clientId === clientId).sort((a, b) => a.date.localeCompare(b.date)), [db.photos, clientId]);

  const trends = useMemo(() => {
    const since = format(subDays(now, 90), "yyyy-MM-dd");
    const recent = metrics.filter((m) => m.date >= since);
    const series = (pick: (m: (typeof metrics)[number]) => number | undefined) => recent.map(pick).filter((v): v is number => typeof v === "number" && v > 0);
    return [
      { key: "weight", label: "Weight", values: series((m) => m.weightKg), fmt: (v: number) => fmtWeight(v, unit), icon: <Activity size={14} /> },
      { key: "waist", label: "Waist", values: series((m) => m.waist), fmt: (v: number) => fmtLength(v, unit), icon: <Ruler size={14} /> },
      { key: "fat", label: "Body fat", values: series((m) => m.bodyFat), fmt: (v: number) => `${round(v, 1)}%`, icon: <HeartPulse size={14} /> },
    ].filter((t) => t.values.length > 0);
  }, [metrics, now, unit]);

  const feed = useMemo(
    () => buildFeed({ workouts: db.workouts, metrics: db.metrics, photos: db.photos, bookings: db.bookings, groups: db.groups }, clientId, now, 8),
    [db.workouts, db.metrics, db.photos, db.bookings, db.groups, clientId, now],
  );

  const badges = useMemo(() => badgeStatuses(db.workouts, exMap, clientId, now), [db.workouts, exMap, clientId, now]);
  const badgesEarned = badges.filter((b) => b.earnedAt);

  const chat = () => {
    requestThread(clientThread(clientId));
    router.push("/messages");
  };

  const first = photos[0];
  const latest = photos.length > 1 ? photos[photos.length - 1] : undefined;

  return (
    <div className="space-y-6">
      {profile.medicalNotes && (
        <Notice tone="warn">
          <b>Injuries &amp; limitations:</b> {profile.medicalNotes}
        </Notice>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={chat}>
          <MessagesSquare size={16} /> Message in app
        </Button>
        {profile.phone && (
          <a href={`https://wa.me/${profile.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
            <Button variant="secondary">
              <MessageCircle size={16} /> WhatsApp
            </Button>
          </a>
        )}
        {profile.phone && (
          <a href={`tel:${profile.phone}`}>
            <Button variant="secondary">
              <Phone size={16} /> {profile.phone}
            </Button>
          </a>
        )}
        {profile.email && (
          <a href={`mailto:${profile.email}`}>
            <Button variant="secondary">
              <Mail size={16} /> Email
            </Button>
          </a>
        )}
      </div>

      {st && (
        <Card className="space-y-3 p-4" data-tour="client-training">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">Training</h3>
            {st.assigned ? (
              <Button size="sm" variant="ghost" onClick={() => onTab("plan")}>
                Assigned this week · open the plan →
              </Button>
            ) : (
              <span className="text-xs text-muted">
                Target: {st.target} {st.target === 1 ? "session" : "sessions"} a week
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <ScoreBox label="Last 7 days" pct={st.pct7} />
            <ScoreBox label="Last 30 days" pct={st.pct30} />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted">This week</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">
                {st.weekDone} <span className="text-sm font-semibold text-muted">of {st.target}</span>
              </div>
              <PctBar pct={Math.min(100, Math.round((st.weekDone / st.target) * 100))} className="mt-1.5" />
            </div>
          </div>
          {st.reasons.length > 0 && <ReasonBadges status={st} max={5} />}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="order-last min-w-0 space-y-4 lg:order-first lg:col-span-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-tour="client-highlights">
            <Stat label="Credits left" value={profile.credits} tone="accent" sub={`${reserved} reserved · of ${profile.packageSize}`} />
            <Stat label="Workouts" value={month.length} sub={`this month · ${workouts.length} all time`} />
            <Stat label="Volume" value={fmtVolume(monthVolume, unit)} sub="this month" />
            <Stat label="Records" value={monthPbs} tone="pr" sub="PBs this month" />
            <Stat label="Week streak" value={`${weekStreak(workouts, now)} 🔥`} sub={last ? `Last: ${format(parseISO(last.startedAt), "d MMM")}` : "No workouts yet"} />
          </div>

          <PackageEnds clientId={clientId} expires={profile.packageExpires} credits={profile.credits + profile.groupClassCredits} now={now} />

          <Card className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">Last workout</h3>
              <Button size="sm" variant="ghost" onClick={() => onTab("workouts")}>
                All workouts →
              </Button>
            </div>
            {last ? (
              <Link href={`/workout/${last.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-field/40 p-3 hover:border-accent/50">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{last.title}</div>
                  <div className="text-xs text-muted">
                    {format(parseISO(last.startedAt), "EEE d MMM, h:mm a")} · {fmtVolume(workoutVolume(last, exMap), unit)} · {formatDistanceToNowStrict(parseISO(last.startedAt), { addSuffix: true })}
                  </div>
                </div>
                <span className="flex shrink-0 items-center gap-2">
                  <FeelingBadge feedback={last.feedback} />
                  <span className="text-xs font-semibold text-accent">View result →</span>
                </span>
              </Link>
            ) : (
              <p className="text-sm text-muted">No finished workouts yet.</p>
            )}
          </Card>

          <Card className="space-y-3 p-4" data-tour="client-trends">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">Body, last 90 days</h3>
              <Button size="sm" variant="ghost" onClick={() => onTab("progress")}>
                Open progress →
              </Button>
            </div>
            {trends.length === 0 ? (
              <p className="text-sm text-muted">No body check-ins yet. Weight, waist and body fat show up here once you or your client log them in the Progress tab.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                {trends.map((t) => {
                  const latestV = t.values[t.values.length - 1];
                  const delta = latestV - t.values[0];
                  return (
                    <div key={t.key} className="rounded-xl border border-line bg-field/40 p-3">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
                        {t.icon} {t.label}
                      </div>
                      <div className="mt-1 text-xl font-bold tabular-nums">{t.fmt(latestV)}</div>
                      <div className="text-[11px] text-muted">{t.values.length > 1 ? `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${t.fmt(Math.abs(delta))} over ${t.values.length} logs` : "1 log so far"}</div>
                      <Sparkline values={t.values} label={`${t.label} trend`} className="mt-1" />
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card className="space-y-3 p-4" data-tour="client-photos">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">Progress photos</h3>
              <Button size="sm" variant="ghost" onClick={() => onTab("progress")}>
                {photos.length ? `All ${photos.length} →` : "Open progress →"}
              </Button>
            </div>
            {photos.length === 0 ? (
              <p className="text-sm text-muted">No progress photos yet. Ask your client to add a front, side and back photo, or add one for them in the Progress tab.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <PhotoTile label={latest ? "First" : "Only photo"} photo={first} unit={unit} />
                {latest ? <PhotoTile label="Latest" photo={latest} unit={unit} /> : <div className="flex items-center justify-center rounded-xl border border-dashed border-line p-4 text-center text-xs text-muted">A second photo shows the before / after here.</div>}
              </div>
            )}
          </Card>
        </div>

        <div className="order-first min-w-0 space-y-4 lg:order-last">
          <GoalCard clientId={clientId} editable canSetTarget />
          <Card className="space-y-2 p-4" data-tour="client-badges">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">Badges</h3>
              <Button size="sm" variant="ghost" onClick={() => onTab("progress")}>
                {badgesEarned.length} of {badges.length} →
              </Button>
            </div>
            {badgesEarned.length === 0 ? (
              <p className="text-sm text-muted">None yet. The first one comes with the first finished workout.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {badgesEarned.map((b) => (
                  <span key={b.def.id} title={`${b.def.title} · ${format(parseISO(b.earnedAt!), "d MMM yyyy")}`} className="inline-flex items-center gap-1 rounded-full border border-pr/40 bg-pr/10 px-2.5 py-1 text-xs font-semibold">
                    <span aria-hidden>{b.def.emoji}</span> {b.def.title}
                  </span>
                ))}
              </div>
            )}
          </Card>
          <CoachNotes clientId={clientId} />
        </div>
      </div>

      <section>
        <SectionTitle>Recent activity</SectionTitle>
        {feed.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet. {person?.name.split(" ")[0] ?? "Your client"}&apos;s workouts, sessions, photos and metrics will show up here.</p>
        ) : (
          <Card className="divide-y divide-line/60">
            {feed.map((e) => {
              const row = (
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-field text-muted">
                    <FeedIcon kind={e.kind} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{e.text}</span>
                  <span className="shrink-0 text-xs text-muted">{formatDistanceToNowStrict(e.at, { addSuffix: true })}</span>
                </div>
              );
              return e.href ? (
                <Link key={e.id} href={e.href} className="block hover:bg-field/50">
                  {row}
                </Link>
              ) : (
                <div key={e.id}>{row}</div>
              );
            })}
          </Card>
        )}
      </section>

      <section>
        <SectionTitle>Recent records</SectionTitle>
        {prs.length === 0 ? (
          <p className="text-sm text-muted">No PRs yet.</p>
        ) : (
          <div className="space-y-2">
            {prs.map((p) => (
              <Card key={p.id} className="flex items-center gap-3 p-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-pr/15 text-pr">
                  <Trophy size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{p.ex}</div>
                  <div className="truncate text-xs text-muted">
                    {p.text} · {p.kinds}
                  </div>
                </div>
                <div className="text-xs text-muted">{format(parseISO(p.date), "d MMM")}</div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>Latest workouts</SectionTitle>
        <div className="space-y-2">
          {workouts.length === 0 && <p className="text-sm text-muted">No workouts yet.</p>}
          {workouts
            .slice(-3)
            .reverse()
            .map((w) => (
              <Link key={w.id} href={`/workout/${w.id}`}>
                <Card className="flex items-center justify-between gap-3 p-3 hover:border-accent/50">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{w.title}</div>
                    <div className="text-xs text-muted">
                      {format(parseISO(w.startedAt), "EEE d MMM")} · {fmtVolume(workoutVolume(w, exMap), unit)}
                    </div>
                  </div>
                  <span className="flex shrink-0 items-center gap-2">
                    <FeelingBadge feedback={w.feedback} />
                    <span className="text-xs text-accent">View →</span>
                  </span>
                </Card>
              </Link>
            ))}
        </div>
      </section>
    </div>
  );
}

function ScoreBox({ label, pct }: { label: string; pct: number }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <PctPill pct={pct} className="text-base" />
      </div>
      <PctBar pct={pct} className="mt-1.5" />
    </div>
  );
}

function PhotoTile({ label, photo, unit }: { label: string; photo: { dataUrl: string; date: string; pose: string; weightKg?: number }; unit: "metric" | "imperial" }) {
  return (
    <figure className="space-y-1.5">
      <div className="aspect-[3/4] overflow-hidden rounded-xl border border-line bg-field">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.dataUrl} alt={`${label} ${photo.pose.toLowerCase()} progress photo, ${photo.date}`} className="h-full w-full object-cover" />
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
        <Badge className={cn("border-accent/30 bg-accent/15 text-accent")}>{label}</Badge>
        {format(parseISO(photo.date), "d MMM yyyy")}
        {photo.weightKg ? ` · ${fmtWeight(photo.weightKg, unit)}` : ""}
      </figcaption>
    </figure>
  );
}
