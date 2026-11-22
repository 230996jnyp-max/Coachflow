"use client";

import { useState } from "react";
import { Badge, Button, Field, Input, Modal, Notice, Textarea } from "@/components/ui";
import { planLabel, type GymPlanStatus } from "@/lib/gymBilling";
import { api } from "@/lib/store";

export interface GymRow {
  id: string;
  name: string;
  adminId: string;
  adminName: string;
  adminEmail: string;
  code: string;
  status: string;
  coaches: number;
  pending: number;
  aiUses: number;
  aiUses30d: number;
  createdAt: string;
  trialEndsAt: string | null;
  plan: { status: string; priceCents: number; custom: boolean; requested: boolean };
}


/** The gym's plan in a line, and where the platform owner sets a custom monthly price for a large gym (S$, empty = the flat price). */
export function GymPlanEditor({ gym, onSaved }: { gym: GymRow; onSaved: (text: string) => void }) {
  const [value, setValue] = useState(gym.plan.custom ? String(gym.plan.priceCents / 100) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    const r = await api<{ priceCents: number | null }>("/api/admin/gyms/" + gym.id + "/billing", { method: "PUT", body: { priceDollars: value.trim() === "" ? null : Number(value) } });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Could not save the price.");
    onSaved(value.trim() === "" ? gym.name + " is back on the flat price." : gym.name + " now pays S$" + value + " a month.");
  };
  return (
    <div className="space-y-2 rounded-xl border border-line bg-field/40 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Plan</span>
        <strong>{planLabel[gym.plan.status as GymPlanStatus] ?? gym.plan.status}</strong>
        <span className="text-muted">
          · S${gym.plan.priceCents / 100} a month{gym.plan.custom ? " (custom)" : ""}
        </span>
        {gym.plan.requested && <Badge className="border-pr/30 bg-pr/15 text-pr">Asked for a custom plan ({gym.coaches} coaches)</Badge>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted">
          Custom price (S$ a month)
          <Input className="mt-1 w-36" type="number" min={1} max={10000} step="1" placeholder="Flat price" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save price"}
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export type GymAction = "disable" | "enable" | "delete";

const COPY: Record<GymAction, { title: string; body: (g: GymRow) => string; button: string }> = {
  disable: { title: "Switch this gym off?", body: (g) => `${g.name}'s gym tools stop working and its code stops accepting new coaches. Coaches and clients keep their own accounts, and nothing is deleted. The gym's admin is emailed.`, button: "Switch off" },
  enable: { title: "Switch this gym back on?", body: (g) => `${g.name}'s gym tools work again. The gym's admin is emailed.`, button: "Switch on" },
  delete: { title: "Delete this gym for good?", body: (g) => `${g.name}, its roles, halls, history and gym code are erased. Its ${g.coaches} coach${g.coaches === 1 ? "" : "es"} keep their own accounts and clients and become independent. The gym's admin is emailed.`, button: "Delete gym" },
};

export function GymActionModal({ gym, action, onClose, onDone }: { gym: GymRow; action: GymAction; onClose: () => void; onDone: (text: string, tone: "success" | "warn") => void }) {
  const c = COPY[action];
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    const r = await api<{ email: string }>(`/api/admin/gyms/${gym.id}`, { body: { action, reason, confirmName: typed } });
    setBusy(false);
    if (!r.ok || !r.data) return setError(r.error ?? "That didn't work. Please try again.");
    const m = r.data.email;
    const mailed = m === "sent" ? "Its admin was emailed." : m === "preview" ? "Email composed (not sent: test mode)." : m === "skipped" ? "No email address on file." : "The email could not be sent.";
    onDone(`${action === "delete" ? "Deleted" : action === "disable" ? "Switched off" : "Switched on"}: ${gym.name}. ${mailed}`, m === "failed" ? "warn" : "success");
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
          <Button variant={action === "enable" ? "primary" : "danger"} disabled={busy || (action === "delete" && typed.trim().toLowerCase() !== gym.name.toLowerCase())} onClick={() => void run()}>
            {busy ? "Working…" : c.button}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">{c.body(gym)}</p>
        <Field label="Reason (optional)" hint="Included in the email.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} />
        </Field>
        {action === "delete" && (
          <Field label={`Type ${gym.name} to confirm`}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </Field>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
