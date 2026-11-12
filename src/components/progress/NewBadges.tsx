"use client";

import { Share2 } from "lucide-react";
import { useMemo } from "react";
import { Confetti } from "@/components/Confetti";
import { Button, Notice } from "@/components/ui";
import { badgeStatuses, earnedIn } from "@/lib/badges";
import { useViewer } from "@/lib/hooks";
import { useNow } from "@/lib/store";
import { useBadgeShare } from "./BadgeShare";

/** "You earned a badge": shown on a finished workout that crossed a milestone, with a button to share it. Nothing when there is none. */
export function NewBadges({ workoutId, clientId }: { workoutId: string; clientId: string }) {
  const { db, exMap, user } = useViewer();
  const now = useNow(60_000);
  const mine = useMemo(() => earnedIn(badgeStatuses(db.workouts, exMap, clientId, now), workoutId), [db.workouts, exMap, clientId, now, workoutId]);
  const { share, busy, flash } = useBadgeShare(clientId);
  if (mine.length === 0) return null;

  return (
    <div className="space-y-2" data-tour="new-badges">
      {user?.prefs?.celebrate !== false && <Confetti />}
      {mine.map((s) => (
        <div key={s.def.id} className="flex items-center gap-3 rounded-xl border border-pr/40 bg-pr/10 px-4 py-3" data-new-badge={s.def.id}>
          <span className="text-3xl" aria-hidden>
            {s.def.emoji}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-pr">Badge earned</div>
            <div className="truncate font-bold">{s.def.title}</div>
            <div className="text-xs text-muted">{s.def.blurb}</div>
          </div>
          <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void share(s)}>
            <Share2 size={14} /> {busy === s.def.id ? "…" : "Share"}
          </Button>
        </div>
      ))}
      {flash && <Notice tone={flash.tone === "error" ? "error" : "success"}>{flash.text}</Notice>}
    </div>
  );
}
