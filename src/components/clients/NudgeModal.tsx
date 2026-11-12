"use client";

import { format, parseISO } from "date-fns";
import { Send } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar, Button, Modal, Notice, Textarea } from "@/components/ui";
import { nudgeLists, type ClientStatus } from "@/lib/attention";
import { useViewer } from "@/lib/hooks";
import { api } from "@/lib/store";
import { useStatuses } from "./status";

const PRESETS = {
  missed: "Hi {first_name}, I noticed the workout I set for you wasn't done. No stress. Want me to move it to a day that suits you better?",
  noShow: "Hi {first_name}, I noticed we missed a session recently. Is everything okay? Let me know if you'd like to rebook or change your plan.",
  behind: "Hi {first_name}, quick check-in: you're a little behind on this week's sessions. Can we fit one in? Happy to help find a time that works.",
  quiet: "Hi {first_name}, it's been a little while since your last session. How are you feeling? Let me know if you'd like to get back on track. I'm here to help.",
} as const;

type SectionKey = keyof typeof PRESETS;

/**
 * "Missed and at risk": clients who skipped a session in the last 7 days, are behind this week's target, or have gone quiet. The coach
 * ticks who to nudge and edits one short message. {first_name} is filled in for each person and every client gets it privately in their
 * own chat (never a group message). Nothing is sent until the coach presses Send.
 */
export function NudgeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Mounted only while open, so every visit starts clean (nothing ticked, nothing typed).
  return open ? <NudgeBody onClose={onClose} /> : null;
}

function NudgeBody({ onClose }: { onClose: () => void }) {
  const { clients } = useViewer();
  const statuses = useStatuses();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [text, setText] = useState<string>(PRESETS.noShow);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ sent: number; skipped: string[] } | null>(null);

  const nameOf = (id: string) => clients.find((c) => c.user.id === id)?.user.name ?? "Client";
  const lists = useMemo(() => nudgeLists([...statuses.values()]), [statuses]);

  const sections: { key: SectionKey; title: string; hint: string; rows: ClientStatus[] }[] = [
    { key: "noShow", title: "Missed a session (last 7 days)", hint: "Marked as a no-show", rows: lists.noShow },
    { key: "missed", title: "Missed an assigned workout", hint: "A workout you assigned in the last 7 days wasn't done", rows: lists.missed },
    { key: "behind", title: "Behind this week", hint: "Needs every remaining day to reach the target", rows: lists.behind },
    { key: "quiet", title: "Quiet for 7+ days", hint: "Nothing logged or attended", rows: lists.quiet },
  ];

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const selectSection = (key: SectionKey, rows: ClientStatus[]) => {
    setPicked((p) => {
      const n = new Set(p);
      const all = rows.every((r) => n.has(r.clientId));
      for (const r of rows) {
        if (all) n.delete(r.clientId);
        else n.add(r.clientId);
      }
      return n;
    });
    if (!touched) setText(PRESETS[key]);
  };

  const first = [...picked][0];
  const firstName = (id: string) => nameOf(id).split(" ")[0] || "there";
  const preview = text.replaceAll("{first_name}", first ? firstName(first) : "Alex");
  const total = sections.reduce((n, s) => n + s.rows.length, 0);

  const send = async () => {
    setBusy(true);
    setError(null);
    const r = await api<{ sent: number; skipped: { clientId: string; reason: string }[] }>("/api/chat/nudge", { body: { clientIds: [...picked], text } });
    setBusy(false);
    if (!r.ok || !r.data) return setError(r.error ?? "Couldn't send the nudge. Try again.");
    setResult({ sent: r.data.sent, skipped: r.data.skipped.map((s) => `${nameOf(s.clientId)} (${s.reason})`) });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Nudge clients"
      wide
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy || picked.size === 0 || !text.trim()} onClick={() => void send()}>
              <Send size={16} /> {busy ? "Sending…" : picked.size ? `Send to ${picked.size}` : "Send"}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <Notice tone={result.sent ? "success" : "warn"}>
            {result.sent ? `Sent to ${result.sent} ${result.sent === 1 ? "client" : "clients"}, each in their own chat with you.` : "Nothing was sent."}
          </Notice>
          {result.skipped.length > 0 && <Notice tone="info">Skipped: {result.skipped.join(", ")}.</Notice>}
        </div>
      ) : total === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No one missed a session, is behind, or has gone quiet. Nice work.</p>
      ) : (
        <div className="space-y-5">
          {sections.map((s) =>
            s.rows.length === 0 ? null : (
              <section key={s.key}>
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold">
                      {s.title} <span className="text-muted">({s.rows.length})</span>
                    </div>
                    <div className="text-xs text-muted">{s.hint}</div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => selectSection(s.key, s.rows)}>
                    {s.rows.every((r) => picked.has(r.clientId)) ? "Clear" : "Select all"}
                  </Button>
                </div>
                <ul className="space-y-1.5">
                  {s.rows.map((r) => (
                    <li key={r.clientId}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line bg-field/40 px-3 py-2 hover:border-accent/50">
                        <input type="checkbox" className="h-5 w-5 accent-accent" checked={picked.has(r.clientId)} onChange={() => toggle(r.clientId)} />
                        <Avatar name={nameOf(r.clientId)} size={30} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{nameOf(r.clientId)}</span>
                          <span className="block truncate text-xs text-muted">
                            {s.key === "noShow" && r.noShows[0] ? `${r.noShows[0].what} on ${format(r.noShows[0].at, "EEE d MMM")}` : s.key === "missed" && r.missedAssigned[0] ? `${r.missedAssigned[0].title}, ${format(parseISO(r.missedAssigned[0].date), "EEE d MMM")}` : s.key === "behind" ? `${r.weekDone} of ${r.target} this week` : r.daysQuiet === null ? "Nothing logged yet" : `${r.daysQuiet} days since last session`}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            ),
          )}

          <section className="space-y-2">
            <div className="text-sm font-bold">Your message</div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(PRESETS) as SectionKey[]).map((k) => (
                <Button
                  key={k}
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setText(PRESETS[k]);
                    setTouched(true);
                  }}
                >
                  {k === "noShow" ? "Missed a session" : k === "missed" ? "Missed a workout" : k === "behind" ? "Behind this week" : "Gone quiet"}
                </Button>
              ))}
            </div>
            <Textarea
              value={text}
              maxLength={600}
              rows={4}
              aria-label="Nudge message"
              onChange={(e) => {
                setText(e.target.value);
                setTouched(true);
              }}
            />
            <p className="text-xs text-muted">
              {"{first_name}"} becomes each person&apos;s first name. Everyone gets it privately in their own chat with you. No email is sent.
            </p>
            {first && (
              <div className="rounded-xl border border-line bg-field/40 p-3 text-sm">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted">Preview for {nameOf(first)}</div>
                {preview}
              </div>
            )}
          </section>
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      )}
    </Modal>
  );
}
