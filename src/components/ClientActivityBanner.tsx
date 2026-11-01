"use client";

import { Bell, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { markNotificationsRead } from "@/lib/store";

/** The coach's dashboard: clients who just logged or imported a workout (unread), each tap opening the workout and clearing the alert. */
export function ClientActivityBanner() {
  const { db } = useViewer();
  const router = useRouter();
  const unread = db.notifications.filter((n) => !n.read && (n.kind === "client_workout" || n.kind === "client_import")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (unread.length === 0) return null;
  const shown = unread.slice(0, 3);

  return (
    <section aria-label="Client activity" className="space-y-2">
      {shown.map((n) => (
        <button
          key={n.id}
          type="button"
          onClick={() => {
            void markNotificationsRead([n.id]);
            if (n.link) router.push(n.link);
          }}
          className="block w-full text-left"
        >
          <Card className="flex items-center gap-3 border-accent/40 bg-accent/10 p-3 hover:border-accent">
            <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent">
              <Bell size={17} />
            </span>
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-semibold">{n.title}</span>
              <span className="block truncate text-muted">{n.body}</span>
            </span>
            <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-accent">
              Tap to view <ChevronRight size={15} />
            </span>
          </Card>
        </button>
      ))}
      {unread.length > shown.length && (
        <button type="button" onClick={() => void markNotificationsRead(unread.slice(3).map((n) => n.id))} className="text-xs font-semibold text-muted hover:text-ink">
          +{unread.length - shown.length} more · mark as read
        </button>
      )}
    </section>
  );
}
