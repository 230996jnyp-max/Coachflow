"use client";

import { format, formatDistanceToNowStrict, parseISO } from "date-fns";
import { ChevronDown, KeyRound, MailCheck, Power, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Field, Input, Modal, Notice, SectionTitle, Segmented, Stat, Textarea } from "@/components/ui";
import { api } from "@/lib/store";

interface Bucket {
  total: number;
  verified: number;
  trial: number;
}
type Kind = "coach" | "personal" | "client";
interface Person {
  id: string;
  kind: Kind;
  name: string;
  email: string;
  phone: string;
  username: string;
  verified: boolean;
  active: boolean;
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  trialEndsAt: string | null;
  age: "adult" | "under 18" | "unknown";
  coachName?: string;
  clientCount?: number;
  niches?: string[];
  coachCode?: string;
}
interface Overview {
  coaches: Bucket;
  personal: Bucket;
  clients: Bucket;
  unverified: number;
  waitlist: number;
  days: { day: string; n: number }[];
  people: Person[];
  actions: { id: string; action: string; target: string; reason: string; at: string }[];
}
type Action = "disable" | "enable" | "delete" | "resend_verification" | "force_reset";

const KIND_LABEL: Record<Kind, string> = { coach: "Coach", personal: "Solo", client: "Client" };
const ACTION_LABEL: Record<string, string> = { disable: "Disabled", enable: "Re-enabled", delete: "Deleted", resend_verification: "Resent confirmation", force_reset: "Forced password reset", gym_disable: "Switched off", gym_enable: "Switched on", gym_delete: "Deleted gym" };

/** People who asked to hear when the AI personal trainer is ready. The addresses are fetched only when the owner asks to copy them. */
function WaitlistRow({ count }: { count: number }) {
  const [state, setState] = useState<"idle" | "busy" | "copied" | "error">("idle");
  const copy = async () => {
    setState("busy");
    const r = await api<{ list: { email: string }[] }>("/api/admin/waitlist");
    if (!r.ok || !r.data) return setState("error");
    try {
      await navigator.clipboard.writeText(r.data.list.map((x) => x.email).join("\n"));
      setState("copied");
    } catch {
      setState("error");
    }
    setTimeout(() => setState("idle"), 2500);
  };
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <div className="font-semibold">AI trainer waitlist</div>
        <div className="text-sm text-muted">{count === 1 ? "1 person is" : `${count} people are`} waiting to hear when it&apos;s ready.</div>
      </div>
      <Button size="sm" variant="secondary" onClick={() => void copy()} disabled={count === 0 || state === "busy"}>
        {state === "copied" ? "Copied" : state === "error" ? "Could not copy" : state === "busy" ? "Getting them" : "Copy emails"}
      </Button>
    </Card>
  );
}

/** Sign-ups: counts, a 14-day chart, and every account with its contact details and the owner's actions. */
export function SignupsPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | Kind>("all");
  const [status, setStatus] = useState<"all" | "unverified" | "off">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [act, setAct] = useState<{ person: Person; action: Action } | null>(null);
  const [flash, setFlash] = useState<{ tone: "success" | "warn"; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await api<Overview>("/api/admin/signups");
    if (r.ok && r.data) {
      setData(r.data);
      setError(null);
    } else setError(r.error ?? "Could not load sign-ups.");
  }, []);

  useEffect(() => {
    let alive = true;
    api<Overview>("/api/admin/signups").then((r) => {
      if (!alive) return;
      if (r.ok && r.data) setData(r.data);
      else setError(r.error ?? "Could not load sign-ups.");
    });
    return () => {
      alive = false;
    };
  }, []);

  const people = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.people ?? []).filter((p) => {
      if (kind !== "all" && p.kind !== kind) return false;
      if (status === "unverified" && p.verified) return false;
      if (status === "off" && !p.disabled) return false;
      if (!needle) return true;
      return [p.name, p.email, p.username, p.phone].some((v) => v.toLowerCase().includes(needle));
    });
  }, [data, q, kind, status]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Card className="p-6 text-center text-sm text-muted">Loading…</Card>;
  const max = Math.max(1, ...data.days.map((x) => x.n));
  const week = data.days.slice(-7).reduce((n, x) => n + x.n, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Coaches" value={data.coaches.total} sub={`${data.coaches.verified} verified`} tone="accent" />
        <Stat label="Solo" value={data.personal.total} sub={`${data.personal.trial} on free trial`} />
        <Stat label="Clients" value={data.clients.total} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Last 7 days" value={week} sub="new accounts" tone="success" />
        <Stat label="Not verified" value={data.unverified} sub="Solo accounts waiting on the email link" />
      </div>
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
        <SectionTitle>Accounts</SectionTitle>
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, username or phone" className="pl-9" aria-label="Search accounts" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Segmented value={kind} onChange={setKind} options={[{ value: "all", label: "All" }, { value: "coach", label: "Coaches" }, { value: "client", label: "Clients" }, { value: "personal", label: "Solo" }]} />
          <Segmented value={status} onChange={setStatus} options={[{ value: "all", label: "Any status" }, { value: "unverified", label: "Not verified" }, { value: "off", label: "Disabled" }]} />
        </div>
        {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}

        <div className="space-y-2">
          {people.length === 0 && <Card className="p-6 text-center text-sm text-muted">{data.people.length === 0 ? "No sign-ups yet." : "Nobody matches."}</Card>}
          {people.map((p) => (
            <PersonCard key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} onAct={(action) => setAct({ person: p, action })} />
          ))}
        </div>
        <p className="text-xs text-muted">Showing the {data.people.length} newest accounts. Workouts, notes, food logs, body data and photos are never shown here.</p>
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

      {act && (
        <ActionModal
          person={act.person}
          action={act.action}
          onClose={() => setAct(null)}
          onDone={(text, tone) => {
            setAct(null);
            setFlash({ tone, text });
            void load();
          }}
        />
      )}
    </div>
  );
}

function PersonCard({ p, open, onToggle, onAct }: { p: Person; open: boolean; onToggle: () => void; onAct: (a: Action) => void }) {
  const row = "flex justify-between gap-3 py-1.5 text-sm";
  const k = "shrink-0 text-muted";
  return (
    <Card className="p-0">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 p-4 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-bold">{p.name}</span>
            <Badge>{KIND_LABEL[p.kind]}</Badge>
            {!p.verified && <Badge className="border-pr/30 bg-pr/15 text-pr">Email not verified</Badge>}
            {p.disabled && <Badge className="border-danger/30 bg-danger/15 text-danger">Disabled</Badge>}
            {!p.active && !p.disabled && <Badge className="border-line">Archived</Badge>}
            {p.age === "under 18" && <Badge>Under 18</Badge>}
          </div>
          <div className="truncate text-sm text-muted">{p.email || "No email"}</div>
          <div className="text-xs text-muted">Joined {format(parseISO(p.createdAt), "d MMM yyyy")}</div>
        </div>
        <ChevronDown size={18} className={`mt-1 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-4 pb-4 pt-3">
          <div className="divide-y divide-line">
            <div className={row}><span className={k}>Username</span><span className="truncate">@{p.username}</span></div>
            <div className={row}><span className={k}>Email</span><span className="truncate">{p.email || "—"}</span></div>
            <div className={row}><span className={k}>Phone</span><span>{p.phone || "—"}</span></div>
            <div className={row}><span className={k}>Account type</span><span>{p.kind === "coach" ? "Coach" : p.kind === "client" ? "Client of a coach" : "Training solo"}</span></div>
            <div className={row}><span className={k}>Age</span><span>{p.age === "unknown" ? "Not given" : p.age === "adult" ? "Adult" : "Under 18"}</span></div>
            <div className={row}><span className={k}>Joined</span><span>{format(parseISO(p.createdAt), "d MMM yyyy, h:mm a")}</span></div>
            <div className={row}><span className={k}>Last sign-in</span><span>{p.lastLoginAt ? `${formatDistanceToNowStrict(parseISO(p.lastLoginAt))} ago` : "Never"}</span></div>
            <div className={row}><span className={k}>Email confirmed</span><span>{p.verified ? "Yes" : "No"}</span></div>
            {p.trialEndsAt && <div className={row}><span className={k}>Free trial ends</span><span>{format(parseISO(p.trialEndsAt), "d MMM yyyy")}</span></div>}
            {p.kind === "client" && <div className={row}><span className={k}>Coach</span><span>{p.coachName}</span></div>}
            {p.kind === "coach" && (
              <>
                <div className={row}><span className={k}>Clients</span><span>{p.clientCount ?? 0}</span></div>
                <div className={row}><span className={k}>Coach code</span><span className="font-mono">{p.coachCode ?? "—"}</span></div>
                <div className={row}><span className={k}>Niches</span><span className="text-right">{p.niches?.length ? p.niches.join(", ") : "Not chosen yet"}</span></div>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {!p.verified && p.email && (
              <Button size="sm" variant="secondary" onClick={() => onAct("resend_verification")}>
                <MailCheck size={14} /> Resend confirmation
              </Button>
            )}
            {p.active && p.email && (
              <Button size="sm" variant="secondary" onClick={() => onAct("force_reset")}>
                <KeyRound size={14} /> Force password reset
              </Button>
            )}
            {p.disabled ? (
              <Button size="sm" variant="success" onClick={() => onAct("enable")}>
                <Power size={14} /> Re-enable
              </Button>
            ) : (
              p.active && (
                <Button size="sm" variant="secondary" onClick={() => onAct("disable")}>
                  <Power size={14} /> Disable
                </Button>
              )
            )}
            <Button size="sm" variant="danger" onClick={() => onAct("delete")}>
              <Trash2 size={14} /> Delete…
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

const COPY: Record<Action, { title: string; body: (p: Person) => string; button: string; reason: boolean }> = {
  disable: { title: "Disable this account?", body: (p) => `${p.name} is signed out at once and can't sign in. Nothing is deleted, and you can switch it back on. They get an email saying so.`, button: "Disable account", reason: true },
  enable: { title: "Switch this account back on?", body: (p) => `${p.name} will be able to sign in again, and gets an email saying so.`, button: "Re-enable account", reason: false },
  delete: { title: "Delete this account for good?", body: (p) => `Everything stored for ${p.name} is erased and can't be brought back${p.kind === "coach" ? ". Their clients are kept, as people with no coach" : ""}. They get an email saying so. If you may want it back, disable it instead.`, button: "Delete permanently", reason: true },
  resend_verification: { title: "Resend the confirmation email?", body: (p) => `A new link goes to ${p.email}.`, button: "Resend", reason: false },
  force_reset: { title: "Force a password reset?", body: (p) => `${p.name} is signed out everywhere and gets an email with a link to choose a new password.`, button: "Send reset link", reason: true },
};

function ActionModal({ person, action, onClose, onDone }: { person: Person; action: Action; onClose: () => void; onDone: (text: string, tone: "success" | "warn") => void }) {
  const c = COPY[action];
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = person.email || person.username;
  const needsTyping = action === "delete";

  const run = async () => {
    setBusy(true);
    setError(null);
    const r = await api<{ email: { status: string; error?: string } }>(`/api/admin/accounts/${person.id}`, { body: { action, reason, confirmEmail: typed } });
    setBusy(false);
    if (!r.ok || !r.data) return setError(r.error ?? "That didn't work. Please try again.");
    const m = r.data.email;
    const mailed = m.status === "sent" ? "They were emailed." : m.status === "preview" ? "Email composed (not sent: test mode)." : m.status === "skipped" ? "No email address on file, so nobody was emailed." : `The email could not be sent${m.error ? ` (${m.error})` : ""}.`;
    onDone(`${ACTION_LABEL[action]}: ${person.name}. ${mailed}`, m.status === "failed" ? "warn" : "success");
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={c.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={action === "delete" || action === "disable" ? "danger" : "primary"} disabled={busy || (needsTyping && typed.trim().toLowerCase() !== target.toLowerCase())} onClick={() => void run()}>
            {busy ? "Working…" : c.button}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">{c.body(person)}</p>
        {c.reason && (
          <Field label="Reason (optional)" hint="Included in the email they receive.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} />
          </Field>
        )}
        {needsTyping && (
          <Field label={`Type ${target} to confirm`}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="none" autoComplete="off" />
          </Field>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
