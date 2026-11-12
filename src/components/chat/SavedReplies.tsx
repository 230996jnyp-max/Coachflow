"use client";

import { Bookmark, Pencil, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Field, Input, Modal, Notice, Textarea } from "@/components/ui";
import { api } from "@/lib/store";
import type { SavedReply } from "@/lib/types";
import { cn } from "@/lib/utils";

/** "Ben" from "Ben Andrew", and "Darsh" from "Coach Darsh (demo owner)". */
export function firstNameOf(full: string): string {
  const parts = full.replace(/\(.*?\)/g, "").trim().split(/\s+/);
  return (/^coach$/i.test(parts[0]) && parts[1] ? parts[1] : parts[0]) || "there";
}

/** Fills {first_name} in a saved reply. */
export const fillReply = (text: string, otherName: string): string => text.replaceAll("{first_name}", firstNameOf(otherName));

/**
 * A coach's saved replies: pick one to drop into the message box (it is not sent until you press send), or add, change and remove them.
 * Kept per coach on the server, so they follow the coach to every device. {first_name} becomes the other person's first name.
 */
export function SavedReplies({ open, onClose, otherName, onPick }: { open: boolean; onClose: () => void; otherName: string; onPick: (text: string) => void }) {
  return open ? <Body onClose={onClose} otherName={otherName} onPick={onPick} /> : null;
}

function Body({ onClose, otherName, onPick }: { onClose: () => void; otherName: string; onPick: (text: string) => void }) {
  const [list, setList] = useState<SavedReply[] | null>(null);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"pick" | "edit">("pick");
  const [editing, setEditing] = useState<SavedReply | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ replies: SavedReply[] }>("/api/replies").then((r) => {
      if (!alive) return;
      if (r.ok && r.data) setList(r.data.replies);
      else setError(r.error ?? "Couldn't load your saved replies.");
    });
    return () => {
      alive = false;
    };
  }, []);

  const shown = useMemo(() => (list ?? []).filter((r) => !q.trim() || `${r.title} ${r.text}`.toLowerCase().includes(q.trim().toLowerCase())), [list, q]);

  const call = async (path: string, init: { method?: string; body?: unknown }) => {
    setBusy(true);
    setError(null);
    const r = await api<{ replies: SavedReply[] }>(path, init);
    setBusy(false);
    if (!r.ok || !r.data) return setError(r.error ?? "That didn't work. Try again."), false;
    setList(r.data.replies);
    return true;
  };

  const startEdit = (r: SavedReply | "new") => {
    setEditing(r);
    setTitle(r === "new" ? "" : r.title);
    setText(r === "new" ? "" : r.text);
    setError(null);
  };

  const save = async () => {
    const body = { title: title.trim(), text: text.trim() };
    const ok = editing === "new" ? await call("/api/replies", { body }) : editing ? await call(`/api/replies/${editing.id}`, { method: "PATCH", body }) : false;
    if (ok) setEditing(null);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "pick" ? "Saved replies" : "Manage saved replies"}
      footer={
        editing ? (
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button disabled={busy || !title.trim() || !text.trim()} onClick={() => void save()}>
              {busy ? "Saving…" : "Save reply"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setMode((m) => (m === "pick" ? "edit" : "pick"))}>
              {mode === "pick" ? (
                <>
                  <Pencil size={14} /> Manage
                </>
              ) : (
                "Back to picking"
              )}
            </Button>
            {mode === "edit" && (
              <Button onClick={() => startEdit("new")} disabled={(list?.length ?? 0) >= 30}>
                <Plus size={16} /> New reply
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </>
        )
      }
    >
      {editing ? (
        <div className="space-y-4">
          <Field label="Title" hint="A short label, so you can find it quickly.">
            <Input value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} placeholder="Well done" autoFocus />
          </Field>
          <Field label="Message" hint="{first_name} becomes the other person's first name.">
            <Textarea value={text} maxLength={500} rows={4} onChange={(e) => setText(e.target.value)} placeholder="Great work today, {first_name}!" />
          </Field>
          <div className="rounded-xl border border-line bg-field/40 p-3 text-sm">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted">Preview for {firstNameOf(otherName)}</div>
            {fillReply(text, otherName) || <span className="text-muted">Type a message above.</span>}
          </div>
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      ) : (
        <div className="space-y-3">
          {list && list.length > 0 && (
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your replies…" className="pl-9" aria-label="Search saved replies" />
            </div>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          {list === null && !error && <p className="py-6 text-center text-sm text-muted">Loading…</p>}
          {list && list.length === 0 && (
            <div className="space-y-3 py-4 text-center">
              <Bookmark size={26} className="mx-auto text-muted" />
              <p className="text-sm text-muted">No saved replies yet. Save the messages you send again and again, and drop them in with one tap.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => void call("/api/replies", { body: { starters: true } })}>
                  <Sparkles size={15} /> Add starter replies
                </Button>
                <Button
                  onClick={() => {
                    setMode("edit");
                    startEdit("new");
                  }}
                >
                  <Plus size={15} /> Write my own
                </Button>
              </div>
            </div>
          )}
          {list && list.length > 0 && shown.length === 0 && <p className="py-4 text-center text-sm text-muted">No reply matches “{q}”.</p>}
          <ul className="space-y-2">
            {shown.map((r) => (
              <li key={r.id} className="flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (mode === "edit") return startEdit(r);
                    onPick(fillReply(r.text, otherName));
                    onClose();
                  }}
                  className={cn("min-w-0 flex-1 rounded-xl border border-line bg-field/50 px-3 py-2.5 text-left hover:border-accent/50")}
                >
                  <div className="text-sm font-bold">{r.title}</div>
                  <div className="line-clamp-2 text-xs text-muted [overflow-wrap:anywhere]">{fillReply(r.text, otherName)}</div>
                </button>
                {mode === "edit" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void call(`/api/replies/${r.id}`, { method: "DELETE" })}
                    aria-label={`Delete ${r.title}`}
                    className="flex w-11 shrink-0 items-center justify-center rounded-xl border border-line text-muted hover:border-danger/50 hover:text-danger disabled:opacity-40"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {mode === "edit" && list && list.length > 0 && <p className="text-xs text-muted">Tap a reply to change it. {list.length} of 30.</p>}
        </div>
      )}
    </Modal>
  );
}
