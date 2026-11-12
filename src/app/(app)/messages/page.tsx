"use client";

import { format, isSameDay, parseISO } from "date-fns";
import { Megaphone, MessageCircle, Search, X } from "lucide-react";
import { useState } from "react";
import { ChatThread } from "@/components/chat/ChatThread";
import { RoleBadge } from "@/components/chat/RoleBadge";
import { BroadcastModal } from "@/components/chat/BroadcastModal";
import { Avatar, Button, EmptyState } from "@/components/ui";
import { clientThread, coachThread, takeRequestedThread, unreadFor, useChat } from "@/lib/chat";
import { useViewer } from "@/lib/hooks";
import type { ChatRole } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Row {
  thread: string;
  name: string;
  role: ChatRole;
  section: "owner" | "coaches" | "clients";
}

export default function MessagesPage() {
  const { user, isTrainer, clients, coach, owner, coaches } = useViewer();
  const chat = useChat();
  const [selected, setSelected] = useState<string | null>(() => takeRequestedThread());
  const [broadcast, setBroadcast] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "team">("all");

  if (!user) return null;

  // Client: a single conversation with their coach.
  if (!isTrainer) {
    return (
      <div className="h-[calc(100dvh-12rem)] md:h-[calc(100dvh-5rem)]">
        {coach ? (
          <ChatThread thread={clientThread(user.id)} otherName={coach.name} otherRole="COACH" />
        ) : (
          <EmptyState title="No coach assigned yet" hint="Ask your coach to check your account." />
        )}
      </div>
    );
  }

  const rows: Row[] = [];
  if (!user.isOwner && owner) rows.push({ thread: coachThread(user.id), name: owner.name, role: "OWNER", section: "owner" });
  if (user.isOwner) for (const c of coaches) rows.push({ thread: coachThread(c.id), name: c.name, role: "COACH", section: "coaches" });
  for (const c of clients.filter((x) => !x.profile.archived)) rows.push({ thread: clientThread(c.user.id), name: c.user.name, role: "CLIENT", section: "clients" });

  const meta = (thread: string) => {
    const list = chat.messages[thread] ?? [];
    return { last: list[list.length - 1], unread: unreadFor(chat, user.id, thread) };
  };
  const sorted = [...rows].sort((a, b) => {
    const order = { owner: 0, coaches: 1, clients: 2 } as const;
    if (a.section !== b.section) return order[a.section] - order[b.section];
    return (meta(b.thread).last?.createdAt ?? "").localeCompare(meta(a.thread).last?.createdAt ?? "") || a.name.localeCompare(b.name);
  });
  const active = sorted.find((r) => r.thread === selected) ?? null;
  const titles = { owner: "App Owner", coaches: "Coaches", clients: "Clients" } as const;

  // Search by name or by what was last said; the chips narrow it to unread conversations or the coaching team.
  const unreadTotal = sorted.reduce((n, r) => n + (meta(r.thread).unread > 0 ? 1 : 0), 0);
  const hasTeam = sorted.some((r) => r.section !== "clients");
  const needle = q.trim().toLowerCase();
  const visible = sorted.filter((r) => {
    if (filter === "unread" && meta(r.thread).unread === 0 && r.thread !== active?.thread) return false;
    if (filter === "team" && r.section === "clients") return false;
    if (!needle) return true;
    return r.name.toLowerCase().includes(needle) || (meta(r.thread).last?.text ?? "").toLowerCase().includes(needle);
  });
  const chips: { id: typeof filter; label: string; count?: number }[] = [
    { id: "all", label: "All" },
    { id: "unread", label: "Unread", count: unreadTotal },
    ...(hasTeam ? [{ id: "team" as const, label: "Team" }] : []),
  ];

  return (
    <div className="h-[calc(100dvh-12rem)] md:h-[calc(100dvh-5rem)]">
      <div className="grid h-full min-h-0 gap-4 md:grid-cols-[320px_1fr]">
        <aside className={cn("min-h-0 overflow-y-auto rounded-2xl border border-line bg-surface", active && "hidden md:block")}>
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <span className="text-sm font-bold">Messages</span>
            {user.isOwner && coaches.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setBroadcast(true)}>
                <Megaphone size={14} /> Announce
              </Button>
            )}
          </div>
          {sorted.length > 0 && (
            <div className="space-y-2 border-b border-line px-3 py-2.5">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search people or messages"
                  aria-label="Search conversations"
                  className="h-10 w-full rounded-xl border border-line bg-field pl-9 pr-9 text-sm outline-none focus:border-accent"
                />
                {q && (
                  <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:text-ink">
                    <X size={14} />
                  </button>
                )}
              </div>
              <div className="flex gap-1.5" role="group" aria-label="Filter conversations">
                {chips.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setFilter(c.id)}
                    aria-pressed={filter === c.id}
                    className={cn(
                      "flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold",
                      filter === c.id ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-ink",
                    )}
                  >
                    {c.label}
                    {c.count ? <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-on-accent">{c.count}</span> : null}
                  </button>
                ))}
              </div>
            </div>
          )}
          {sorted.length === 0 && <div className="p-6 text-center text-sm text-muted">Add a client to start chatting.</div>}
          {sorted.length > 0 && visible.length === 0 && (
            <div className="p-6 text-center text-sm text-muted">
              {needle ? `Nothing matches “${q.trim()}”.` : filter === "unread" ? "You're all caught up. No unread messages." : "No conversations here."}
            </div>
          )}
          {(["owner", "coaches", "clients"] as const).map((section) => {
            const items = visible.filter((r) => r.section === section);
            if (items.length === 0) return null;
            return (
              <div key={section}>
                <div className="bg-field/50 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">{titles[section]}</div>
                <ul className="divide-y divide-line">
                  {items.map((r) => {
                    const { last, unread } = meta(r.thread);
                    return (
                      <li key={r.thread}>
                        <button onClick={() => setSelected(r.thread)} className={cn("flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-field/60", active?.thread === r.thread && "bg-accent/10")}>
                          <Avatar name={r.name} size={42} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className={cn("truncate text-sm", unread ? "font-bold" : "font-semibold")}>{r.name}</span>
                                <RoleBadge role={r.role} />
                              </span>
                              {last && (
                                <span className="shrink-0 text-[11px] text-muted">
                                  {isSameDay(parseISO(last.createdAt), new Date()) ? format(parseISO(last.createdAt), "h:mm a") : format(parseISO(last.createdAt), "d MMM")}
                                </span>
                              )}
                            </div>
                            <div className={cn("truncate text-xs", unread ? "text-ink" : "text-muted")}>{last ? `${last.fromId === user.id ? "You: " : ""}${last.text}` : "No messages yet"}</div>
                          </div>
                          {unread > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-on-accent">{unread}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </aside>

        <section className={cn("min-h-0", !active && "hidden md:block")}>
          {active ? (
            <ChatThread key={active.thread} thread={active.thread} otherName={active.name} otherRole={active.role} onBack={() => setSelected(null)} />
          ) : (
            <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-line">
              <EmptyState icon={<MessageCircle size={28} />} title="Select a conversation" hint="Pick someone on the left to read and reply." />
            </div>
          )}
        </section>
      </div>
      <BroadcastModal open={broadcast} onClose={() => setBroadcast(false)} count={coaches.length} />
    </div>
  );
}
