"use client";

import { format, parseISO } from "date-fns";
import { Check, Copy, KeyRound, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Notice, SectionTitle } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { coachTitle } from "@/lib/signupRules";
import { api, refreshAccounts, refreshGroups, refreshSchedule } from "@/lib/store";

interface LinkRequest {
  id: string;
  clientId: string;
  name: string;
  goal: string;
  level: string;
  requestedAt: string;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A coach's six-digit code, with a one-tap copy so they can share it with clients. */
export function CoachCodeCard({ compact = false }: { compact?: boolean }) {
  const { user } = useViewer();
  const [copied, setCopied] = useState(false);
  const code = user?.coachCode;
  if (!code) return null;
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  return (
    <Card className={compact ? "flex items-center gap-3 p-3" : "flex flex-wrap items-center gap-4 p-4"} data-tour="coach-code">
      <KeyRound size={20} className="shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-bold uppercase tracking-wider text-muted">Your coach code</div>
        <div className="font-mono text-2xl font-bold tracking-[0.2em]" aria-label={`Coach code ${code.split("").join(" ")}`}>
          {spaced}
        </div>
        {!compact && <div className="text-xs text-muted">Give this to a client. They type it when they sign up, or in their Profile, and you accept them.</div>}
      </div>
      <Button
        variant="secondary"
        onClick={async () => {
          if (await copy(code)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }
        }}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy My Coach Code"}
      </Button>
    </Card>
  );
}

/** The people who asked to train with this coach (Accept / Decline). Shows nothing when nobody is waiting. */
export function LinkRequests() {
  const { isTrainer } = useViewer();
  const [list, setList] = useState<LinkRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ requests: LinkRequest[] }>("/api/coach-link");
    if (r.ok && r.data) setList(r.data.requests);
  }, []);

  useEffect(() => {
    if (!isTrainer) return;
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [isTrainer, load]);

  if (!isTrainer || list.length === 0) return null;

  const answer = async (id: string, decision: "accept" | "decline") => {
    setBusy(id);
    setError(null);
    const r = await api<{ requests: LinkRequest[] }>(`/api/coach-link/${id}`, { method: "PATCH", body: { decision } });
    setBusy(null);
    if (!r.ok) {
      setError(r.error ?? "Couldn't save your answer.");
      void load();
      return;
    }
    setList(r.data?.requests ?? []);
    if (decision === "accept") await Promise.all([refreshAccounts(), refreshSchedule(), refreshGroups()]);
  };

  return (
    <section data-tour="coach-requests">
      <SectionTitle>
        <span className="inline-flex items-center gap-2">
          <UserPlus size={16} className="text-accent" /> New client requests ({list.length})
        </span>
      </SectionTitle>
      {error && (
        <div className="mb-2">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <div className="space-y-2">
        {list.map((r) => (
          <Card key={r.id} className="flex flex-wrap items-center gap-3 border-accent/40 bg-accent-dim/30 p-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{r.name}</div>
              <div className="text-xs text-muted">
                {[r.goal, r.level].filter(Boolean).join(" · ")} · asked {format(parseISO(r.requestedAt), "d MMM, h:mm a")}
              </div>
            </div>
            <Button variant="success" size="sm" disabled={busy === r.id} onClick={() => void answer(r.id, "accept")} aria-label={`Accept ${r.name}`}>
              <Check size={16} /> Accept
            </Button>
            <Button variant="ghost" size="sm" disabled={busy === r.id} onClick={() => void answer(r.id, "decline")} aria-label={`Decline ${r.name}`}>
              <X size={16} /> Decline
            </Button>
          </Card>
        ))}
      </div>
    </section>
  );
}

/** For someone training on their own: "Have a coach? Enter their 6-digit code". Shows the request while it waits. */
export function HaveACoachCard() {
  const { isPersonal } = useViewer();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<{ id: string; coachName: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPersonal) return;
    const t = setTimeout(() => void api<{ pending: { id: string; coachName: string } | null }>("/api/coach-link").then((r) => r.ok && setPending(r.data?.pending ?? null)), 0);
    return () => clearTimeout(t);
  }, [isPersonal]);

  if (!isPersonal) return null;

  const send = async () => {
    setBusy(true);
    setError(null);
    const r = await api<{ pending: { id: string; coachName: string } | null }>("/api/coach-link", { body: { code } });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Couldn't send the request.");
    setPending(r.data?.pending ?? null);
    setCode("");
  };
  const cancel = async () => {
    setBusy(true);
    await api("/api/coach-link", { method: "DELETE" });
    setBusy(false);
    setPending(null);
  };

  return (
    <section>
      <SectionTitle>Have a coach?</SectionTitle>
      <Card className="space-y-3 p-5">
        {pending ? (
          <>
            <Notice tone="info">Waiting for {coachTitle(pending.coachName)} to accept you. Nothing of yours is shared until they do. You can keep training in the meantime.</Notice>
            <Button variant="secondary" onClick={cancel} disabled={busy}>
              Cancel request
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">If you&apos;ve hired a coach on CoachFlow, enter their 6-digit code. Once they accept you, you can book sessions and chat with them.</p>
            <div className="flex gap-2">
              <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="123456" maxLength={6} className="text-center font-mono tracking-[0.3em]" aria-label="Coach code" />
              <Button onClick={send} disabled={busy || code.length !== 6}>
                Ask
              </Button>
            </div>
            {error && <Notice tone="error">{error}</Notice>}
          </>
        )}
      </Card>
    </section>
  );
}
