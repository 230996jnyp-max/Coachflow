"use client";

import { format, formatDistanceToNowStrict, parseISO } from "date-fns";
import { ChevronDown, KeyRound, MailCheck, Power, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, Field, Input, Modal, Notice, Textarea } from "@/components/ui";
import { api } from "@/lib/store";

export interface Bucket {
  total: number;
  verified: number;
  trial: number;
}
export type Kind = "coach" | "personal" | "client";
export interface Person {
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
  coachId?: string;
  mustChangePassword?: boolean;
  clientCount?: number;
  niches?: string[];
  coachCode?: string;
}
export interface Overview {
  coaches: Bucket;
  personal: Bucket;
  clients: Bucket;
  unverified: number;
  waitlist: number;
  days: { day: string; n: number }[];
  people: Person[];
  actions: { id: string; action: string; target: string; reason: string; at: string }[];
}
export type Action = "disable" | "enable" | "delete" | "resend_verification" | "force_reset";

export const KIND_LABEL: Record<Kind, string> = { coach: "Coach", personal: "Solo", client: "Client" };
export const ACTION_LABEL: Record<string, string> = { disable: "Disabled", enable: "Re-enabled", delete: "Deleted", resend_verification: "Resent confirmation", force_reset: "Forced password reset", gym_disable: "Switched off", gym_enable: "Switched on", gym_delete: "Deleted gym" };

/** People who asked to hear when the AI personal trainer is ready. The addresses are fetched only when the owner asks to copy them. */
export function WaitlistRow({ count }: { count: number }) {
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

const detailRow = "flex justify-between gap-3 py-1.5 text-sm";
const detailKey = "shrink-0 text-muted";

/** The contact and account details of one person (never training data). */
export function PersonDetails({ p }: { p: Person }) {
  const row = detailRow;
  const k = detailKey;
  return (
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
    {p.kind === "personal" && !p.trialEndsAt && <div className={row}><span className={k}>Payment</span><span>Exempt (no trial end)</span></div>}
    {p.kind === "client" && <div className={row}><span className={k}>Coach</span><span>{p.coachName}</span></div>}
    {p.kind === "coach" && (
      <>
        <div className={row}><span className={k}>Clients</span><span>{p.clientCount ?? 0}</span></div>
        <div className={row}><span className={k}>Coach code</span><span className="font-mono">{p.coachCode ?? "—"}</span></div>
        <div className={row}><span className={k}>Niches</span><span className="text-right">{p.niches?.length ? p.niches.join(", ") : "Not chosen yet"}</span></div>
      </>
    )}
  </div>
  );
}

/** What the owner can do to one account. */
export function PersonActions({ p, onAct, extra }: { p: Person; onAct: (a: Action) => void; extra?: React.ReactNode }) {
  return (
  <div className="flex flex-wrap gap-2">
    {extra}
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
  );
}

export function PersonCard({ p, open, onToggle, onAct }: { p: Person; open: boolean; onToggle: () => void; onAct: (a: Action) => void }) {
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
          {p.kind === "client" && p.coachName && <div className="truncate text-xs text-muted">Coach: {p.coachName}</div>}
          <div className="text-xs text-muted">Joined {format(parseISO(p.createdAt), "d MMM yyyy")}</div>
        </div>
        <ChevronDown size={18} className={`mt-1 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-4 pb-4 pt-3">
          <PersonDetails p={p} />
          <PersonActions p={p} onAct={onAct} />
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

export function ActionModal({ person, action, onClose, onDone }: { person: Person; action: Action; onClose: () => void; onDone: (text: string, tone: "success" | "warn") => void }) {
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
