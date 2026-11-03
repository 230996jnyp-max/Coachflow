"use client";

import { useState } from "react";
import { Avatar, Button, Input, Modal, Notice } from "@/components/ui";
import type { FloorSession } from "@/lib/floor";
import { useViewer } from "@/lib/hooks";
import { addWalkIn } from "@/lib/store";

/** Gym floor: add another of the coach's clients to the session on the spot. They use one of their group credits like anyone booked in advance. */
export function WalkInModal({ session, onClose }: { session: FloorSession; onClose: () => void }) {
  const { clients } = useViewer();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inSession = new Set(session.participants.map((p) => p.clientId));
  const list = clients
    .filter((c) => !c.profile.archived && !inSession.has(c.user.id) && c.user.name.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 40);

  const add = async (clientId: string) => {
    setBusy(clientId);
    setError(null);
    const r = await addWalkIn(session.groupId ? { groupId: session.groupId } : { bookingId: session.bookingId }, clientId);
    setBusy(null);
    if ("error" in r) setError(r.error);
    else onClose();
  };

  return (
    <Modal open onClose={onClose} title="Add a client to this session">
      {!session.groupId && <p className="mb-3 text-xs text-muted">This 1-on-1 becomes a partner session. The new person, and the person already booked, each use one group credit.</p>}
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your clients…" autoFocus className="mb-3" />
      {error && (
        <div className="mb-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <div className="space-y-1.5">
        {list.map(({ user, profile }) => (
          <div key={user.id} className="flex items-center gap-3 rounded-xl border border-line p-2.5">
            <Avatar name={user.name} size={34} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{user.name}</div>
              <div className="text-xs text-muted">{profile.groupClassCredits ?? 0} group credit{(profile.groupClassCredits ?? 0) === 1 ? "" : "s"}</div>
            </div>
            <Button size="sm" onClick={() => add(user.id)} disabled={busy !== null}>
              {busy === user.id ? "Adding…" : "Add"}
            </Button>
          </div>
        ))}
        {list.length === 0 && <p className="py-6 text-center text-sm text-muted">No other clients to add.</p>}
      </div>
    </Modal>
  );
}
