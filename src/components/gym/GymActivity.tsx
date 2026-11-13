"use client";

import { format, parseISO } from "date-fns";
import { useEffect, useState } from "react";
import { Card, Notice } from "@/components/ui";
import { api } from "@/lib/store";

interface Item {
  id: string;
  actor: string;
  action: string;
  detail: string;
  at: string;
}

const LABEL: Record<string, string> = {
  gym_created: "Created the gym",
  joined: "Joined",
  join_requested: "Asked to join",
  request_withdrawn: "Withdrew a request",
  left: "Left",
  approved: "Approved",
  declined: "Declined",
  removed: "Removed",
  role_changed: "Changed a role",
  role_created: "Created a role",
  role_updated: "Edited a role",
  role_deleted: "Deleted a role",
  member_updated: "Updated a coach",
  invited: "Invited",
  invite_cancelled: "Cancelled an invitation",
  code_regenerated: "Made a new gym code",
  settings_changed: "Changed settings",
  branch_added: "Added a branch",
  branch_updated: "Edited a branch",
  branch_deleted: "Removed a branch",
  branding_picture: "Changed a picture",
  defaults_applied_to_all: "Applied defaults to everyone",
  cover_arranged: "Arranged cover",
  cover_undone: "Undid cover",
  session_cancelled: "Cancelled a session",
  class_cancelled: "Cancelled a class",
  class_created: "Created a class",
  move_proposed: "Asked a client to move",
  move_accepted: "A client agreed to move",
  move_declined: "A client stayed",
};

/** Who linked, removed, moved or covered whom. */
export function GymActivity() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api<{ items: Item[] }>("/api/gym/audit").then((r) => {
      if (!alive) return;
      if (r.ok && r.data) setItems(r.data.items);
      else setError(r.error ?? "Could not load the activity.");
    });
    return () => {
      alive = false;
    };
  }, []);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!items) return <Card className="p-6 text-center text-sm text-muted">Loading…</Card>;
  return (
    <Card className="divide-y divide-line p-0">
      {items.length === 0 && <div className="p-6 text-center text-sm text-muted">Nothing yet.</div>}
      {items.map((i) => (
        <div key={i.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
          <span>
            <span className="font-semibold">{i.actor}</span> · {LABEL[i.action] ?? i.action}
            {i.detail && <span className="text-muted"> — {i.detail}</span>}
          </span>
          <span className="shrink-0 text-xs text-muted">{format(parseISO(i.at), "d MMM, h:mm a")}</span>
        </div>
      ))}
    </Card>
  );
}
