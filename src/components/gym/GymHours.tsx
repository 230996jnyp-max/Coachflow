"use client";

import { addMonths, endOfMonth, format, startOfMonth } from "date-fns";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, Field, Input, Notice, Stat } from "@/components/ui";
import { api } from "@/lib/store";
import { hoursText, money, type HoursData } from "./types";

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

/** Completed hours per coach for a month or any range (sessions and classes with attendance marked), and a CSV for payroll. */
export function GymHours() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState(ymd(startOfMonth(new Date())));
  const [to, setTo] = useState(ymd(endOfMonth(new Date())));
  const [data, setData] = useState<HoursData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const f = custom ? from : ymd(month);
  const t = custom ? to : ymd(endOfMonth(month));

  useEffect(() => {
    let alive = true;
    api<HoursData>(`/api/gym/hours?from=${f}&to=${t}`).then((r) => {
      if (!alive) return;
      if (r.ok && r.data) {
        setData(r.data);
        setError(null);
      } else setError(r.error ?? "Could not load the hours.");
    });
    return () => {
      alive = false;
    };
  }, [f, t]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {!custom ? (
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" aria-label="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))}>
              <ChevronLeft size={16} />
            </Button>
            <div className="min-w-32 text-center text-sm font-semibold">{format(month, "MMMM yyyy")}</div>
            <Button variant="secondary" size="sm" aria-label="Next month" onClick={() => setMonth((m) => addMonths(m, 1))}>
              <ChevronRight size={16} />
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="From">
              <Input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
            </Field>
          </div>
        )}
        <Button variant="ghost" size="sm" onClick={() => setCustom((c) => !c)}>
          {custom ? "Pick a month" : "Custom dates"}
        </Button>
        <div className="flex-1" />
        <a href={`/api/gym/hours?from=${f}&to=${t}&format=csv`}>
          <Button size="sm" variant="secondary">
            <Download size={15} /> Download CSV
          </Button>
        </a>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <Card className="p-6 text-center text-sm text-muted">Loading…</Card>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Total hours" value={hoursText(data.totals.minutes)} tone="accent" />
            <Stat label="1-on-1 sessions" value={data.totals.sessions} />
            <Stat label="Classes" value={data.totals.classes} />
            {data.totals.amountCents !== null && <Stat label="Pay due" value={money(data.totals.amountCents)} tone="success" sub="where a rate is set" />}
          </div>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">Coach</th>
                  <th className="px-3 py-3 text-right">Sessions</th>
                  <th className="px-3 py-3 text-right">Classes</th>
                  <th className="px-3 py-3 text-right">Hours</th>
                  <th className="px-3 py-3 text-right">Rate</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((r) => (
                  <tr key={r.userId}>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{r.name}</div>
                      <div className="text-xs text-muted">{r.roleName}</div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.sessions}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.classes}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{hoursText(r.minutes)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted">{r.rateCents === null ? "—" : `${money(r.rateCents)}/h`}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{r.amountCents === null ? "—" : money(r.amountCents)}</td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted">
                      No coaches yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
          <p className="text-xs text-muted">
            Counts completed 1-on-1 sessions and group classes with attendance marked{data.countNoShows ? ", and client no-shows" : ""}. Cover counts for the coach who did it. Set hourly rates on the Team tab; change the no-show rule in Settings.
          </p>
        </>
      )}
    </div>
  );
}
