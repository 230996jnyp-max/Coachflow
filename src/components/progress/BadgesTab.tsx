"use client";

import { format, parseISO } from "date-fns";
import { Share2 } from "lucide-react";
import { useMemo } from "react";
import { Button, Card, Notice } from "@/components/ui";
import { badgeLeft, badgePercent, badgeStatuses } from "@/lib/badges";
import { useViewer } from "@/lib/hooks";
import { useNow } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useBadgeShare } from "./BadgeShare";

/** Every badge a client can earn: the ones they have (with a share button) and how far off the others are. */
export function BadgesTab({ clientId }: { clientId: string }) {
  const { db, exMap, user } = useViewer();
  const now = useNow(60_000);
  const statuses = useMemo(() => badgeStatuses(db.workouts, exMap, clientId, now), [db.workouts, exMap, clientId, now]);
  const { share, busy, flash } = useBadgeShare(clientId);
  const earned = statuses.filter((s) => s.earnedAt).length;
  const own = user?.id === clientId;
  const first = db.users.find((u) => u.id === clientId)?.name.split(" ")[0] ?? "They";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">
          {earned} of {statuses.length} earned
        </h2>
        <span className="text-xs text-muted">Earned automatically from {own ? "your" : `${first}'s`} finished workouts.</span>
      </div>
      {flash && <Notice tone={flash.tone === "error" ? "error" : "success"}>{flash.text}</Notice>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {statuses.map((s) => (
          <Card key={s.def.id} className={cn("flex flex-col gap-3 p-4", s.earnedAt ? "border-pr/40" : "opacity-80")} data-badge={s.def.id} data-earned={s.earnedAt ? "yes" : "no"}>
            <div className="flex items-center gap-3">
              <span className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 text-3xl", s.earnedAt ? "border-pr bg-pr/10" : "border-line bg-field grayscale")} aria-hidden>
                {s.def.emoji}
              </span>
              <div className="min-w-0">
                <div className="font-bold">{s.def.title}</div>
                <div className="text-xs text-muted">{s.earnedAt ? `Earned ${format(parseISO(s.earnedAt), "d MMM yyyy")}` : "Not yet"}</div>
              </div>
            </div>
            <p className="text-sm text-muted">{s.def.blurb}</p>
            {s.earnedAt ? (
              <Button variant="secondary" size="sm" className="mt-auto self-start" disabled={busy !== null} onClick={() => void share(s)}>
                <Share2 size={14} /> {busy === s.def.id ? "Making…" : "Share"}
              </Button>
            ) : (
              <div className="mt-auto space-y-1">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={badgePercent(s)} aria-label={`${s.def.title} progress`}>
                  <div className="h-full rounded-full bg-accent" style={{ width: `${badgePercent(s)}%` }} />
                </div>
                <div className="text-xs text-muted">{badgeLeft(s)}</div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
