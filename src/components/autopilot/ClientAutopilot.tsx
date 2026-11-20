"use client";

import { Bot } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { api } from "@/lib/store";
import { Activity, type EventView } from "./AutopilotPage";

/** On a client's Overview: what Autopilot did (or drafted) for this client, with the reason. Nothing shows when there is nothing. */
export function ClientAutopilot({ clientId }: { clientId: string }) {
  const [events, setEvents] = useState<EventView[] | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await api<{ events: EventView[] }>(`/api/autopilot/events?clientId=${clientId}`);
      if (alive && r.ok && r.data) setEvents(r.data.events.slice(0, 5));
    })();
    return () => {
      alive = false;
    };
  }, [clientId]);
  if (!events || events.length === 0) return null;
  return (
    <Card className="space-y-2 p-4" data-tour="client-autopilot">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted">
          <Bot size={14} /> Autopilot
        </h3>
        <Link href="/autopilot" className="text-xs font-semibold text-accent">
          Rules →
        </Link>
      </div>
      <Activity events={events} />
    </Card>
  );
}
