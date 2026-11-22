"use client";

import { Bot } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useViewer } from "@/lib/hooks";
import { api } from "@/lib/store";
import { Waiting, type EventView } from "./AutopilotPage";

/**
 * On the coach's dashboard: opening it runs their Autopilot rules (at most every 10 minutes, so a new client is welcomed soon after they
 * join), and any drafts waiting for approval are listed here. Nothing at all shows when there is nothing waiting.
 */
export function AutopilotDashboard() {
  const { isTrainer } = useViewer();
  const [waiting, setWaiting] = useState<EventView[] | null>(null);

  useEffect(() => {
    if (!isTrainer) return;
    let alive = true;
    void (async () => {
      await api("/api/autopilot/run", { body: { tick: true } });
      const r = await api<{ events: EventView[] }>("/api/autopilot/events?status=DRAFT,HELD");
      if (alive && r.ok && r.data) setWaiting(r.data.events);
    })();
    return () => {
      alive = false;
    };
  }, [isTrainer]);

  if (!isTrainer || !waiting || waiting.length === 0) return null;
  return (
    <section className="space-y-2" data-autopilot-dashboard>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <Bot size={16} className="text-accent" /> Autopilot: {waiting.length} waiting for you
        </h2>
        <Link href="/autopilot" className="text-xs font-semibold text-accent">
          Open Autopilot →
        </Link>
      </div>
      <Waiting events={waiting.slice(0, 3)} onChange={setWaiting} />
      {waiting.length > 3 && (
        <Link href="/autopilot" className="block text-sm text-muted hover:text-ink">
          and {waiting.length - 3} more
        </Link>
      )}
    </section>
  );
}
