"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, Notice } from "@/components/ui";
import { api, refreshAccounts, refreshSchedule } from "@/lib/store";

interface Move {
  id: string;
  fromName: string;
  toName: string;
}

/** A client's home: the gym would like to move them to another of its coaches. Nothing changes until the client says yes. */
export function MoveRequests() {
  const [moves, setMoves] = useState<Move[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api<{ moves: Move[] }>("/api/gym/moves").then((r) => {
      if (alive && r.ok && r.data) setMoves(r.data.moves);
    });
    return () => {
      alive = false;
    };
  }, []);

  const answer = async (m: Move, accept: boolean) => {
    setBusy(true);
    const r = await api<{ movedSessions?: number; keptSessions?: number }>(`/api/gym/moves/${m.id}`, { method: "PATCH", body: { accept } });
    setBusy(false);
    if (!r.ok) return setNote(r.error ?? "That didn't work.");
    setMoves((list) => list.filter((x) => x.id !== m.id));
    setNote(accept ? `You are now with ${m.toName}.` : `You are staying with ${m.fromName}.`);
    if (accept) await Promise.all([refreshAccounts(), refreshSchedule()]);
  };

  if (moves.length === 0 && !note) return null;
  return (
    <div className="space-y-2">
      {note && <Notice tone="success">{note}</Notice>}
      {moves.map((m) => (
        <Card key={m.id} className="space-y-3 border-pr/40 p-4">
          <div className="text-sm font-bold">Your coach is changing</div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{m.fromName}</span>
            <ArrowRight size={14} className="text-muted" />
            <span className="font-semibold">{m.toName}</span>
          </div>
          <p className="text-xs text-muted">Your gym would like to move you to {m.toName}. Nothing changes unless you agree. If you do, your upcoming sessions go with you wherever {m.toName} is free.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => void answer(m, true)}>
              Agree
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void answer(m, false)}>
              Stay with {m.fromName}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
