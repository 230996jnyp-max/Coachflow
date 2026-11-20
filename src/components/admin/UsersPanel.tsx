"use client";

import { format, parseISO } from "date-fns";
import { ChevronDown, Copy, KeyRound, MessageSquare, Power, Search, ShieldCheck, Trash2, Users as UsersIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BillingStats, CoachBillingLine, type BillingOverview } from "@/components/admin/BillingAdmin";
import type { CoachRow, Roster } from "@/components/admin/AddUserModal";
import { GymActionModal, GymPlanEditor, type GymAction, type GymRow } from "@/components/admin/GymsPanel";
import { ACTION_LABEL, ActionModal, PersonActions, PersonCard, PersonDetails, WaitlistRow, type Action, type Overview, type Person } from "@/components/admin/SignupsPanel";
import { RoleBadge } from "@/components/chat/RoleBadge";
import { Avatar, Badge, Button, Card, Input, Notice, SectionTitle, Segmented, Stat } from "@/components/ui";
import { api } from "@/lib/store";

type Filter = "all" | "coach" | "gym" | "client" | "solo";

/** A coach row for the actions that need a person, when the coach is older than the newest accounts the list loads. */
function personFromCoach(c: CoachRow): Person {
  return { id: c.id, kind: "coach", name: c.name, email: c.email, phone: "", username: c.email, verified: true, active: c.active, disabled: false, createdAt: c.createdAt, lastLoginAt: null, trialEndsAt: null, age: "unknown", clientCount: c.clientCount };
}

const norm = (v: string | undefined) => (v ?? "").toLowerCase();
const personHit = (p: Person, needle: string) => [p.name, p.email, p.username, p.phone].some((v) => norm(v).includes(needle));

/** Everyone on the platform in one place: coaches (with their clients underneath), gyms, solo users and clients, with the owner's actions. */
export function UsersPanel({ roster, billing, billingReload, version, meId, onChanged, onMessage, onReset }: {
  roster: Roster | null;
  billing: BillingOverview | null;
  billingReload: () => void;
  version: number;
  meId: string;
  onChanged: () => void;
  onMessage: (c: CoachRow) => void;
  onReset: (c: CoachRow) => void;
}) {
  const [data, setData] = useState<Overview | null>(null);
  const [gyms, setGyms] = useState<GymRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Filter>("all");
  const [status, setStatus] = useState<"all" | "unverified" | "off">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [act, setAct] = useState<{ person: Person; action: Action } | null>(null);
  const [gymAct, setGymAct] = useState<{ gym: GymRow; action: GymAction } | null>(null);
  const [flash, setFlash] = useState<{ tone: "success" | "warn"; text: string } | null>(null);

  const load = useCallback(async () => {
    const [o, g] = await Promise.all([api<Overview>("/api/admin/signups"), api<{ gyms: GymRow[] }>("/api/admin/gyms")]);
    if (o.ok && o.data) {
      setData(o.data);
      setError(null);
    } else setError(o.error ?? "Could not load users.");
    if (g.ok && g.data) setGyms(g.data.gyms);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.resolve();
      const [o, g] = await Promise.all([api<Overview>("/api/admin/signups"), api<{ gyms: GymRow[] }>("/api/admin/gyms")]);
      if (!alive) return;
      if (o.ok && o.data) {
        setData(o.data);
        setError(null);
      } else setError(o.error ?? "Could not load users.");
      if (g.ok && g.data) setGyms(g.data.gyms);
    })();
    return () => {
      alive = false;
    };
  }, [version]);

  const model = useMemo(() => {
    const people = data?.people ?? [];
    const personById = new Map(people.map((p) => [p.id, p]));
    const clientsOf = new Map<string, Person[]>();
    for (const p of people) {
      if (p.kind !== "client" || !p.coachId) continue;
      clientsOf.set(p.coachId, [...(clientsOf.get(p.coachId) ?? []), p]);
    }
    for (const list of clientsOf.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    const adminIds = new Set((gyms ?? []).map((g) => g.adminId));
    const coaches = (roster?.coaches ?? []).filter((c) => !adminIds.has(c.id));
    const solo = people.filter((p) => p.kind === "personal");
    const clients = people.filter((p) => p.kind === "client");
    return { personById, clientsOf, coaches, solo, clients };
  }, [data, gyms, roster]);

  const needle = q.trim().toLowerCase();
  const statusOk = (person: Person | undefined, activeFlag = true) => {
    if (status === "unverified") return !!person && !person.verified;
    if (status === "off") return !!person?.disabled || !activeFlag;
    return true;
  };

  if (error && !data) return <Notice tone="error">{error}</Notice>;
  if (!data || !gyms) return <Card className="p-6 text-center text-sm text-muted">Loading…</Card>;

  const max = Math.max(1, ...data.days.map((x) => x.n));
  const week = data.days.slice(-7).reduce((n, x) => n + x.n, 0);

  const showCoaches = kind === "all" || kind === "coach";
  const showGyms = kind === "all" || kind === "gym";
  const showSolo = kind === "all" || kind === "solo";
  const showClients = kind === "client";

  const coachEntries = showCoaches
    ? model.coaches
        .map((c) => {
          const person = model.personById.get(c.id);
          const kids = model.clientsOf.get(c.id) ?? [];
          const own = !needle || [c.name, c.email].some((v) => norm(v).includes(needle)) || (!!person && personHit(person, needle));
          const kidHit = !!needle && kids.some((k) => personHit(k, needle));
          return { c, person, kids, autoOpen: !own && kidHit, show: (own || kidHit) && statusOk(person, c.active) };
        })
        .filter((e) => e.show)
    : [];
  const gymEntries = showGyms
    ? gyms
        .map((g) => {
          const person = model.personById.get(g.adminId);
          const kids = model.clientsOf.get(g.adminId) ?? [];
          const own = !needle || [g.name, g.adminName, g.adminEmail, g.code].some((v) => norm(v).includes(needle));
          const kidHit = !!needle && kids.some((k) => personHit(k, needle));
          return { g, person, kids, autoOpen: !own && kidHit, show: (own || kidHit) && statusOk(person, g.status !== "DISABLED") };
        })
        .filter((e) => e.show)
    : [];
  const soloEntries = showSolo ? model.solo.filter((p) => (!needle || personHit(p, needle)) && statusOk(p)) : [];
  const clientEntries = showClients ? model.clients.filter((p) => (!needle || personHit(p, needle) || norm(p.coachName).includes(needle)) && statusOk(p)) : [];
  const total = coachEntries.length + gymEntries.length + soloEntries.length + clientEntries.length;

  const done = (text: string, tone: "success" | "warn") => {
    setAct(null);
    setGymAct(null);
    setFlash({ tone, text });
    void load();
    onChanged();
    billingReload();
  };

  const coachAct = (c: CoachRow, person: Person | undefined, action: Action) => setAct({ person: person ?? personFromCoach(c), action });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Coaches" value={model.coaches.length} sub={`${model.coaches.filter((c) => c.active).length} active`} tone="accent" />
        <Stat label="Gyms" value={gyms.length} sub={gyms.filter((g) => g.status === "DISABLED").length ? `${gyms.filter((g) => g.status === "DISABLED").length} switched off` : "all on"} />
        <Stat label="Clients" value={data.clients.total} sub="of a coach" />
        <Stat label="Solo" value={data.personal.total} sub={`${data.personal.trial} on free trial`} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Last 7 days" value={week} sub="new accounts" tone="success" />
        <Stat label="Not verified" value={data.unverified} sub="Solo accounts waiting on the email link" />
      </div>
      <BillingStats data={billing} />
      <WaitlistRow count={data.waitlist} />

      <section>
        <SectionTitle>New accounts, last 14 days</SectionTitle>
        <Card className="p-4">
          <div className="flex h-28 items-end gap-1.5" role="img" aria-label="New accounts per day for the last 14 days">
            {data.days.map((x) => (
              <div key={x.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${x.day}: ${x.n}`}>
                <span className="text-[10px] tabular-nums text-muted">{x.n || ""}</span>
                <div className="w-full rounded-t bg-accent" style={{ height: `${Math.max(x.n ? 6 : 2, (x.n / max) * 80)}%`, opacity: x.n ? 1 : 0.25 }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted">
            <span>{format(parseISO(data.days[0].day), "d MMM")}</span>
            <span>{format(parseISO(data.days[data.days.length - 1].day), "d MMM")}</span>
          </div>
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle>Users</SectionTitle>
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, username, phone or gym code" className="pl-9" aria-label="Search users" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { value: "all", label: "All" },
              { value: "coach", label: `Coaches (${model.coaches.length})` },
              { value: "gym", label: `Gyms (${gyms.length})` },
              { value: "client", label: `Clients (${model.clients.length})` },
              { value: "solo", label: `Solo (${model.solo.length})` },
            ]}
          />
          <Segmented value={status} onChange={setStatus} options={[{ value: "all", label: "Any status" }, { value: "unverified", label: "Not verified" }, { value: "off", label: "Disabled" }]} />
        </div>
        {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}

        <div className="space-y-2">
          {total === 0 && <Card className="p-6 text-center text-sm text-muted">{data.people.length === 0 && !roster?.coaches.length ? "No users yet." : "Nobody matches."}</Card>}
          {coachEntries.map(({ c, person, kids, autoOpen }) => (
            <CoachCard
              key={c.id}
              c={c}
              person={person}
              kids={kids}
              autoOpen={autoOpen}
              me={c.id === meId}
              line={billing?.coaches.find((l) => l.coachId === c.id)}
              onBillingChanged={billingReload}
              onMessage={() => onMessage(c)}
              onReset={() => onReset(c)}
              onAct={(action) => coachAct(c, person, action)}
              onReactivate={async () => {
                const r = await api(`/api/admin/coaches/${c.id}`, { method: "PATCH", body: { active: true } });
                if (!r.ok) setFlash({ tone: "warn", text: r.error ?? "Could not reactivate the coach." });
                else done(`Reactivated: ${c.name}.`, "success");
              }}
            />
          ))}
          {gymEntries.map(({ g, person, kids, autoOpen }) => (
            <GymCard key={g.id} g={g} person={person} kids={kids} autoOpen={autoOpen} onAct={(action) => setGymAct({ gym: g, action })} onPlanSaved={(text) => { setFlash({ tone: "success", text }); void load(); }} />
          ))}
          {soloEntries.map((p) => (
            <PersonCard key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} onAct={(action) => setAct({ person: p, action })} />
          ))}
          {clientEntries.map((p) => (
            <PersonCard key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} onAct={(action) => setAct({ person: p, action })} />
          ))}
        </div>
        <p className="text-xs text-muted">
          Showing the {data.people.length} newest accounts. Workouts, notes, food logs, body data and photos are never shown here, and a gym shows only its coaches and AI use.
        </p>
      </section>

      {data.actions.length > 0 && (
        <section>
          <SectionTitle>Recent actions</SectionTitle>
          <Card className="divide-y divide-line p-0">
            {data.actions.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span>
                  <span className="font-semibold">{ACTION_LABEL[a.action] ?? a.action}</span> · {a.target}
                  {a.reason && <span className="text-muted"> — {a.reason}</span>}
                </span>
                <span className="text-xs text-muted">{format(parseISO(a.at), "d MMM, h:mm a")}</span>
              </div>
            ))}
          </Card>
        </section>
      )}

      {act && <ActionModal person={act.person} action={act.action} onClose={() => setAct(null)} onDone={done} />}
      {gymAct && <GymActionModal gym={gymAct.gym} action={gymAct.action} onClose={() => setGymAct(null)} onDone={done} />}
    </div>
  );
}

/** The clients of one coach, under a dropdown on the coach's card: name, email, when they joined and whether they are active. */
function ClientsDropdown({ kids, count, autoOpen, label }: { kids: Person[]; count: number; autoOpen: boolean; label: string }) {
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? autoOpen;
  return (
    <div className="border-t border-line">
      <button type="button" aria-expanded={open} onClick={() => setOverride(!open)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold">
        <span className="flex items-center gap-2">
          <UsersIcon size={15} className="text-muted" /> {label}
          <span className="rounded-full bg-field px-2 py-0.5 text-xs tabular-nums text-muted">{count}</span>
        </span>
        <ChevronDown size={18} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-1.5 px-4 pb-3">
          {kids.length === 0 && <p className="py-1 text-sm text-muted">{count === 0 ? "No clients yet." : "Their clients are not among the newest accounts loaded here."}</p>}
          {kids.map((k) => (
            <div key={k.id} className="flex items-start justify-between gap-3 rounded-xl bg-field px-3 py-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold">{k.name}</span>
                  {k.disabled && <Badge className="border-danger/30 bg-danger/15 text-danger">Disabled</Badge>}
                  {!k.active && !k.disabled && <Badge className="border-line">Archived</Badge>}
                </div>
                <div className="truncate text-xs text-muted">{k.email || "No email"}</div>
              </div>
              <div className="shrink-0 text-right text-xs text-muted">
                <div className={k.active ? "font-semibold text-success" : ""}>{k.active ? "Active" : "Inactive"}</div>
                <div>Joined {format(parseISO(k.createdAt), "d MMM yyyy")}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CoachCard({ c, person, kids, autoOpen, me, line, onBillingChanged, onMessage, onReset, onAct, onReactivate }: {
  c: CoachRow;
  person: Person | undefined;
  kids: Person[];
  autoOpen: boolean;
  me: boolean;
  line: BillingOverview["coaches"][number] | undefined;
  onBillingChanged: () => void;
  onMessage: () => void;
  onReset: () => void;
  onAct: (a: Action) => void;
  onReactivate: () => void;
}) {
  const [details, setDetails] = useState(false);
  const archived = !c.active && !person?.disabled;
  return (
    <Card className="p-0" data-user-kind="coach">
      <div className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <Avatar name={c.name} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-bold">{c.name}</span>
              <RoleBadge role={c.role === "OWNER" ? "OWNER" : "COACH"} />
              {person?.disabled && <Badge className="border-danger/30 bg-danger/15 text-danger">Disabled</Badge>}
              {archived && <Badge className="border-danger/30 bg-danger/15 text-danger">Deactivated</Badge>}
              {c.active && c.mustChangePassword && <Badge className="border-pr/30 bg-pr/15 text-pr">Awaiting first login</Badge>}
              {person && !person.verified && <Badge className="border-pr/30 bg-pr/15 text-pr">Email not verified</Badge>}
            </div>
            <div className="truncate text-sm text-muted">{c.email}</div>
            <div className="mt-0.5 text-xs text-muted">Joined {format(parseISO(c.createdAt), "d MMM yyyy")}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="flex items-center justify-end gap-1.5 text-2xl font-bold tabular-nums">
              <UsersIcon size={16} className="text-muted" /> {c.clientCount}
            </div>
            <div className="text-[11px] text-muted">{c.activeClientCount === c.clientCount ? "clients" : `clients · ${c.activeClientCount} active`}</div>
          </div>
        </div>
        <CoachBillingLine line={line} onChanged={onBillingChanged} />
      </div>

      <ClientsDropdown kids={kids} count={c.clientCount} autoOpen={autoOpen} label="Clients" />

      <div className="space-y-3 border-t border-line p-4">
        {me ? (
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <ShieldCheck size={14} className="text-pr" /> This is you — you coach your own clients and manage the platform.
          </div>
        ) : (
          <>
            {details && person && <PersonDetails p={person} />}
            {person ? (
              <PersonActions
                p={person}
                onAct={onAct}
                extra={
                  <>
                    <Button size="sm" onClick={onMessage} disabled={!c.active}>
                      <MessageSquare size={14} /> Message coach
                    </Button>
                    <Button size="sm" variant="secondary" onClick={onReset}>
                      <KeyRound size={14} /> Set temporary password
                    </Button>
                  </>
                }
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={onMessage} disabled={!c.active}>
                  <MessageSquare size={14} /> Message coach
                </Button>
                <Button size="sm" variant="secondary" onClick={onReset}>
                  <KeyRound size={14} /> Set temporary password
                </Button>
                <Button size="sm" variant="secondary" onClick={() => onAct("disable")} disabled={!c.active}>
                  <Power size={14} /> Disable
                </Button>
                <Button size="sm" variant="danger" onClick={() => onAct("delete")}>
                  <Trash2 size={14} /> Delete…
                </Button>
              </div>
            )}
            {archived && (
              <Button size="sm" variant="success" onClick={onReactivate}>
                <Power size={14} /> Reactivate
              </Button>
            )}
            {person && (
              <button type="button" onClick={() => setDetails(!details)} aria-expanded={details} className="text-xs font-semibold text-muted hover:text-ink">
                {details ? "Hide details" : "Show details"}
              </button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function GymCard({ g, person, kids, autoOpen, onAct, onPlanSaved }: { g: GymRow; person: Person | undefined; kids: Person[]; autoOpen: boolean; onAct: (a: GymAction) => void; onPlanSaved: (text: string) => void }) {
  return (
    <Card className="p-0" data-user-kind="gym">
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-bold">{g.name}</span>
          <Badge>Gym</Badge>
          {g.status === "DISABLED" && <Badge className="border-danger/30 bg-danger/15 text-danger">Switched off</Badge>}
          {g.pending > 0 && <Badge className="border-pr/30 bg-pr/15 text-pr">{g.pending} waiting</Badge>}
          {!g.trialEndsAt && <Badge className="border-success/30 bg-success/15 text-success">Exempt from payment</Badge>}
          {person?.mustChangePassword && <Badge className="border-pr/30 bg-pr/15 text-pr">Awaiting first login</Badge>}
        </div>
        <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div>
            <span className="text-muted">Admin </span>
            {g.adminName}
          </div>
          <div className="truncate">
            <span className="text-muted">Email </span>
            {g.adminEmail || "—"}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted">Gym code</span> <span className="font-mono font-semibold tracking-widest">{g.code}</span>
            <button type="button" aria-label="Copy gym code" onClick={() => void navigator.clipboard.writeText(g.code).catch(() => undefined)} className="text-muted hover:text-ink">
              <Copy size={14} />
            </button>
          </div>
          <div>
            <span className="text-muted">Coaches linked </span>
            <strong>{g.coaches}</strong>
          </div>
          <div>
            <span className="text-muted">AI uses </span>
            <strong>{g.aiUses}</strong> <span className="text-muted">({g.aiUses30d} in the last 30 days)</span>
          </div>
          <div className="text-muted">
            Created {format(parseISO(g.createdAt), "d MMM yyyy")}
            {g.trialEndsAt ? ` · trial ends ${format(parseISO(g.trialEndsAt), "d MMM yyyy")}` : ""}
          </div>
        </div>
        {g.trialEndsAt || g.plan.status !== "FREE" ? <GymPlanEditor gym={g} onSaved={onPlanSaved} /> : null}
        <div className="flex flex-wrap gap-2">
          {g.status === "DISABLED" ? (
            <Button size="sm" variant="success" onClick={() => onAct("enable")}>
              <Power size={14} /> Switch on
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => onAct("disable")}>
              <Power size={14} /> Switch off
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={() => onAct("delete")}>
            <Trash2 size={14} /> Delete…
          </Button>
        </div>
      </div>
      {kids.length > 0 && <ClientsDropdown kids={kids} count={kids.length} autoOpen={autoOpen} label="The admin's own clients" />}
    </Card>
  );
}
