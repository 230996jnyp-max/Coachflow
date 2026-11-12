"use client";

import { format, parseISO } from "date-fns";
import { Check, Copy, KeyRound, Megaphone, MessageSquare, Plus, Power, ShieldCheck, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PendingApprovals } from "@/components/admin/PendingApprovals";
import { BroadcastModal } from "@/components/chat/BroadcastModal";
import { RoleBadge } from "@/components/chat/RoleBadge";
import { Avatar, Badge, Button, Card, ConfirmDialog, Field, Input, Modal, Notice, PageHeader, SectionTitle, Stat } from "@/components/ui";
import { refreshPendingCount, usePendingCoachRequests } from "@/lib/adminPending";
import { coachThread, requestThread } from "@/lib/chat";
import { useViewer } from "@/lib/hooks";
import { api } from "@/lib/store";

interface CoachRow {
  id: string;
  name: string;
  email: string;
  role: "OWNER" | "COACH";
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  clientCount: number;
  activeClientCount: number;
}

interface Roster {
  coaches: CoachRow[];
  totals: { coaches: number; activeCoaches: number; clients: number };
}

interface Issued {
  title: string;
  name: string;
  email: string;
  password: string;
  mail: { status: string; error?: string };
}

export default function AdminPage() {
  const { user } = useViewer();
  const router = useRouter();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [announce, setAnnounce] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [toggle, setToggle] = useState<CoachRow | null>(null);
  const [reset, setReset] = useState<CoachRow | null>(null);
  const [tab, setTab] = useState<"coaches" | "signups" | "pending">("coaches");
  const pending = usePendingCoachRequests();

  const load = useCallback(async () => {
    const r = await api<Roster>("/api/admin/coaches");
    if (r.ok && r.data) {
      setRoster(r.data);
      setError(null);
    } else setError(r.error ?? "Could not load coaches.");
  }, []);

  useEffect(() => {
    void refreshPendingCount();
  }, []);

  useEffect(() => {
    let alive = true;
    api<Roster>("/api/admin/coaches").then((r) => {
      if (!alive) return;
      if (r.ok && r.data) setRoster(r.data);
      else setError(r.error ?? "Could not load coaches.");
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!user?.isOwner) return null;

  const message = (c: CoachRow) => {
    requestThread(coachThread(c.id));
    router.push("/messages");
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Administrator"
        subtitle="Coaches on the platform. Client details stay private to each coach — only counts are shown here."
        actions={
          <>
            <Button variant="secondary" onClick={() => setAnnounce(true)} disabled={!roster || roster.coaches.length < 2}>
              <Megaphone size={16} /> Announce
            </Button>
            <Button onClick={() => setAdding(true)}>
              <Plus size={16} /> Add coach
            </Button>
          </>
        }
      />

      {error && <Notice tone="error">{error}</Notice>}

      <div role="tablist" aria-label="Administrator sections" className="flex gap-1.5">
        {/* Coaches now sign themselves up. The approvals tab only appears while a request from before that is still waiting. */}
        {(
          (pending > 0 || tab === "pending"
            ? [
                ["coaches", "Coaches"],
                ["signups", "Sign-ups"],
                ["pending", "Earlier requests"],
              ]
            : [
                ["coaches", "Coaches"],
                ["signups", "Sign-ups"],
              ]) as ["coaches" | "signups" | "pending", string][]
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors ${tab === key ? "border-accent bg-accent text-on-accent" : "border-line bg-field text-muted hover:text-ink"}`}
          >
            {label}
            {key === "pending" && pending > 0 && <span className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${tab === key ? "bg-on-accent text-accent" : "bg-danger text-white"}`}>{pending}</span>}
          </button>
        ))}
      </div>

      {tab === "pending" && <PendingApprovals onApproved={() => void load()} />}
      {tab === "signups" && <SignupsPanel />}

      {tab === "coaches" && (
      <>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Coaches" value={roster?.totals.coaches ?? "—"} tone="accent" sub="including you" />
        <Stat label="Active" value={roster?.totals.activeCoaches ?? "—"} tone="success" />
        <Stat label="Clients" value={roster?.totals.clients ?? "—"} sub="across all coaches" />
      </div>

      <section>
        <SectionTitle>Coaches</SectionTitle>
        <div className="space-y-2">
          {!roster && !error && <Card className="p-6 text-center text-sm text-muted">Loading…</Card>}
          {roster?.coaches.map((c) => {
            const me = c.id === user.id;
            return (
              <Card key={c.id} className="space-y-3 p-4">
                <div className="flex items-start gap-3">
                  <Avatar name={c.name} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-bold">{c.name}</span>
                      <RoleBadge role={c.role === "OWNER" ? "OWNER" : "COACH"} />
                      {!c.active && <Badge className="border-danger/30 bg-danger/15 text-danger">Deactivated</Badge>}
                      {c.active && c.mustChangePassword && <Badge className="border-pr/30 bg-pr/15 text-pr">Awaiting first login</Badge>}
                    </div>
                    <div className="truncate text-sm text-muted">{c.email}</div>
                    <div className="mt-0.5 text-xs text-muted">Joined {format(parseISO(c.createdAt), "d MMM yyyy")}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="flex items-center justify-end gap-1.5 text-2xl font-bold tabular-nums">
                      <Users size={16} className="text-muted" /> {c.clientCount}
                    </div>
                    <div className="text-[11px] text-muted">{c.activeClientCount === c.clientCount ? "clients" : `clients · ${c.activeClientCount} active`}</div>
                  </div>
                </div>
                {me ? (
                  <div className="flex items-center gap-1.5 text-xs text-muted">
                    <ShieldCheck size={14} className="text-pr" /> This is you — you coach your own clients and manage the platform.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => message(c)} disabled={!c.active}>
                      <MessageSquare size={14} /> Message Coach
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setReset(c)}>
                      <KeyRound size={14} /> Reset password
                    </Button>
                    <Button size="sm" variant={c.active ? "danger" : "success"} onClick={() => setToggle(c)}>
                      <Power size={14} /> {c.active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </section>
      </>
      )}

      <AddCoachModal
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(i) => {
          setIssued(i);
          void load();
        }}
      />
      <BroadcastModal open={announce} onClose={() => setAnnounce(false)} count={roster ? roster.coaches.filter((c) => c.role === "COACH" && c.active).length : 0} />

      <ConfirmDialog
        open={!!toggle}
        onClose={() => setToggle(null)}
        danger={toggle?.active}
        title={toggle?.active ? `Deactivate ${toggle?.name}?` : `Reactivate ${toggle?.name}?`}
        message={toggle?.active ? "They will be signed out immediately and can't log in. Their clients keep their data and can still log in." : "They will be able to log in again with their existing password."}
        confirmLabel={toggle?.active ? "Deactivate" : "Reactivate"}
        onConfirm={async () => {
          if (!toggle) return;
          const r = await api(`/api/admin/coaches/${toggle.id}`, { method: "PATCH", body: { active: !toggle.active } });
          if (!r.ok) setError(r.error ?? "Could not update the coach.");
          await load();
        }}
      />
      <ConfirmDialog
        open={!!reset}
        onClose={() => setReset(null)}
        title={`Reset ${reset?.name}'s password?`}
        message="A new temporary password is generated, emailed to the coach, and shown to you once. They must choose their own at next login, and are signed out everywhere."
        confirmLabel="Reset password"
        onConfirm={async () => {
          if (!reset) return;
          const r = await api<{ temporaryPassword: string; email: { status: string; error?: string } }>(`/api/admin/coaches/${reset.id}/password`, { body: {} });
          if (!r.ok || !r.data) return setError(r.error ?? "Could not reset the password.");
          setIssued({ title: "Password reset", name: reset.name, email: reset.email, password: r.data.temporaryPassword, mail: r.data.email });
          await load();
        }}
      />
      <IssuedModal issued={issued} onClose={() => setIssued(null)} />
    </div>
  );
}

interface Bucket {
  total: number;
  verified: number;
  trial: number;
}
interface SignupOverview {
  coaches: Bucket;
  personal: Bucket;
  clients: Bucket;
  unverified: number;
  waitlist: number;
  days: { day: string; n: number }[];
  recent: { kind: "coach" | "personal" | "client"; verified: boolean; active: boolean; createdAt: string }[];
}

const KIND_LABEL = { coach: "Coach", personal: "Personal", client: "Coached client" } as const;

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

/** Counts and dates only — never names or emails. */
function SignupsPanel() {
  const [data, setData] = useState<SignupOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api<SignupOverview>("/api/admin/signups").then((r) => {
      if (!alive) return;
      if (r.ok && r.data) setData(r.data);
      else setError(r.error ?? "Could not load sign-ups.");
    });
    return () => {
      alive = false;
    };
  }, []);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Card className="p-6 text-center text-sm text-muted">Loading…</Card>;
  const max = Math.max(1, ...data.days.map((x) => x.n));
  const week = data.days.slice(-7).reduce((n, x) => n + x.n, 0);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Coaches" value={data.coaches.total} sub={`${data.coaches.verified} verified`} tone="accent" />
        <Stat label="Personal" value={data.personal.total} sub={`${data.personal.trial} on free trial`} />
        <Stat label="Coached clients" value={data.clients.total} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Last 7 days" value={week} sub="new accounts" tone="success" />
        <Stat label="Not verified" value={data.unverified} sub="Personal accounts waiting on the email link" />
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
      <section>
        <SectionTitle>Latest 25</SectionTitle>
        <div className="space-y-2">
          {data.recent.length === 0 && <Card className="p-6 text-center text-sm text-muted">No sign-ups yet.</Card>}
          {data.recent.map((r, i) => (
            <Card key={i} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{KIND_LABEL[r.kind]}</span>
                {!r.verified && <Badge className="border-pr/30 bg-pr/15 text-pr">Email not verified</Badge>}
                {!r.active && <Badge className="border-danger/30 bg-danger/15 text-danger">Closed</Badge>}
              </div>
              <span className="text-xs text-muted">{format(parseISO(r.createdAt), "d MMM yyyy, h:mm a")}</span>
            </Card>
          ))}
        </div>
      </section>
      <p className="text-xs text-muted">Only counts and dates are shown. Names, emails and training data stay private.</p>
    </div>
  );
}

function AddCoachModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (i: Issued) => void }) {
  return open ? <AddForm onClose={onClose} onCreated={onCreated} /> : null;
}

function AddForm({ onClose, onCreated }: { onClose: () => void; onCreated: (i: Issued) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title="Add coach"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !name.trim() || !email.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const r = await api<{ coach: { name: string; email: string }; temporaryPassword: string; email: { status: string; error?: string } }>("/api/admin/coaches", { body: { name, email } });
              setBusy(false);
              if (!r.ok || !r.data) return setError(r.error ?? "Could not add the coach.");
              onCreated({ title: "Coach added", name: r.data.coach.name, email: r.data.coach.email, password: r.data.temporaryPassword, mail: r.data.email });
              onClose();
            }}
          >
            {busy ? "Adding…" : "Add coach"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Display name" hint='e.g. "Coach Akash"'>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Email" hint="This is their login. A temporary password is emailed to this address.">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

function IssuedModal({ issued, onClose }: { issued: Issued | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!issued) return null;
  const sent = issued.mail.status === "sent";
  return (
    <Modal open onClose={onClose} title={issued.title} footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-4">
        <Notice tone={sent ? "success" : "warn"}>
          {sent ? `The login details were emailed to ${issued.email}.` : `The email could not be delivered${issued.mail.error ? ` (${issued.mail.error})` : ""}. Share the password below with ${issued.name} yourself.`}
        </Notice>
        <div className="space-y-2 rounded-xl border border-line bg-field p-4 font-mono text-sm">
          <div>
            <span className="text-muted">Username </span>
            {issued.email}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>
              <span className="text-muted">Temporary password </span>
              {issued.password}
            </span>
            <button
              aria-label="Copy password"
              onClick={async () => {
                await navigator.clipboard.writeText(issued.password).catch(() => undefined);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface text-muted hover:text-ink"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
        </div>
        <p className="text-xs text-muted">This is the only time the password is shown. They are asked to choose their own at first login.</p>
      </div>
    </Modal>
  );
}
