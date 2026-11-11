"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { useMemo } from "react";
import { Badge } from "@/components/ui";
import { clientStatus, pctTone, type ClientStatus } from "@/lib/attention";
import { useViewer } from "@/lib/hooks";
import { useNow } from "@/lib/store";
import { cn } from "@/lib/utils";

/** Everyone's weekly-target score and reasons to look at them, recomputed once a minute. Archived clients are included but never flagged. */
export function useStatuses(): Map<string, ClientStatus> {
  const { db, clients } = useViewer();
  const now = useNow(60_000);
  return useMemo(() => {
    const m = new Map<string, ClientStatus>();
    for (const c of clients) m.set(c.user.id, clientStatus({ user: c.user, profile: c.profile, db, now }));
    return m;
  }, [clients, db, now]);
}

const TONE_CLASS = {
  success: "border-success/30 bg-success/15 text-success",
  warn: "border-pr/30 bg-pr/15 text-pr",
  danger: "border-danger/30 bg-danger/15 text-danger",
} as const;

const BAR_CLASS = { success: "bg-success", warn: "bg-pr", danger: "bg-danger" } as const;

/** "7d 100%" style pill. Green on track, amber slipping, red well behind. */
export function PctPill({ pct, label, className }: { pct: number; label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold tabular-nums", TONE_CLASS[pctTone(pct)], className)} title={label ? `${label}: ${pct}% of the weekly target` : `${pct}% of the weekly target`}>
      {label && <span className="font-semibold opacity-80">{label}</span>}
      {pct}%
    </span>
  );
}

/** A thin progress bar in the same traffic-light colours. */
export function PctBar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-line", className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className={cn("h-full rounded-full transition-all", BAR_CLASS[pctTone(pct)])} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** The short reasons a client needs a look ("Behind: 1 of 3 this week", "Quiet for 9 days"). */
export function ReasonBadges({ status, max = 3 }: { status: ClientStatus; max?: number }) {
  if (status.reasons.length === 0) return null;
  const shown = status.reasons.slice(0, max);
  const more = status.reasons.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((r) => (
        <Badge key={r} className="border-pr/30 bg-pr/15 text-pr">
          {r}
        </Badge>
      ))}
      {more > 0 && <Badge>+{more}</Badge>}
    </div>
  );
}

/** "2 days ago", or "No sessions yet". */
export function lastSeen(status: ClientStatus, now: Date): string {
  if (!status.lastActivity) return "No sessions yet";
  if (now.getTime() - status.lastActivity.getTime() < 60_000) return "Just now";
  return `${formatDistanceToNowStrict(status.lastActivity, { addSuffix: true })}`;
}
