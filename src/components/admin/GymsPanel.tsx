"use client";

import { useState } from "react";
import { Button, Field, Input, Modal, Notice, Textarea } from "@/components/ui";
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
