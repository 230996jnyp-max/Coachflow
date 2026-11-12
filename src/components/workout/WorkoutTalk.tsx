"use client";

import { formatDistanceToNowStrict, parseISO } from "date-fns";
import { Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Notice, Textarea } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { api } from "@/lib/store";
import { WORKOUT_EMOJIS, type WorkoutEmoji, type WorkoutTalk as Talk } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Reactions (👍 🔥) and comments under a finished workout, between the client and their coach. Hidden for someone training without
 * a coach (there is nobody to talk to). Refreshes every half minute while the screen is open.
 */
export function WorkoutTalk({ workoutId }: { workoutId: string }) {
  const { user, isTrainer } = useViewer();
  const [talk, setTalk] = useState<Talk | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<Talk>(`/api/talk/${workoutId}`);
    if (r.ok && r.data) {
      setTalk(r.data);
      setError(null);
    } else if (r.status !== 404) setError(r.error ?? "Couldn't load the comments.");
  }, [workoutId]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  if (!user || (talk && !talk.canTalk)) return null;

  const react = async (emoji: WorkoutEmoji) => {
    const r = await api<Talk>(`/api/talk/${workoutId}`, { method: "PUT", body: { emoji } });
    if (r.ok && r.data) setTalk(r.data);
    else setError(r.error ?? "Couldn't save your reaction.");
  };

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setError(null);
    const r = await api<Talk>(`/api/talk/${workoutId}`, { body: { text: t } });
    setBusy(false);
    if (!r.ok || !r.data) return setError(r.error ?? "Couldn't post your comment.");
    setTalk(r.data);
    setText("");
  };

  const remove = async (id: string) => {
    const r = await api<Talk>(`/api/talk/${workoutId}?comment=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (r.ok && r.data) setTalk(r.data);
    else setError(r.error ?? "Couldn't remove the comment.");
  };

  return (
    <Card className="space-y-4 p-4" data-tour="workout-talk">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">Reactions &amp; comments{talk && talk.comments.length > 0 ? ` (${talk.comments.length})` : ""}</h3>
        <div className="flex gap-2">
          {WORKOUT_EMOJIS.map((emoji) => {
            const r = talk?.reactions.find((x) => x.emoji === emoji);
            return (
              <button
                key={emoji}
                type="button"
                aria-pressed={!!r?.mine}
                aria-label={`${emoji} reaction${r?.count ? `, ${r.count}` : ""}${r?.mine ? ", you reacted" : ""}`}
                title={r?.names.length ? r.names.join(", ") : emoji === "🔥" ? "Fire" : "Thumbs up"}
                onClick={() => void react(emoji)}
                disabled={!talk}
                className={cn(
                  "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors disabled:opacity-50",
                  r?.mine ? "border-accent bg-accent/15 text-accent" : "border-line bg-field text-muted hover:text-ink",
                )}
              >
                <span className="text-base">{emoji}</span>
                {!!r?.count && <span className="tabular-nums">{r.count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {talk && talk.comments.length === 0 && <p className="text-sm text-muted">{isTrainer ? "Say well done, or ask how it felt. Your client gets a notification." : "No comments yet. Your coach will see anything you write here."}</p>}

      {talk && talk.comments.length > 0 && (
        <ul className="space-y-3">
          {talk.comments.map((c) => {
            const mine = c.authorId === user.id;
            return (
              <li key={c.id} className={cn("flex gap-2", mine && "flex-row-reverse")}>
                <div className={cn("min-w-0 max-w-[85%] rounded-2xl border px-3 py-2", mine ? "border-accent/40 bg-accent/10" : "border-line bg-field/50")}>
                  <div className="mb-0.5 flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-bold">{mine ? "You" : c.authorName}</span>
                    <Badge className={c.authorRole === "COACH" ? "border-accent/30 bg-accent/15 text-accent" : undefined}>{c.authorRole === "COACH" ? "Coach" : "Client"}</Badge>
                    <span className="text-muted">{formatDistanceToNowStrict(parseISO(c.createdAt), { addSuffix: true })}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{c.text}</p>
                </div>
                {(mine || isTrainer) && (
                  <button type="button" onClick={() => void remove(c.id)} aria-label="Remove comment" className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center self-start rounded-lg text-muted hover:bg-field hover:text-danger">
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-2">
        <Textarea
          value={text}
          maxLength={1000}
          rows={2}
          aria-label="Add a comment"
          placeholder={isTrainer ? "Great work. How did the last set feel?" : "Reply to your coach, or tell them how it went…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted">Only you and {isTrainer ? "your client" : "your coach"} can see this.</span>
          <Button size="sm" disabled={busy || !text.trim() || !talk} onClick={() => void send()}>
            <Send size={14} /> {busy ? "Posting…" : "Post"}
          </Button>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </Card>
  );
}
