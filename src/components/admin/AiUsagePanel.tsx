"use client";

import { format, parseISO } from "date-fns";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Card, Notice, SectionTitle, Select, Stat } from "@/components/ui";
import { api } from "@/lib/store";
import { cn } from "@/lib/utils";

interface Windows {
  today: number;
  week: number;
  month: number;
  all: number;
}
type Feature = "workout_import" | "niche_search" | "custom_tracking" | "progression" | "other";
interface Row {
  coachId: string;
  name: string;
  email: string;
  gym: string;
  total: Windows;
  own: number;
  byClients: number;
  byFeature: Record<Feature, Windows>;
  lastFeature: Feature | null;
  lastAt: string | null;
}
interface Report {
  rows: Row[];
  gyms: { id: string; name: string; total: Windows }[];
  solo: Windows;
  featureLabels: Record<Feature, string>;
  totals: Windows;
}

const FEATURES: Feature[] = ["workout_import", "niche_search", "custom_tracking", "progression", "other"];

/** How much each coach (and gym) uses the AI features: today, 7 days, 30 days and all time, by feature, with the last use. */
export function AiUsagePanel() {
  const [gymId, setGymId] = useState("");
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<Report>(`/api/admin/ai-usage${gymId ? `?gymId=${gymId}` : ""}`).then((r) => {
      if (!alive) return;
      if (r.ok && r.data) {
        setData(r.data);
        setError(null);
      } else setError(r.error ?? "Could not load AI usage.");
    });
    return () => {
      alive = false;
    };
  }, [gymId]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Card className="p-6 text-center text-sm text-muted">Loading…</Card>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Today" value={data.totals.today} tone="accent" sub="AI uses, everyone" />
        <Stat label="Last 7 days" value={data.totals.week} />
        <Stat label="Last 30 days" value={data.totals.month} />
        <Stat label="All time" value={data.totals.all} sub={`${data.solo.all} by solo users`} />
      </div>

      {data.gyms.length > 0 && (
        <section>
          <SectionTitle>By gym</SectionTitle>
          <Card className="divide-y divide-line p-0">
            {data.gyms.map((g) => (
              <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="font-semibold">{g.name}</span>
                <span className="text-muted">
                  today {g.total.today} · 7 days {g.total.week} · 30 days {g.total.month} · <strong className="text-ink">all {g.total.all}</strong>
                </span>
              </div>
            ))}
          </Card>
        </section>
      )}

      <section className="space-y-3">
        <SectionTitle>By coach</SectionTitle>
        <Select value={gymId} onChange={(e) => setGymId(e.target.value)} aria-label="Filter by gym">
          <option value="">All coaches</option>
          {data.gyms.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
        <div className="space-y-2">
          {data.rows.length === 0 && <Card className="p-6 text-center text-sm text-muted">Nobody yet.</Card>}
          {data.rows.map((r) => (
            <Card key={r.coachId} className="p-0">
              <button type="button" aria-expanded={open === r.coachId} onClick={() => setOpen(open === r.coachId ? null : r.coachId)} className="flex w-full items-start gap-3 p-4 text-left">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-bold">{r.name}</span>
                    <Badge className={r.gym === "Independent" ? undefined : "border-accent/30 bg-accent/15 text-accent"}>{r.gym}</Badge>
                  </div>
                  <div className="truncate text-xs text-muted">{r.email}</div>
                  <div className="mt-1 text-sm">
                    <span className="text-muted">Today</span> <strong>{r.total.today}</strong> · <span className="text-muted">7 days</span> <strong>{r.total.week}</strong> · <span className="text-muted">30 days</span> <strong>{r.total.month}</strong> · <span className="text-muted">All time</span> <strong>{r.total.all}</strong>
                  </div>
                  <div className="text-xs text-muted">{r.lastFeature && r.lastAt ? `Last: ${data.featureLabels[r.lastFeature]}, ${format(parseISO(r.lastAt), "d MMM, h:mm a")}` : "No AI use yet"}</div>
                </div>
                <ChevronDown size={18} className={cn("mt-1 shrink-0 text-muted transition-transform", open === r.coachId && "rotate-180")} />
              </button>
              {open === r.coachId && (
                <div className="border-t border-line px-4 pb-4 pt-3">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase tracking-wide text-muted">
                      <tr>
                        <th className="py-1 text-left">Feature</th>
                        <th className="py-1 text-right">Today</th>
                        <th className="py-1 text-right">7 d</th>
                        <th className="py-1 text-right">30 d</th>
                        <th className="py-1 text-right">All</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {FEATURES.map((f) => (
                        <tr key={f}>
                          <td className="py-1.5">{data.featureLabels[f]}</td>
                          <td className="py-1.5 text-right tabular-nums">{r.byFeature[f].today}</td>
                          <td className="py-1.5 text-right tabular-nums">{r.byFeature[f].week}</td>
                          <td className="py-1.5 text-right tabular-nums">{r.byFeature[f].month}</td>
                          <td className="py-1.5 text-right font-semibold tabular-nums">{r.byFeature[f].all}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-muted">
                    All-time total includes {r.own} by the coach and {r.byClients} by their clients.
                  </p>
                </div>
              )}
            </Card>
          ))}
        </div>
        <p className="text-xs text-muted">Counts start from the day this tracker went live. Calls by people with no coach (solo accounts) are counted together in the totals above.</p>
      </section>
    </div>
  );
}
