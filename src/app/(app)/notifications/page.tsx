"use client";

import { format, formatDistanceToNowStrict, isToday, isYesterday, parseISO } from "date-fns";
import { Apple, Bell, CalendarDays, CheckCheck, Dumbbell, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApprovalCard } from "@/components/groups/groupUi";
import { Button, Card, EmptyState, PageHeader, Segmented, Select, Tabs } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { api, markNotificationsRead } from "@/lib/store";
import { CATEGORY_LABEL, CATEGORY_ORDER, categoryOf, type NoteCategory } from "@/lib/notifyKinds";
import type { AppNotification } from "@/lib/types";
import { cn } from "@/lib/utils";

const PAGE = 100;

const ICON: Record<NoteCategory, ReactNode> = {
  booking: <CalendarDays size={16} />,
  class: <Users size={16} />,
  training: <Dumbbell size={16} />,
  nutrition: <Apple size={16} />,
  clients: <UserPlus size={16} />,
  other: <Bell size={16} />,
};

type Tab = "all" | NoteCategory;

/** Everything that happened, sorted into tabs (bookings, classes, training, nutrition, clients) with "unread only" and a client filter. */
export default function NotificationsPage() {
  const { db, isTrainer } = useViewer();
  const [list, setList] = useState<AppNotification[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [unreadOnly, setUnreadOnly] = useState<"all" | "unread">("all");
  const [client, setClient] = useState("");

  const load = useCallback(async (before?: string) => {
    const r = await api<{ notifications: AppNotification[] }>(`/api/notifications?limit=${PAGE}${before ? `&before=${encodeURIComponent(before)}` : ""}`);
    if (!r.ok || !r.data) {
      setError(r.error ?? "Couldn't load your notifications.");
      setLoaded(true);
      return;
    }
    const got = r.data.notifications;
    setError(null);
    setMore(got.length === PAGE);
    setList((cur) => (before ? [...cur, ...got.filter((g) => !cur.some((c) => c.id === g.id))] : got));
    setLoaded(true);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const toAnswer = db.groupRequests.filter((r) => r.needsMe);
  const unread = list.filter((n) => !n.read).length;

  const clientOptions = useMemo(() => {
    const ids = [...new Set(list.map((n) => n.about).filter((x): x is string => !!x))];
    return ids.map((id) => ({ id, name: db.users.find((u) => u.id === id)?.name ?? "Former client" })).sort((a, b) => a.name.localeCompare(b.name));
  }, [list, db.users]);

  const inTab = useMemo(() => list.filter((n) => tab === "all" || categoryOf(n.kind) === tab), [list, tab]);
  const shown = useMemo(() => inTab.filter((n) => (unreadOnly === "all" || !n.read) && (!client || n.about === client)), [inTab, unreadOnly, client]);

  const counts = useMemo(() => {
    const c: Record<string, { total: number; unread: number }> = { all: { total: 0, unread: 0 } };
    for (const n of list) {
      const k = categoryOf(n.kind);
      c[k] ??= { total: 0, unread: 0 };
      c[k].total++;
      c.all.total++;
      if (!n.read) {
        c[k].unread++;
        c.all.unread++;
      }
    }
    return c;
  }, [list]);

  const tabs = useMemo(() => {
    const label = (key: Tab, text: string) => {
      const u = counts[key]?.unread ?? 0;
      return u ? `${text} · ${u}` : text;
    };
    return [{ value: "all" as Tab, label: label("all", "All") }, ...CATEGORY_ORDER.filter((c) => (counts[c]?.total ?? 0) > 0).map((c) => ({ value: c as Tab, label: label(c, CATEGORY_LABEL[c]) }))];
  }, [counts]);

  const markRead = async (ids: string[] | "all") => {
    setList((cur) => cur.map((n) => (ids === "all" || ids.includes(n.id) ? { ...n, read: true } : n)));
    await markNotificationsRead(ids);
  };

  // Newest first, grouped under Today / Yesterday / the date.
  const groups = useMemo(() => {
    const out: { label: string; items: AppNotification[] }[] = [];
    for (const n of shown) {
      const d = parseISO(n.createdAt);
      const label = isToday(d) ? "Today" : isYesterday(d) ? "Yesterday" : format(d, "EEE d MMM yyyy");
      const g = out[out.length - 1];
      if (g && g.label === label) g.items.push(n);
      else out.push({ label, items: [n] });
    }
    return out;
  }, [shown]);

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle={loaded ? (unread ? `${unread} unread` : "You're all caught up") : "Loading…"}
        actions={
          unread > 0 ? (
            <Button variant="secondary" onClick={() => void markRead("all")}>
              <CheckCheck size={16} /> Mark all read
            </Button>
          ) : undefined
        }
      />

      {toAnswer.length > 0 && (
        <section className="mb-5 space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-muted">Waiting for your answer</div>
          {toAnswer.map((r) => (
            <ApprovalCard key={r.id} req={r} group={db.groups.find((g) => g.id === r.groupId)} />
          ))}
        </section>
      )}

      <Tabs value={tab} onChange={setTab} tabs={tabs} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={unreadOnly}
          onChange={setUnreadOnly}
          options={[
            { value: "all", label: "All" },
            { value: "unread", label: unread ? `Unread · ${unread}` : "Unread" },
          ]}
        />
        {isTrainer && clientOptions.length > 0 && (
          <div className="min-w-[180px]">
            <Select value={client} onChange={(e) => setClient(e.target.value)} aria-label="Filter by client">
              <option value="">All clients</option>
              {clientOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {error && (
        <Card className="mb-4 border-danger/30 p-4 text-sm text-danger">
          {error}{" "}
          <button type="button" className="font-semibold underline" onClick={() => void load()}>
            Try again
          </button>
        </Card>
      )}

      {loaded && !error && shown.length === 0 ? (
        <EmptyState
          icon={<Bell size={28} />}
          title={list.length === 0 ? "Nothing here yet" : "Nothing matches these filters"}
          hint={list.length === 0 ? "Bookings, class changes, workouts, food diary comments and new client requests will show up here." : "Try another tab, or turn off “Unread”."}
          action={list.length > 0 ? <Button variant="secondary" onClick={() => { setTab("all"); setUnreadOnly("all"); setClient(""); }}>Clear filters</Button> : undefined}
        />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.label}>
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">{g.label}</div>
              <ul className="space-y-2">
                {g.items.map((n) => (
                  <li key={n.id}>
                    <Row n={n} onOpen={() => (n.read ? undefined : void markRead([n.id]))} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {more && (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={() => void load(list[list.length - 1]?.createdAt)}>
                Load older
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ n, onOpen }: { n: AppNotification; onOpen: () => void }) {
  const cat = categoryOf(n.kind);
  const body = (
    <div className="flex items-start gap-3">
      <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full", n.read ? "bg-field text-muted" : "bg-accent/15 text-accent")}>{ICON[cat]}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-bold">{n.title}</span>
          <span className="shrink-0 text-[11px] text-muted" title={format(parseISO(n.createdAt), "d MMM yyyy, h:mm a")}>
            {formatDistanceToNowStrict(parseISO(n.createdAt), { addSuffix: true })}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted">{n.body}</p>
        <span className="mt-1 inline-block text-[10px] font-bold uppercase tracking-wider text-muted">{CATEGORY_LABEL[cat]}</span>
      </div>
      {!n.read && <span aria-label="Unread" className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />}
    </div>
  );
  const cls = cn("block rounded-xl border p-3 transition-colors hover:border-accent/50", n.read ? "border-line bg-field/40" : "border-accent/40 bg-accent/10");
  return n.link ? (
    <Link href={n.link} onClick={onOpen} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onOpen} className={cn(cls, "w-full text-left")}>
      {body}
    </button>
  );
}
