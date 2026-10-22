"use client";

import { format, parseISO } from "date-fns";
import { useEffect, useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { fetchCreditLog } from "@/lib/store";
import type { AttendanceStats, CreditLogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

const ACTION: Record<string, string> = {
  RESERVED: "Booked / Reserved",
  ATTENDED: "Attended — Credit Taken",
  NOSHOW_RETURNED: "No-Show — Credit Returned",
  NOSHOW_DEDUCTED: "No-Show — Coach Override Deducted",
  CORRECTION: "Attendance Corrected",
  ADJUSTMENT: "Coach Manual Adjustment",
  OPENING: "Coach Manual Adjustment",
};

/** Attendance reliability and the credit transaction log for one client (the coach passes `clientId`; a client sees their own). */
export function CreditHistory({ clientId }: { clientId?: string }) {
  const { db, user } = useViewer();
  const target = clientId ?? user?.id;
  const profile = db.clients.find((c) => c.id === target);
  const [data, setData] = useState<{ stats: AttendanceStats; log: CreditLogEntry[] } | null>(null);
  const [failed, setFailed] = useState(false);
  // Re-read whenever this client's balances or sessions change.
  const stamp = `${profile?.credits}:${profile?.groupClassCredits}:${db.bookings.filter((b) => b.clientId === target).map((b) => b.status + (b.attendance?.mark ?? "")).join(",")}`;
  useEffect(() => {
    if (!target) return;
    let alive = true;
    void fetchCreditLog(clientId).then((r) => {
      if (!alive) return;
      setData(r);
      setFailed(!r);
    });
    return () => {
      alive = false;
    };
  }, [target, clientId, stamp]);

  const stats = data?.stats;
  const pct = stats?.rate;
  return (
    <section className="space-y-3">
      <SectionTitle>Attendance &amp; credit log</SectionTitle>
      <div className="grid grid-cols-3 gap-3 text-center">
        <Card className="p-4">
          <div className={cn("text-2xl font-bold", pct === null || pct === undefined ? "" : pct >= 90 ? "text-success" : pct >= 70 ? "text-pr" : "text-danger")}>{pct === null || pct === undefined ? "—" : `${pct}%`}</div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Attendance rate</div>
        </Card>
        <Card className="p-4">
          <div className="text-2xl font-bold text-success">{stats?.present ?? 0}</div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Attended</div>
        </Card>
        <Card className="p-4">
          <div className="text-2xl font-bold text-danger">{stats?.noShow ?? 0}</div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted">No-shows</div>
        </Card>
      </div>
      <Card className="p-0">
        <div className="hidden grid-cols-[120px_100px_1fr_70px_90px] gap-2 border-b border-line px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted md:grid">
          <span>Date</span>
          <span>Type</span>
          <span>Action</span>
          <span className="text-right">Change</span>
          <span className="text-right">Balance</span>
        </div>
        {failed && <div className="p-4 text-sm text-muted">The log couldn’t be loaded. Try again in a moment.</div>}
        {!failed && data && data.log.length === 0 && <div className="p-4 text-sm text-muted">No credit activity recorded yet. Every booking, attendance mark and manual change from now on will appear here.</div>}
        <ul className="divide-y divide-line">
          {(data?.log ?? []).map((e) => (
            <li key={e.id} className="grid gap-1 px-4 py-3 text-sm md:grid-cols-[120px_100px_1fr_70px_90px] md:items-center md:gap-2">
              <span className="text-xs text-muted">{format(parseISO(e.at), "d MMM yyyy, h:mm a")}</span>
              <span className="text-xs font-semibold">{e.sessionType === "Group Class" ? "Group Class" : e.sessionType === "1-on-1 PT" ? "1-on-1 PT" : e.pool === "GROUP" ? "Group credits" : "1-on-1 credits"}</span>
              <span className="min-w-0">
                <span className="font-semibold">{ACTION[e.kind] ?? e.kind}</span>
                <span className="block truncate text-xs text-muted">
                  {e.label}
                  {e.note ? ` · ${e.note}` : ""}
                </span>
              </span>
              <span className={cn("text-xs font-bold md:text-right", e.delta < 0 ? "text-danger" : e.delta > 0 ? "text-success" : "text-muted")}>{e.delta > 0 ? `+${e.delta}` : e.delta === 0 ? "0" : e.delta}</span>
              <span className="text-xs font-bold md:text-right">
                {e.balance} <span className="font-normal text-muted">{e.pool === "GROUP" ? "group" : "left"}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
