"use client";

import { format, parseISO } from "date-fns";
import { Check, Copy, KeyRound, Megaphone, MessageSquare, Plus, Power, ShieldCheck, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BroadcastModal } from "@/components/chat/BroadcastModal";
import { RoleBadge } from "@/components/chat/RoleBadge";
import { Avatar, Badge, Button, Card, ConfirmDialog, Field, Input, Modal, Notice, PageHeader, SectionTitle, Stat } from "@/components/ui";
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

  const load = useCallback(async () => {
    const r = await api<Roster>("/api/admin/coaches");
    if (r.ok && r.data) {
      setRoster(r.data);
      setError(null);
    } else setError(r.error ?? "Could not load coaches.");
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
