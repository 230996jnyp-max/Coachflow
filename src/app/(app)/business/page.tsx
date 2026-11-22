"use client";

import { AlertTriangle, BarChart3, Gift } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ExportBar, MyPerformance, OccupancyPanel, PerformanceTable } from "@/components/business/Analytics";
import { Bars, Delta, money, StackedBars } from "@/components/business/Charts";
import { Card, EmptyState, Notice, PageHeader, SectionTitle, Segmented, Stat } from "@/components/ui";
import { format } from "date-fns";
import { hourLabel, monthShort, pctChange, peakIndex, WEEKDAYS, type CoachPerf, type OccupancySummary } from "@/lib/business";
import type { ReportInput } from "@/lib/businessPdf";
import { useViewer } from "@/lib/hooks";

type View = "coach" | "gym" | "owner";

interface CoachData {
  months: string[];
  revenue: { month: string; cents: number; payments: number }[];
  revenueThisMonth: number;
  revenueLastMonth: number;
  hasPayments: boolean;
  outstandingCents: number;
  refundedCents: number;
  sessions: { month: string; done: number; noShow: number; cancelled: number }[];
  classes: { month: string; ran: number; attendees: number }[];
  sessionsThisMonth: number;
  sessionsLastMonth: number;
  clients: { active: number; newThisMonth: number; activeLast30: number; activePct: number | null };
  atRisk: { id: string; name: string; days: number | null; credits: number }[];
  lowCredits: { id: string; name: string; credits: number }[];
  byWeekday: number[];
  byHour: number[];
  topPackages: { name: string; sold: number; cents: number }[];
  attendance: { present: number; noShow: number; ratePct: number | null };
  performance: CoachPerf;
  occupancy: OccupancySummary | null;
}
interface GymData {
  gymName: string;
  months: string[];
  sessionsByMonth: { month: string; done: number }[];
  coaches: { id: string; name: string; sessions30: number; hours30: number; noShows30: number; cancels30: number; classes30: number }[];
  byWeekday: number[];
  byHour: number[];
  classFill: { classes: number; capacity: number; filled: number; pct: number | null };
  activeCoaches: number;
  waiting: number;
  occupancy: OccupancySummary;
  performance: CoachPerf[] | null;
}
interface OwnerData {
  coaches: { total: number; paying: number; trialing: number; exempt: number; trialEnded: number };
  mrrCents: number;
  conversionPct: number | null;
  weeks: { week: string; coaches: number; solo: number; clients: number }[];
  signups30: { coaches: number; solo: number; clients: number };
  activeThisWeek: { coaches: number; solo: number; clients: number };
  gyms: { total: number; active: number };
  referrals: { invited: number; subscribed: number; rewarded: number; friends: { clients: number; solo: number } };
  verifiedPct: number | null;
}

/** Makes the PDF report and saves it (the PDF library is only loaded when this is used). */
async function saveReport(input: ReportInput): Promise<void> {
  const { buildReportPdf, reportFileName } = await import("@/lib/businessPdf");
  const blob = await buildReportPdf(input);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = reportFileName(input, new Date().toISOString().slice(0, 10));
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const periodText = () => `Last 30 days to ${format(new Date(), "d MMM yyyy")}`;

function useData<T>(view: View | null): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ view: View | null; data: T | null; error: string | null }>({ view: null, data: null, error: null });
  useEffect(() => {
    if (!view) return;
    let alive = true;
    void fetch(`/api/business?view=${view}`)
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as T & { error?: string };
        if (!alive) return;
        setState(r.ok ? { view, data: j, error: null } : { view, data: null, error: (j as { error?: string }).error ?? "Couldn't load the numbers." });
      })
      .catch(() => alive && setState({ view, data: null, error: "No connection. Try again." }));
    return () => {
      alive = false;
    };
  }, [view]);
  // Only show what belongs to the tab that is open (a slow answer for another tab never flashes up).
  return state.view === view ? { data: state.data, error: state.error } : { data: null, error: null };
}

const weekdayBars = (xs: number[]) => ({ values: [...xs.slice(1), xs[0]], labels: [...WEEKDAYS.slice(1), WEEKDAYS[0]] });

/** Busy times: sessions by weekday and by hour of the day. */
function BusyTimes({ byWeekday, byHour, note }: { byWeekday: number[]; byHour: number[]; note: string }) {
  const total = byWeekday.reduce((a, b) => a + b, 0);
  if (!total) return <Card className="p-5 text-sm text-muted">No sessions in the last 90 days yet. {note}</Card>;
  const wd = weekdayBars(byWeekday);
  const day = peakIndex(byWeekday);
  const hours = byHour.map((n, h) => ({ n, h })).filter((x) => x.h >= 5 && x.h <= 22);
  const hr = peakIndex(byHour);
  return (
    <Card className="space-y-5 p-5">
      <p className="text-sm text-muted">
        Busiest day: <b className="text-ink">{WEEKDAYS[day]}</b>. Busiest hour: <b className="text-ink">{hourLabel(hr)}</b>. Based on the last 90 days.
      </p>
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">By day</div>
        <Bars values={wd.values} labels={wd.labels as string[]} highlight={wd.labels.indexOf(WEEKDAYS[day])} label="Sessions by day of the week" />
      </div>
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">By hour</div>
        <Bars values={hours.map((x) => x.n)} labels={hours.map((x) => hourLabel(x.h).replace("am", "").replace("pm", ""))} highlight={hours.findIndex((x) => x.h === hr)} height={90} tone="success" label="Sessions by hour of the day" />
        <div className="mt-1 text-[10px] text-muted">Hour of the day, 5 to 22 (24-hour clock)</div>
      </div>
    </Card>
  );
}

/* ---------------- A coach's own business ---------------- */
function CoachView() {
  const { user } = useViewer();
  const { data, error } = useData<CoachData>("coach");
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  const m = data.months.map(monthShort);
  const totalClasses = data.classes.reduce((a, c) => a + c.ran, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Income this month" value={data.hasPayments ? money(data.revenueThisMonth) : "—"} tone="success" sub={data.hasPayments ? <Delta value={pctChange(data.revenueThisMonth, data.revenueLastMonth)} /> : "Record payments to see it"} />
        <Stat label="Sessions this month" value={data.sessionsThisMonth} tone="accent" sub={<Delta value={pctChange(data.sessionsThisMonth, data.sessionsLastMonth)} />} />
        <Stat label="Active clients" value={data.clients.active} sub={`${data.clients.newThisMonth} new this month`} />
        <Stat label="Attendance" value={data.attendance.ratePct === null ? "—" : `${data.attendance.ratePct}%`} tone={data.attendance.ratePct !== null && data.attendance.ratePct < 80 ? "danger" : undefined} sub="Present vs no-show, 90 days" />
      </div>

      <section className="space-y-3">
        <SectionTitle>Income</SectionTitle>
        {data.hasPayments ? (
          <Card className="space-y-4 p-5">
            <Bars values={data.revenue.map((r) => r.cents)} labels={m} format={money} highlight={m.length - 1} tone="success" label="Income by month" />
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
              <span>
                Waiting to be paid: <b className="text-ink">{money(data.outstandingCents)}</b>
              </span>
              {data.refundedCents > 0 && (
                <span>
                  Refunded (6 months): <b className="text-ink">{money(data.refundedCents)}</b>
                </span>
              )}
            </div>
            {data.topPackages.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Best-selling packages (6 months)</th>
                      <th className="py-1 pr-3 text-right font-medium">Sold</th>
                      <th className="py-1 text-right font-medium">Income</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topPackages.map((p) => (
                      <tr key={p.name} className="border-t border-line">
                        <td className="py-1.5 pr-3">{p.name}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{p.sold}</td>
                        <td className="py-1.5 text-right tabular-nums">{money(p.cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ) : (
          <EmptyState icon={<BarChart3 size={26} />} title="No income recorded yet" hint="When clients pay you by PayNow or you record cash in Settings, Payments, your income shows up here." />
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>Sessions delivered</SectionTitle>
        <Card className="space-y-3 p-5">
          <Bars values={data.sessions.map((s, i) => s.done + (data.classes[i]?.ran ?? 0))} labels={m} highlight={m.length - 1} label="Sessions and classes delivered by month" />
          <p className="text-xs text-muted">
            1-on-1 sessions and group classes marked done. In the last 6 months: {data.sessions.reduce((a, s) => a + s.noShow, 0)} no-shows, {data.sessions.reduce((a, s) => a + s.cancelled, 0)} cancellations, {totalClasses} classes.
          </p>
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle>Look at these first</SectionTitle>
        {data.atRisk.length === 0 && data.lowCredits.length === 0 ? (
          <Card className="p-5 text-sm text-muted">Nobody needs a nudge right now: everyone has trained recently and has sessions left.</Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <Card className="p-0">
              <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold">
                <AlertTriangle size={16} className="text-pr" /> No session in 3+ weeks
              </div>
              {data.atRisk.length === 0 ? (
                <p className="p-4 text-sm text-muted">Nobody.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {data.atRisk.map((c) => (
                    <li key={c.id}>
                      <Link href={`/clients/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-field">
                        <span className="truncate font-medium">{c.name}</span>
                        <span className="shrink-0 text-xs text-muted">{c.days === null ? "no sessions yet" : `${c.days} days ago`}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="p-0">
              <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold">
                <Gift size={16} className="text-accent" /> Package nearly used up
              </div>
              {data.lowCredits.length === 0 ? (
                <p className="p-4 text-sm text-muted">Nobody.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {data.lowCredits.map((c) => (
                    <li key={c.id}>
                      <Link href={`/clients/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-field">
                        <span className="truncate font-medium">{c.name}</span>
                        <span className="shrink-0 text-xs text-muted">{c.credits === 0 ? "no sessions left" : "1 session left"}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
        <p className="text-xs text-muted">
          {data.clients.activePct === null ? "" : `${data.clients.activePct}% of your active clients (${data.clients.activeLast30} of ${data.clients.active}) trained in the last 30 days.`}
        </p>
      </section>

      <section className="space-y-3">
        <SectionTitle>Busy times</SectionTitle>
        <BusyTimes byWeekday={data.byWeekday} byHour={data.byHour} note="Book some sessions and your busiest times show here." />
      </section>

      <section className="space-y-3">
        <SectionTitle>Your performance</SectionTitle>
        <MyPerformance p={data.performance} />
      </section>

      {data.occupancy && (
        <section className="space-y-3">
          <SectionTitle>Your classes</SectionTitle>
          <OccupancyPanel occ={data.occupancy} />
        </section>
      )}

      <section className="space-y-3">
        <SectionTitle>Download</SectionTitle>
        <ExportBar
          view="coach"
          performance
          onReport={() =>
            saveReport({
              kind: "coach",
              who: user?.name ?? "Coach",
              period: periodText(),
              kpis: [
                ["Sessions, 30 days", String(data.performance.sessions30)],
                ["Active clients", String(data.performance.clients)],
                ["Attendance", data.performance.attendancePct === null ? "-" : `${data.performance.attendancePct}%`],
                ["Clients kept, 3 months", data.performance.retention.m3.pct === null ? "-" : `${data.performance.retention.m3.pct}%`],
                ["Class fill, 90 days", data.occupancy?.totals.fillPct == null ? "-" : `${data.occupancy.totals.fillPct}%`],
              ],
              performance: [data.performance],
              occupancy: data.occupancy,
            })
          }
        />
      </section>
    </div>
  );
}

/* ---------------- A gym ---------------- */
function GymView() {
  const { data, error } = useData<GymData>("gym");
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  const m = data.months.map(monthShort);
  const done30 = data.coaches.reduce((a, c) => a + c.sessions30, 0);
  const hours30 = Math.round(data.coaches.reduce((a, c) => a + c.hours30, 0) * 10) / 10;
  const classes30 = data.coaches.reduce((a, c) => a + c.classes30, 0);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        {data.gymName}: counts from your coaches’ schedules. Client names, health details and payments are never shown to a gym.
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active coaches" value={data.activeCoaches} sub={data.waiting ? `${data.waiting} waiting for approval` : undefined} />
        <Stat label="Sessions, 30 days" value={done30} tone="accent" sub={`${hours30} hours worked`} />
        <Stat label="Classes, 30 days" value={classes30} />
        <Stat label="Class fill" value={data.classFill.pct === null ? "—" : `${data.classFill.pct}%`} tone="success" sub={data.classFill.classes ? `${data.classFill.filled} of ${data.classFill.capacity} places, ${data.classFill.classes} classes` : "No classes in 30 days"} />
      </div>

      <ExportBar
        view="gym"
        performance={!!data.performance}
        onReport={() =>
          saveReport({
            kind: "gym",
            who: data.gymName,
            period: periodText(),
            kpis: [
              ["Active coaches", String(data.activeCoaches)],
              ["Sessions, 30 days", String(done30)],
              ["Hours worked", String(hours30)],
              ["Classes, 30 days", String(classes30)],
              ["Class fill, 90 days", data.occupancy.totals.fillPct === null ? "-" : `${data.occupancy.totals.fillPct}%`],
              ["Class no-shows", data.occupancy.totals.noShowPct === null ? "-" : `${data.occupancy.totals.noShowPct}%`],
            ],
            performance: data.performance,
            occupancy: data.occupancy,
          })
        }
      />

      <section className="space-y-3">
        <SectionTitle>Sessions delivered</SectionTitle>
        <Card className="p-5">
          <Bars values={data.sessionsByMonth.map((s) => s.done)} labels={m} highlight={m.length - 1} label="Sessions delivered by month" />
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle>{data.performance ? "Coach performance" : "Coaches, last 30 days"}</SectionTitle>
        {data.performance ? (
          <PerformanceTable rows={data.performance} />
        ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Coach</th>
                <th className="px-2 py-2 text-right font-medium">Sessions</th>
                <th className="px-2 py-2 text-right font-medium">Hours</th>
                <th className="px-2 py-2 text-right font-medium">Classes</th>
                <th className="px-2 py-2 text-right font-medium">No-shows</th>
                <th className="px-4 py-2 text-right font-medium">Cancelled</th>
              </tr>
            </thead>
            <tbody>
              {data.coaches.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="px-4 py-2 font-medium">{c.name}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{c.sessions30}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{c.hours30}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{c.classes30}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{c.noShows30}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{c.cancels30}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>Class occupancy</SectionTitle>
        <OccupancyPanel occ={data.occupancy} />
      </section>

      <section className="space-y-3">
        <SectionTitle>Busy times</SectionTitle>
        <BusyTimes byWeekday={data.byWeekday} byHour={data.byHour} note="When your coaches have sessions, the busiest days and hours show here." />
      </section>
    </div>
  );
}

/* ---------------- The platform owner ---------------- */
function OwnerView() {
  const { data, error } = useData<OwnerData>("owner");
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  const wk = data.weeks.map((w) => `${Number(w.week.slice(8, 10))} ${monthShort(w.week.slice(0, 7))}`);
  const c = data.coaches;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Monthly income" value={money(data.mrrCents)} tone="success" sub={`${c.paying} paying coach${c.paying === 1 ? "" : "es"}`} />
        <Stat label="On free trial" value={c.trialing} tone="accent" sub={`${c.trialEnded} trials ended without paying`} />
        <Stat label="Trial to paid" value={data.conversionPct === null ? "—" : `${data.conversionPct}%`} sub="Of coaches whose trial is over" />
        <Stat label="Coaches" value={c.total} sub={`${c.exempt} free (owner, testers)`} />
      </div>

      <section className="space-y-3">
        <SectionTitle>New sign-ups each week</SectionTitle>
        <Card className="p-5">
          <StackedBars
            label="Sign-ups by week"
            labels={wk}
            series={[
              { name: "Coaches", values: data.weeks.map((w) => w.coaches) },
              { name: "Solo", values: data.weeks.map((w) => w.solo) },
              { name: "Clients", values: data.weeks.map((w) => w.clients) },
            ]}
            colors={["bg-accent", "bg-success", "bg-pr"]}
          />
        </Card>
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <Card className="space-y-1 p-5 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Last 30 days</div>
          <div>
            New coaches <b>{data.signups30.coaches}</b>, solo users <b>{data.signups30.solo}</b>, clients <b>{data.signups30.clients}</b>
          </div>
          <div className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted">Signed in this week</div>
          <div>
            Coaches <b>{data.activeThisWeek.coaches}</b>, solo users <b>{data.activeThisWeek.solo}</b>, clients <b>{data.activeThisWeek.clients}</b>
          </div>
          <div className="pt-2 text-xs text-muted">{data.verifiedPct === null ? "" : `${data.verifiedPct}% of accounts have confirmed their email.`}</div>
        </Card>
        <Card className="space-y-1 p-5 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Gyms and referrals</div>
          <div>
            Gyms <b>{data.gyms.active}</b> active of {data.gyms.total}
          </div>
          <div>
            Coach referrals: <b>{data.referrals.invited}</b> invited, <b>{data.referrals.subscribed}</b> subscribed, <b>{data.referrals.rewarded}</b> free months given
          </div>
          <div>
            Friend invitations: <b>{data.referrals.friends.clients}</b> to a coach (by clients), <b>{data.referrals.friends.solo}</b> by solo users
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function BusinessPage() {
  const { user, isTrainer } = useViewer();
  const [views, setViews] = useState<{ coach: boolean; gym: boolean; owner: boolean } | null>(null);
  const [tab, setTab] = useState<View>("coach");

  useEffect(() => {
    if (!user || !isTrainer) return;
    let alive = true;
    void fetch("/api/business")
      .then((r) => r.json())
      .then((j: { views?: { coach: boolean; gym: boolean; owner: boolean } }) => alive && j.views && setViews(j.views))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [user, isTrainer]);

  if (!user || !isTrainer) return null;
  const tabs = [
    { value: "coach" as View, label: "My coaching" },
    ...(views?.gym ? [{ value: "gym" as View, label: "Gym" }] : []),
    ...(views?.owner ? [{ value: "owner" as View, label: "Platform" }] : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Business" subtitle="Income, sessions, clients and busy times at a glance" />
      {tabs.length > 1 && <Segmented value={tab} onChange={setTab} options={tabs} className="w-full sm:w-auto" />}
      {tab === "coach" && <CoachView />}
      {tab === "gym" && views?.gym && <GymView />}
      {tab === "owner" && views?.owner && <OwnerView />}
    </div>
  );
}
