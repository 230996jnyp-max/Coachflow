"use client";

import { formatDistance, parseISO } from "date-fns";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { markNotificationsRead, useNow } from "@/lib/store";
import { cn } from "@/lib/utils";
import { ApprovalCard } from "./groupUi";

/**
 * Bell with a badge: unread notifications plus join requests waiting for my answer. Opening it does not mark anything read: an item is
 * read when you open it, or with "Mark all read". The Notifications page ("See all") has every notification, sorted into tabs.
 */
export function NotificationBell({ className }: { className?: string }) {
  const { db } = useViewer();
  const [open, setOpen] = useState(false);
  const now = useNow(60_000);
  const toAnswer = db.groupRequests.filter((r) => r.needsMe);
  const unread = db.notifications.filter((n) => !n.read).length;
  const count = unread + toAnswer.length;

  return (
    <>
      <button
        type="button"
        data-tour="bell"
        onClick={() => setOpen(true)}
        aria-label={count ? `Notifications, ${count} new` : "Notifications"}
        className={cn("relative flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-field text-ink", className)}
      >
        <Bell size={20} />
        {count > 0 && (
          <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-on-danger">{count > 9 ? "9+" : count}</span>
        )}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Notifications"
        footer={
          <>
            {unread > 0 && (
              <Button variant="ghost" onClick={() => void markNotificationsRead("all")}>
                Mark all read
              </Button>
            )}
            <Link href="/notifications" onClick={() => setOpen(false)}>
              <Button variant="secondary">See all</Button>
            </Link>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {toAnswer.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-muted">Waiting for your answer</div>
              {toAnswer.map((r) => (
                <ApprovalCard key={r.id} req={r} group={db.groups.find((g) => g.id === r.groupId)} />
              ))}
            </div>
          )}
          {db.notifications.length === 0 && toAnswer.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Nothing new. Approvals, waitlist spots and class changes will show up here.</p>
          ) : (
            <ul className="space-y-2">
              {db.notifications.slice(0, 15).map((n) => {
                const body = (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-bold">{n.title}</span>
                      <span className="shrink-0 text-[10px] text-muted">{formatDistance(parseISO(n.createdAt), now, { addSuffix: true })}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{n.body}</p>
                  </>
                );
                const cls = cn("block w-full rounded-xl border p-3 text-left", n.read ? "border-line bg-field/40" : "border-accent/40 bg-accent/10");
                const read = () => {
                  if (!n.read) void markNotificationsRead([n.id]);
                };
                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link
                        href={n.link}
                        onClick={() => {
                          read();
                          setOpen(false);
                        }}
                        className={cls}
                      >
                        {body}
                      </Link>
                    ) : (
                      <button type="button" onClick={read} className={cls}>
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Modal>
    </>
  );
}
