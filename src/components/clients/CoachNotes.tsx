"use client";

import { format, parseISO } from "date-fns";
import { Lock, NotebookPen, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, ConfirmDialog, Notice, Textarea } from "@/components/ui";
import { api } from "@/lib/store";
import type { ClientNote } from "@/lib/types";

/** Private, dated notes a coach keeps about a client ("travelling for 2 weeks"). The client never sees them. */
export function CoachNotes({ clientId }: { clientId: string }) {
  const [notes, setNotes] = useState<ClientNote[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ClientNote | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ notes: ClientNote[] }>(`/api/clients/${clientId}/notes`).then((r) => {
      if (!alive) return;
      if (r.ok && r.data) setNotes(r.data.notes);
      else setError(r.error ?? "Couldn't load notes.");
    });
    return () => {
      alive = false;
    };
  }, [clientId]);

  const add = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setError(null);
    const r = await api<{ notes: ClientNote[] }>(`/api/clients/${clientId}/notes`, { body: { text: t } });
    setBusy(false);
    if (!r.ok || !r.data) return setError(r.error ?? "Couldn't save the note.");
    setNotes(r.data.notes);
    setText("");
  };

  const remove = async (n: ClientNote) => {
    const r = await api<{ notes: ClientNote[] }>(`/api/clients/${clientId}/notes?note=${encodeURIComponent(n.id)}`, { method: "DELETE" });
    if (!r.ok || !r.data) return setError(r.error ?? "Couldn't remove the note.");
    setNotes(r.data.notes);
  };

  return (
    <Card className="space-y-3 p-4" data-tour="coach-notes">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted">
          <NotebookPen size={14} /> Coach notes
        </h3>
        <span className="inline-flex items-center gap-1 text-[11px] text-muted">
          <Lock size={11} /> Only you
        </span>
      </div>

      <div className="space-y-2">
        <Textarea value={text} maxLength={1000} rows={2} aria-label="New coach note" placeholder="Travelling for 2 weeks · prefers mornings · left knee sore…" onChange={(e) => setText(e.target.value)} />
        <div className="flex justify-end">
          <Button size="sm" disabled={busy || !text.trim()} onClick={() => void add()}>
            {busy ? "Saving…" : "Add note"}
          </Button>
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {notes === null && !error ? (
        <p className="text-xs text-muted">Loading…</p>
      ) : notes && notes.length === 0 ? (
        <p className="text-xs text-muted">No notes yet. Anything you jot down here stays private to you.</p>
      ) : (
        <ul className="space-y-2">
          {notes?.map((n) => (
            <li key={n.id} className="group flex items-start gap-2 rounded-xl border border-line bg-field/40 p-2.5">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{n.text}</p>
                <div className="mt-0.5 text-[11px] text-muted">{format(parseISO(n.createdAt), "d MMM yyyy, h:mm a")}</div>
              </div>
              <button type="button" onClick={() => setRemoving(n)} aria-label="Remove note" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-field hover:text-danger">
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog open={!!removing} danger title="Remove this note?" message="It will be deleted for good." confirmLabel="Remove" onClose={() => setRemoving(null)} onConfirm={() => removing && void remove(removing)} />
    </Card>
  );
}
