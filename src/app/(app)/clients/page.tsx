"use client";

import { format, parseISO } from "date-fns";
import { Bot, CalendarPlus, ChevronRight, FileUp, LayoutGrid, MessageCircle, Plus, Rows3, Search, Send, Ticket, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { TrainerBookModal, type TrainerBookInit } from "@/components/booking/TrainerBookModal";
import { AddClientModal, CredentialsModal, type Credentials } from "@/components/clients/ClientForms";
import { ImportClientsModal } from "@/components/clients/ImportClientsModal";
import { NudgeModal } from "@/components/clients/NudgeModal";
import { lastSeen, PctBar, PctPill, ReasonBadges, useStatuses } from "@/components/clients/status";
import { CoachCodeCard, LinkRequests, useLinkRequestCount } from "@/components/coachlink/CoachLink";
import { Badge, Button, Card, EmptyState, Input, PageHeader, PersonAvatar, Segmented } from "@/components/ui";
import { GROUP_LABEL, inGroup, type AttentionGroup } from "@/lib/attention";
import { clientThread, requestThread } from "@/lib/chat";
import { useViewer } from "@/lib/hooks";
import { availableCredits } from "@/lib/scheduling";
import { useNow } from "@/lib/store";
import { cn } from "@/lib/utils";

type View = "cards" | "table";
const VIEW_KEY = "coachflow-clients-view";
const GROUPS: AttentionGroup[] = ["all", "attention", "missed", "behind", "quiet", "low", "nologin"];

/** The dashboard links here with ?group=attention so the list opens already filtered. */
function initialGroup(): AttentionGroup {
  try {
    const g = new URLSearchParams(window.location.search).get("group");
    return GROUPS.includes(g as AttentionGroup) ? (g as AttentionGroup) : "all";
  } catch {
    return "all";
  }
}

function initialView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "table" ? "table" : "cards";
  } catch {
    return "cards";
  }
}

export default function ClientsPage() {
  const { db, clients } = useViewer();
  const router = useRouter();
  const now = useNow(60_000);
  const statuses = useStatuses();
  const requests = useLinkRequestCount();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"active" | "archived" | "all">("active");
  const [group, setGroup] = useState<AttentionGroup>(initialGroup);
  const [view, setView] = useState<View>(initialView);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [nudging, setNudging] = useState(false);
  const [book, setBook] = useState<TrainerBookInit | null>(null);
  const [creds, setCreds] = useState<Credentials | null>(null);

  const changeView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  };

  const active = useMemo(() => clients.filter((c) => !c.profile.archived), [clients]);
  const counts = useMemo(() => {
    const out = {} as Record<AttentionGroup, number>;
    for (const g of GROUPS) out[g] = active.filter((c) => { const s = statuses.get(c.user.id); return s ? inGroup(s, g) : g === "all"; }).length;
    return out;
  }, [active, statuses]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return clients
      .filter((c) => (filter === "all" ? true : filter === "archived" ? c.profile.archived : !c.profile.archived))
      .filter((c) => {
        const s = statuses.get(c.user.id);
        return s ? inGroup(s, group) : group === "all";
      })
      .filter((c) => !term || `${c.user.name} ${c.user.username} ${c.profile.goal}`.toLowerCase().includes(term))
      // People who need a look come first, then everyone else by name (the list is already by name).
      .sort((a, b) => Number(statuses.get(b.user.id)?.attention ?? false) - Number(statuses.get(a.user.id)?.attention ?? false) || a.user.name.localeCompare(b.user.name));
  }, [clients, filter, group, q, statuses]);

  const chat = (id: string) => {
    requestThread(clientThread(id));
    router.push("/messages");
  };

  const nextSession = (id: string) =>
    db.bookings
      .filter((b) => b.clientId === id && (b.status === "CONFIRMED" || b.status === "PENDING") && parseISO(b.start) > now)
      .sort((a, b) => a.start.localeCompare(b.start))[0];

  const needAttention = counts.attention;

  return (
    <div>
      <PageHeader
        title="Clients"
        subtitle={`${active.length} active clients${needAttention ? ` · ${needAttention} need${needAttention === 1 ? "s" : ""} attention` : ""}`}
        actions={
          <>
            <Link href="/autopilot">
              <Button variant="secondary" data-tour="clients-autopilot">
                <Bot size={16} /> Autopilot
              </Button>
            </Link>
            <Button variant="secondary" onClick={() => setNudging(true)} disabled={active.length === 0}>
              <Send size={16} /> Nudge clients
            </Button>
            <Button variant="secondary" data-tour="clients-import" onClick={() => setImporting(true)}>
              <FileUp size={16} /> Import clients
            </Button>
            <Button data-tour="clients-add" onClick={() => setAdding(true)}>
              <UserPlus size={16} /> Add client
            </Button>
          </>
        }
      />

      <div className="mb-4 space-y-4">
        <LinkRequests />
        <CoachCodeCard compact />
      </div>

      <div role="group" aria-label="Client groups" className="no-scrollbar -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0" data-tour="clients-groups">
        {GROUPS.map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={group === g}
            onClick={() => setGroup(g)}
            className={cn(
              "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
              group === g ? "border-accent bg-accent text-on-accent" : "border-line bg-field text-muted hover:text-ink",
            )}
          >
            {GROUP_LABEL[g]}
            <span className={cn("flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold", group === g ? "bg-on-accent text-accent" : g === "all" || counts[g] === 0 ? "bg-line text-muted" : "bg-pr text-on-pr")}>{counts[g]}</span>
          </button>
        ))}
        {requests > 0 && (
          <button
            type="button"
            onClick={() => document.querySelector('[data-tour="coach-requests"]')?.scrollIntoView({ behavior: "smooth", block: "center" })}
            className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border border-accent/50 bg-accent/10 px-4 text-sm font-semibold text-accent"
          >
            Requests
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-on-accent">{requests}</span>
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3" data-tour="clients-search">
        <div className="relative min-w-[200px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…" className="pl-9" />
        </div>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "active", label: "Active" },
            { value: "archived", label: "Archived" },
            { value: "all", label: "All" },
          ]}
        />
        {/* Wide screens only: phones always get cards. */}
        <div className="hidden md:block">
          <Segmented
            value={view}
            onChange={changeView}
            options={[
              { value: "cards", label: <span className="inline-flex items-center gap-1.5"><LayoutGrid size={14} /> Cards</span> },
              { value: "table", label: <span className="inline-flex items-center gap-1.5"><Rows3 size={14} /> Table</span> },
            ]}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        group !== "all" && clients.length > 0 ? (
          <EmptyState title={`No one in “${GROUP_LABEL[group]}”`} hint={group === "attention" ? "Everyone is on track. Nice work." : "Nobody matches this group right now."} action={<Button variant="secondary" onClick={() => setGroup("all")}>Show everyone</Button>} />
        ) : (
          <EmptyState
            icon={<UserPlus size={28} />}
            title="No clients found"
            hint="Create a client account and share the login details with them."
            action={
              <Button onClick={() => setAdding(true)}>
                <Plus size={16} /> Add client
              </Button>
            }
          />
        )
      ) : (
        <>
          <div className={cn("grid gap-3 md:grid-cols-2", view === "table" && "md:hidden")} data-tour="clients-list">
            {rows.map(({ user, profile }) => {
              const avail = availableCredits(profile, db.bookings);
              const next = nextSession(user.id);
              const s = statuses.get(user.id);
              return (
                <Card key={user.id} className={cn("flex h-full flex-col gap-3 p-4 transition-colors hover:border-accent/50", s?.attention && "border-pr/40")}>
                  <Link href={`/clients/${user.id}`} className="flex flex-col gap-3" aria-label={`Open ${user.name}`}>
                    <div className="flex items-center gap-3">
                      <PersonAvatar user={user} size={46} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-bold">{user.name}</div>
                        <div className="truncate text-xs text-muted">@{user.username}</div>
                      </div>
                      {profile.archived ? <Badge>Archived</Badge> : <Badge className="border-accent/30 bg-accent/15 text-accent">{profile.goal}</Badge>}
                      <ChevronRight size={16} className="shrink-0 text-muted" />
                    </div>
                    {s && !profile.archived && (
                      <div>
                        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-muted">
                            This week {s.weekDone} of {s.target}
                          </span>
                          <span className="flex gap-1.5">
                            <PctPill pct={s.pct7} label="7d" />
                            <PctPill pct={s.pct30} label="30d" />
                          </span>
                        </div>
                        <PctBar pct={Math.min(100, Math.round((s.weekDone / s.target) * 100))} />
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl bg-field py-2">
                        <div className="flex items-center justify-center gap-1 text-lg font-bold">
                          <Ticket size={14} className={avail <= 2 ? "text-danger" : "text-accent"} />
                          <span className={avail <= 2 ? "text-danger" : ""}>{profile.credits}</span>
                        </div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Credits · {profile.groupClassCredits} group</div>
                      </div>
                      <div className="rounded-xl bg-field py-2">
                        <div className="text-sm font-bold leading-7">{next ? format(parseISO(next.start), "EEE d MMM") : "—"}</div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Next session</div>
                      </div>
                      <div className="rounded-xl bg-field py-2">
                        <div className="text-sm font-bold leading-7">{s?.lastActivity ? format(s.lastActivity, "d MMM") : "—"}</div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Last session</div>
                      </div>
                    </div>
                    {s && <ReasonBadges status={s} />}
                  </Link>
                  {!profile.archived && (
                    <div className="mt-auto flex gap-2">
                      <Button size="sm" variant="secondary" className="flex-1" onClick={() => chat(user.id)}>
                        <MessageCircle size={14} /> Chat
                      </Button>
                      <Button size="sm" variant="secondary" className="flex-1" onClick={() => setBook({ clientId: user.id })}>
                        <CalendarPlus size={14} /> Book
                      </Button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          {view === "table" && (
            <Card className="hidden overflow-x-auto md:block" data-tour="clients-table">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-[11px] font-bold uppercase tracking-wider text-muted">
                    <th className="px-4 py-3">Client</th>
                    <th className="px-3 py-3">Last session</th>
                    <th className="px-3 py-3">7 days</th>
                    <th className="px-3 py-3">30 days</th>
                    <th className="px-3 py-3">This week</th>
                    <th className="px-3 py-3">Credits</th>
                    <th className="px-3 py-3">Next session</th>
                    <th className="px-3 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ user, profile }) => {
                    const s = statuses.get(user.id);
                    const avail = availableCredits(profile, db.bookings);
                    const next = nextSession(user.id);
                    return (
                      <tr key={user.id} className={cn("border-b border-line/60 last:border-0 hover:bg-field/50", s?.attention && "bg-pr/5")}>
                        <td className="px-4 py-3">
                          <Link href={`/clients/${user.id}`} className="flex items-center gap-3" aria-label={`Open ${user.name}`}>
                            <PersonAvatar user={user} size={36} />
                            <span className="min-w-0">
                              <span className="block truncate font-semibold">{user.name}</span>
                              <span className="block truncate text-xs text-muted">{profile.archived ? "Archived" : profile.goal}</span>
                              {s && <span className="mt-1 block"><ReasonBadges status={s} max={2} /></span>}
                            </span>
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-xs text-muted">{s ? lastSeen(s, now) : "—"}</td>
                        <td className="px-3 py-3">{s && !profile.archived ? <PctPill pct={s.pct7} /> : "—"}</td>
                        <td className="px-3 py-3">{s && !profile.archived ? <PctPill pct={s.pct30} /> : "—"}</td>
                        <td className="px-3 py-3 tabular-nums">{s ? `${s.weekDone} of ${s.target}` : "—"}</td>
                        <td className={cn("px-3 py-3 font-semibold tabular-nums", avail <= 2 && "text-danger")}>{profile.credits}</td>
                        <td className="px-3 py-3 text-xs">{next ? format(parseISO(next.start), "EEE d MMM, h:mm a") : "—"}</td>
                        <td className="px-3 py-3">
                          {!profile.archived && (
                            <div className="flex justify-end gap-1.5">
                              <Button size="sm" variant="secondary" onClick={() => chat(user.id)} aria-label={`Chat with ${user.name}`}>
                                <MessageCircle size={14} />
                              </Button>
                              <Button size="sm" variant="secondary" onClick={() => setBook({ clientId: user.id })} aria-label={`Book ${user.name}`}>
                                <CalendarPlus size={14} />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      <AddClientModal
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(_id, c) => {
          setAdding(false);
          setCreds(c);
        }}
      />
      <CredentialsModal creds={creds} onClose={() => setCreds(null)} />
      <ImportClientsModal open={importing} onClose={() => setImporting(false)} />
      <TrainerBookModal init={book} onClose={() => setBook(null)} />
      <NudgeModal open={nudging} onClose={() => setNudging(false)} />
    </div>
  );
}
