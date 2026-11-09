"use client";

import { format, parseISO } from "date-fns";
import { ClipboardList } from "lucide-react";
import Link from "next/link";
import { laneWorkout, minutesToStart, nextFloorSession, resolveFloorSession } from "@/lib/floor";
import { useViewer } from "@/lib/hooks";
import { useNow } from "@/lib/store";
import { Avatar } from "@/components/ui";

function whoText(names: string[]): string {
  if (names.length <= 2) return names.join(" & ");
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}

/** Coach: a one-line prompt to run the session that is starting (or already under way) on the gym floor. */
export function FloorBanner() {
  const { db } = useViewer();
  const now = useNow(30_000);
  const s = nextFloorSession(db, now);
  if (!s) return null;
  const names = s.participants.map((p) => (db.users.find((u) => u.id === p.clientId)?.name ?? "Client").split(" ")[0]);
  const mins = minutesToStart(s, now);
  const running = s.participants.some((p) => laneWorkout(db.workouts, s, p.clientId)?.status === "ACTIVE");
  return (
    <Link href={`/floor/${s.key}`} className="mb-4 flex items-center gap-3 rounded-2xl border border-accent/40 bg-accent-dim p-3 transition-colors hover:border-accent">
      <Avatar name={names[0] ?? "Session"} size={36} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold">{whoText(names)}</div>
        <div className="text-xs text-muted">
          {running ? "In progress on the gym floor" : mins > 0 ? `Starts ${format(parseISO(s.start), "h:mm a")} · in ${mins} min` : `Started ${format(parseISO(s.start), "h:mm a")}`} · {s.title}
        </div>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-on-accent">
        <ClipboardList size={14} /> {running ? "Resume" : "Start session"}
      </span>
    </Link>
  );
}

/** A "run it on the gym floor" button for a session screen (shown for sessions starting within a day that are not finished). */
export function FloorLink({ sessionKey, className }: { sessionKey: string; className?: string }) {
  const { db } = useViewer();
  const now = useNow(60_000);
  const s = resolveFloorSession(db, sessionKey);
  if (!s || s.finalized || s.cancelled || s.pending) return null;
  const startsSoon = Date.parse(s.start) < now.getTime() + 24 * 3600_000 && Date.parse(s.end) > now.getTime() - 2 * 3600_000;
  if (!startsSoon || !s.participants.length) return null;
  return (
    <Link href={`/floor/${s.key}`} className={className ?? "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:brightness-110"}>
      <ClipboardList size={16} /> Run on gym floor
    </Link>
  );
}
