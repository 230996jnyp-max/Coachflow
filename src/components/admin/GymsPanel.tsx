"use client";

import { format, parseISO } from "date-fns";
import { Copy, Power, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Field, Input, Modal, Notice, SectionTitle, Textarea } from "@/components/ui";
import { api } from "@/lib/store";

interface GymRow {
  id: string;
  name: string;
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

type Action = "disable" | "enable" | "delete";

/** Every gym: its admin, its 6-digit code, how many coaches are linked and how much AI it uses. No client counts, ever. */
export function GymsPanel() {
  const [gyms, setGyms] = useState<GymRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [act, setAct] = useState<{ gym: GymRow; action: Action } | null>(null);
  const [flash, setFlash] = useState<{ tone: "success" | "warn"; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ gyms: GymRow[] }>("/api/admin/gyms");
    if (r.ok && r.data) {
      setGyms(r.data.gyms);
      setError(null);
    } else setError(r.error ?? "Could not load gyms.");
  }, []);

  useEffect(() => {
    let alive = true;
    api<{ gyms: GymRow[] }>("/api/admin/gyms").then((r) => {
      if (!alive) return;
      if (r.ok && r.data) setGyms(r.data.gyms);
      else setError(r.error ?? "Could not load gyms.");
    });
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!gyms) return <Card className="p-6 text-center text-sm text-muted">Loading…</Card>;

  return (
    <div className="space-y-4">
      <SectionTitle>Gyms and academies</SectionTitle>
      {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}
      {gyms.length === 0 && <Card className="p-6 text-center text-sm text-muted">No gyms yet. They appear here when someone signs up with the Gym card.</Card>}
      <div className="space-y-2">
        {gyms.map((g) => (
          <Card key={g.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-bold">{g.name}</span>
              {g.status === "DISABLED" && <Badge className="border-danger/30 bg-danger/15 text-danger">Switched off</Badge>}
              {g.pending > 0 && <Badge className="border-pr/30 bg-pr/15 text-pr">{g.pending} waiting</Badge>}
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
            <div className="flex flex-wrap gap-2">
              {g.status === "DISABLED" ? (
                <Button size="sm" variant="success" onClick={() => setAct({ gym: g, action: "enable" })}>
                  <Power size={14} /> Switch on
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setAct({ gym: g, action: "disable" })}>
                  <Power size={14} /> Switch off
                </Button>
              )}
              <Button size="sm" variant="danger" onClick={() => setAct({ gym: g, action: "delete" })}>
                <Trash2 size={14} /> Delete…
              </Button>
            </div>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted">Only coach counts and AI use are shown. Client names and counts stay private to each coach.</p>

      {act && (
        <GymActionModal
          gym={act.gym}
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

const COPY: Record<Action, { title: string; body: (g: GymRow) => string; button: string }> = {
  disable: { title: "Switch this gym off?", body: (g) => `${g.name}'s gym tools stop working and its code stops accepting new coaches. Coaches and clients keep their own accounts, and nothing is deleted. The gym's admin is emailed.`, button: "Switch off" },
  enable: { title: "Switch this gym back on?", body: (g) => `${g.name}'s gym tools work again. The gym's admin is emailed.`, button: "Switch on" },
  delete: { title: "Delete this gym for good?", body: (g) => `${g.name}, its roles, halls, history and gym code are erased. Its ${g.coaches} coach${g.coaches === 1 ? "" : "es"} keep their own accounts and clients and become independent. The gym's admin is emailed.`, button: "Delete gym" },
};

function GymActionModal({ gym, action, onClose, onDone }: { gym: GymRow; action: Action; onClose: () => void; onDone: (text: string, tone: "success" | "warn") => void }) {
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
