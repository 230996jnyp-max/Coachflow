"use client";

import { CheckCircle2, RefreshCw, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useSyncStatus } from "@/lib/syncStatus";

/**
 * Says plainly whether the phone has a signal and whether anything is waiting to be sent: "Offline" (with how many changes are saved on
 * the phone), "Syncing" when a wait is dragging on, and a short "All changes synced" once the waiting changes have gone out.
 * Workouts, food and check-ins all report here, so one strip covers them. It stays out of the way when everything is normal.
 */
export function SyncBanner() {
  const s = useSyncStatus();
  const waitingOnline = s.online && s.pending > 0;
  // A moment of waiting while online (changes are sent a second after the last tap) is normal; only a longer wait is shown.
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setStuck(waitingOnline), waitingOnline ? 6000 : 0);
    return () => clearTimeout(t);
  }, [waitingOnline]);

  const n = s.pending;
  const changes = `${n} change${n === 1 ? "" : "s"}`;

  if (!s.online) {
    return (
      <div role="status" aria-live="polite" data-testid="sync-banner" className="mb-4 flex items-start gap-3 rounded-xl border border-pr/40 bg-pr/10 px-4 py-3 text-sm">
        <WifiOff size={18} className="mt-0.5 shrink-0 text-pr" />
        <div className="min-w-0">
          <div className="font-semibold text-pr">You’re offline{n > 0 ? ` · ${changes} waiting to sync` : ""}</div>
          <div className="text-xs text-muted">
            {n > 0 ? "They are saved on this phone and go out by themselves when you’re back online." : "Keep going: workouts, food and check-ins are saved on this phone and sync when you’re back online."}
          </div>
        </div>
      </div>
    );
  }
  if (waitingOnline && stuck) {
    return (
      <div role="status" aria-live="polite" data-testid="sync-banner" className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-field px-4 py-3 text-sm">
        <RefreshCw size={16} className="shrink-0 animate-spin text-accent" />
        <span className="font-semibold">Syncing {changes}…</span>
      </div>
    );
  }
  if (s.justSynced && n === 0) {
    return (
      <div role="status" aria-live="polite" data-testid="sync-banner" className="mb-4 flex items-center gap-3 rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm">
        <CheckCircle2 size={18} className="shrink-0 text-success" />
        <span className="font-semibold text-success">All changes synced</span>
      </div>
    );
  }
  return null;
}
