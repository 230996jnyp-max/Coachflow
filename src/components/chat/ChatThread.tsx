"use client";

import { format, isSameDay, parseISO } from "date-fns";
import { AlertCircle, ArrowLeft, Bell, Bookmark, Check, Mail, Megaphone, PanelRight, RotateCcw, Send } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Avatar, Button, Modal } from "@/components/ui";
import { discardFailed, markRead, sendChat, setActiveThread, showBrowserNotification, useChat, type LocalMessage } from "@/lib/chat";
import { useViewer } from "@/lib/hooks";
import type { ChatRole } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ClientSidePanel } from "./ClientSidePanel";
import { RoleBadge, badgeRole } from "./RoleBadge";
import { SavedReplies } from "./SavedReplies";

/** Wide enough to keep the client panel next to the chat; below this it opens as a sheet instead. */
const WIDE = "(min-width: 1440px)";
const watchWide = (cb: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const useWide = () => useSyncExternalStore(watchWide, () => window.matchMedia(WIDE).matches, () => false);

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
  const [replies, setReplies] = useState(false);
  const [panel, setPanel] = useState<boolean | null>(null);
  const wide = useWide();
  const box = useRef<HTMLTextAreaElement>(null);
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
  const staff = myRole !== "CLIENT";
  // Coaches see a side panel on a client's conversation (not on the owner <-> coach one).
  const panelClient = staff && thread.startsWith("c:") ? thread.slice(2) : null;
  const panelOpen = panelClient !== null && (panel ?? wide);

  // A saved reply is dropped into the box (after anything already typed) and left for the coach to read and send.
  const insertReply = (picked: string) => {
    setText((t) => (t.trim() ? `${t.trimEnd()} ${picked}` : picked).slice(0, 2000));
    setTimeout(() => box.current?.focus(), 0);
  };

  const send = () => {
    const body = text.trim();
    if (!body) return;
    stick.current = true;
    setText("");
    void sendChat({ thread, text: body, notifyEmail, me });
  };
  const retry = (m: LocalMessage) => void sendChat({ thread, text: m.text, notifyEmail, me }, m.id);

  return (
    <div className="flex h-full min-h-0 gap-3">
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface">
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
          {panelClient && (
            <button
              type="button"
              onClick={() => setPanel(!panelOpen)}
              aria-pressed={panelOpen}
              aria-label={panelOpen ? "Hide client details" : "Show client details"}
              title={panelOpen ? "Hide client details" : "Show client details"}
              className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-field hover:text-ink", panelOpen && "bg-field text-ink")}
            >
              <PanelRight size={19} />
            </button>
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
                  <div className={cn("max-w-[82%] rounded-2xl px-3.5 py-2 text-sm", mine ? "rounded-br-md bg-accent text-on-accent" : "rounded-bl-md bg-field text-ink", m.pending && "opacity-60")}>
                    {m.broadcast && (
                      <div className={cn("mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider", mine ? "text-on-accent/80" : "text-pr")}>
                        <Megaphone size={10} /> Announcement
                      </div>
                    )}
                    <div className="whitespace-pre-wrap break-words">{m.text}</div>
                    <div className={cn("mt-1 flex items-center justify-end gap-1.5 text-[10px]", mine ? "text-on-accent/70" : "text-muted")}>
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
          {staff && (
            <button
              type="button"
              onClick={() => setReplies(true)}
              aria-label="Saved replies"
              title="Saved replies"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-muted hover:border-accent/50 hover:text-ink"
            >
              <Bookmark size={18} />
            </button>
          )}
          <textarea
            ref={box}
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
        {staff && <SavedReplies open={replies} onClose={() => setReplies(false)} otherName={otherName} onPick={insertReply} />}
      </div>
    {panelClient && panelOpen && wide && (
      <aside aria-label="Client details" className="hidden w-[320px] shrink-0 overflow-y-auto rounded-2xl border border-line bg-surface min-[1440px]:block">
        <ClientSidePanel clientId={panelClient} />
      </aside>
    )}
    {panelClient && panelOpen && !wide && (
      <Modal open onClose={() => setPanel(false)} title="Client details">
        <div className="-mx-5 -my-4">
          <ClientSidePanel clientId={panelClient} />
        </div>
      </Modal>
    )}
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
