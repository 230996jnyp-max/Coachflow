"use client";

import { format, isSameDay, parseISO } from "date-fns";
import { AlertCircle, ArrowLeft, Bell, Check, Mail, Megaphone, RotateCcw, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar, Button } from "@/components/ui";
import { discardFailed, markRead, sendChat, setActiveThread, showBrowserNotification, useChat, type LocalMessage } from "@/lib/chat";
import { useViewer } from "@/lib/hooks";
import type { ChatRole } from "@/lib/types";
import { cn } from "@/lib/utils";
import { RoleBadge, badgeRole } from "./RoleBadge";

/** One conversation. `thread` is `c:<clientId>` (coach ↔ client) or `o:<coachId>` (owner ↔ coach). */
export function ChatThread({
  thread,
  otherName,
  otherRole,
  onBack,
}: {
  thread: string;
  otherName: string;
  otherRole: ChatRole;
  onBack?: () => void;
}) {
  const { user, db } = useViewer();
  const chat = useChat();
  const messages = chat.messages[thread] ?? [];
  const [text, setText] = useState("");
  const [perm, setPerm] = useState<string>(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    setActiveThread(thread);
    return () => setActiveThread(null);
  }, [thread]);

  useEffect(() => {
    if (messages.length) markRead(thread);
  }, [messages.length, thread]);

  // Keep pinned to the newest message unless the reader scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, thread]);

  if (!user) return null;
  const myRole: ChatRole = user.isOwner ? "OWNER" : user.role === "TRAINER" ? "COACH" : "CLIENT";
  const me = { id: user.id, name: user.name, role: myRole };
  const notifyEmail = db.settings.emailChat !== false;

  const send = () => {
    const body = text.trim();
    if (!body) return;
    stick.current = true;
    setText("");
    void sendChat({ thread, text: body, notifyEmail, me });
  };
  const retry = (m: LocalMessage) => void sendChat({ thread, text: m.text, notifyEmail, me }, m.id);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-center gap-3 border-b border-line px-3 py-2.5">
        {onBack && (
          <button onClick={onBack} aria-label="Back to conversations" className="flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-field md:hidden">
            <ArrowLeft size={20} />
          </button>
        )}
        <Avatar name={otherName} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-bold">{otherName}</span>
            <RoleBadge role={badgeRole(thread, otherRole)} />
          </div>
          <div className="flex items-center gap-1 text-xs text-muted">
            <Mail size={11} /> {notifyEmail ? "Email notifications on" : "Email notifications off"}
            {!chat.online && <span className="ml-2 text-danger">· offline, retrying…</span>}
          </div>
        </div>
        {perm === "default" && (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              const r = await Notification.requestPermission();
              setPerm(r);
              if (r === "granted") showBrowserNotification("Notifications enabled", "You will be alerted about new messages.", "enabled");
            }}
          >
            <Bell size={14} /> Enable alerts
          </Button>
        )}
      </div>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-4"
      >
        {!chat.loaded && <div className="py-10 text-center text-sm text-muted">Loading messages…</div>}
        {chat.loaded && messages.length === 0 && <div className="py-10 text-center text-sm text-muted">No messages yet. Say hi to {otherName.split(" ")[0]} 👋</div>}
        {messages.map((m, i) => {
          const mine = m.fromId === user.id;
          const prev = messages[i - 1];
          const newDay = !prev || !isSameDay(parseISO(prev.createdAt), parseISO(m.createdAt));
          const grouped = prev && prev.fromId === m.fromId && !newDay;
          return (
            <div key={m.id}>
              {newDay && (
                <div className="my-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {isSameDay(parseISO(m.createdAt), new Date()) ? "Today" : format(parseISO(m.createdAt), "EEE d MMM")}
                </div>
              )}
              {!mine && !grouped && (
                <div className="mb-0.5 mt-2 flex items-center gap-1.5 pl-1 text-[11px] text-muted">
                  <span className="font-semibold text-ink">{m.fromName}</span>
                  <RoleBadge role={badgeRole(thread, m.fromRole)} />
                </div>
              )}
              <div className={cn("flex", mine ? "justify-end" : "justify-start", grouped ? "mt-0.5" : mine ? "mt-2" : "")}>
                <div className={cn("max-w-[82%] rounded-2xl px-3.5 py-2 text-sm", mine ? "rounded-br-md bg-accent text-white" : "rounded-bl-md bg-field text-ink", m.pending && "opacity-60")}>
                  {m.broadcast && (
                    <div className={cn("mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider", mine ? "text-white/80" : "text-pr")}>
                      <Megaphone size={10} /> Announcement
                    </div>
                  )}
                  <div className="whitespace-pre-wrap break-words">{m.text}</div>
                  <div className={cn("mt-1 flex items-center justify-end gap-1.5 text-[10px]", mine ? "text-white/70" : "text-muted")}>
                    {format(parseISO(m.createdAt), "h:mm a")}
                    {mine && !m.pending && !m.failed && <Check size={11} />}
                  </div>
                </div>
              </div>
              {mine && (m.failed || m.pending || m.email) && (
                <div className="mt-0.5 flex justify-end">
                  {m.failed ? (
                    <span className="flex items-center gap-2 text-[11px] text-danger">
                      <AlertCircle size={12} /> Not sent
                      <button onClick={() => retry(m)} className="inline-flex items-center gap-1 font-semibold underline">
                        <RotateCcw size={11} /> Retry
                      </button>
                      <button onClick={() => discardFailed(thread, m.id)} className="font-semibold underline">
                        Discard
                      </button>
                    </span>
                  ) : m.pending ? (
                    <span className="text-[11px] text-muted">Sending…</span>
                  ) : (
                    m.email && m.email.status !== "off" && <EmailStatus email={m.email} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <form
        className="flex items-end gap-2 border-t border-line p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder={`Message ${otherName.split(" ")[0]}…`}
          aria-label="Message"
          className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-line bg-field px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
        <Button type="submit" disabled={!text.trim()} aria-label="Send message" className="h-11 w-11 shrink-0 !px-0">
          <Send size={18} />
        </Button>
      </form>
    </div>
  );
}

function EmailStatus({ email }: { email: NonNullable<LocalMessage["email"]> }) {
  if (email.status === "sent")
    return (
      <span className="flex items-center gap-1 text-[11px] text-success">
        <Mail size={11} /> Email notification sent
      </span>
    );
  if (email.status === "preview")
    return (
      <span className="flex items-center gap-1 text-[11px] text-pr" title="Email delivery is not configured on the server.">
        <Mail size={11} /> Email preview only — delivery not set up
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-[11px] text-danger" title={email.error}>
      <Mail size={11} /> Email failed{email.error ? `: ${email.error.slice(0, 60)}` : ""}
    </span>
  );
}
