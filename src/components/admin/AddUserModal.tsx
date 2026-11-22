"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button, Field, Input, Modal, Notice, Segmented, Select, Toggle } from "@/components/ui";
import { api } from "@/lib/store";

export interface CoachRow {
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

export interface Roster {
  coaches: CoachRow[];
  totals: { coaches: number; activeCoaches: number; clients: number };
}

export interface Issued {
  title: string;
  name: string;
  email: string;
  password: string;
  mail: { status: string; error?: string };
}

type Kind = "coach" | "gym" | "solo" | "client";

const KINDS: { value: Kind; label: string; hint: string }[] = [
  { value: "coach", label: "Coach", hint: "A personal trainer with their own clients." },
  { value: "gym", label: "Gym", hint: "A gym or academy: its admin logs in and runs the gym portal." },
  { value: "solo", label: "Solo user", hint: "Someone training on their own, without a coach." },
  { value: "client", label: "Client", hint: "A client of one of the coaches below. Their coach's plan covers them." },
];

/** The short form for adding anyone: what they are, a name and an email, and whether they are exempt from payment. */
export function AddUserModal({ open, onClose, coaches, onCreated }: { open: boolean; onClose: () => void; coaches: CoachRow[]; onCreated: (i: Issued) => void }) {
  return open ? <Form onClose={onClose} coaches={coaches} onCreated={onCreated} /> : null;
}

function Form({ onClose, coaches, onCreated }: { onClose: () => void; coaches: CoachRow[]; onCreated: (i: Issued) => void }) {
  const [kind, setKind] = useState<Kind>("coach");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [gymName, setGymName] = useState("");
  const [coachId, setCoachId] = useState("");
  // People the owner adds are usually testers and friends, so the switch starts on.
  const [exempt, setExempt] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = coaches.filter((c) => c.active);
  const hint = KINDS.find((k) => k.value === kind)!.hint;
  const ready = !!name.trim() && !!email.trim() && (kind !== "gym" || !!gymName.trim()) && (kind !== "client" || !!coachId);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await api<{ name: string; email: string; temporaryPassword: string; mail: { status: string; error?: string }; kind: Kind }>("/api/admin/users", {
      body: { kind, name, email, exempt, ...(kind === "gym" ? { gymName } : {}), ...(kind === "client" ? { coachId } : {}) },
    });
    setBusy(false);
    if (!r.ok || !r.data) return setError(r.error ?? "Could not add that user.");
    onCreated({ title: `${KINDS.find((k) => k.value === kind)!.label} added`, name: r.data.name, email: r.data.email, password: r.data.temporaryPassword, mail: r.data.mail });
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add user"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !ready} onClick={() => void submit()}>
            {busy ? "Adding…" : "Add user"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k.value, label: k.label }))} />
        <p className="text-sm text-muted">{hint}</p>
        <Field label={kind === "gym" ? "Contact name" : "Name"} hint={kind === "coach" ? 'e.g. "Coach Akash"' : undefined}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        {kind === "gym" && (
          <Field label="Gym name">
            <Input value={gymName} onChange={(e) => setGymName(e.target.value)} />
          </Field>
        )}
        <Field label="Email" hint="This is their login. A temporary password is emailed to this address.">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" />
        </Field>
        {kind === "client" && (
          <Field label="Their coach">
            <Select value={coachId} onChange={(e) => setCoachId(e.target.value)} aria-label="Their coach">
              <option value="">Choose a coach…</option>
              {active.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.role === "OWNER" ? " (you)" : ""}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {kind !== "client" && (
          <div className="space-y-1">
            <Toggle checked={exempt} onChange={setExempt} label="Exempt from payment" />
            <p className="text-xs text-muted">{exempt ? "No free month that ends and no subscription is ever asked for." : "They get the usual 30-day free month, then pay like anyone who signed up themselves."}</p>
          </div>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

/** Shows the login details of a new or reset account once. */
export function IssuedModal({ issued, onClose }: { issued: Issued | null; onClose: () => void }) {
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
