"use client";

import { Building2, Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, Card, ConfirmDialog, Field, Input, Notice } from "@/components/ui";
import { cleanGymCode, hasPortalAccess } from "@/lib/gymPerms";
import { useViewer } from "@/lib/hooks";
import { mediaUrl } from "@/lib/prefs";
import { api, refreshAccounts } from "@/lib/store";

/** Settings → Coaching: link your account to a gym or academy with its 6-digit code, or leave it and go independent. */
export function GymAffiliation() {
  const { user } = useViewer();
  const [code, setCode] = useState("");
  const [found, setFound] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "warn"; text: string } | null>(null);
  const [leave, setLeave] = useState(false);
  if (!user) return null;
  const g = user.gym;

  const onCode = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    setFound(null);
    setLookupError(null);
    if (cleanGymCode(digits)) {
      void api<{ name: string }>("/api/signup/gym-code", { body: { code: digits } }).then((r) => {
        if (r.ok && r.data) setFound(r.data.name);
        else setLookupError(r.error ?? "We couldn't find a gym with that code.");
      });
    }
  };

  const join = async () => {
    setBusy(true);
    setMsg(null);
    const r = await api<{ status: string; gymName: string }>("/api/gym/join", { body: { code } });
    setBusy(false);
    if (!r.ok || !r.data) return setMsg({ tone: "error", text: r.error ?? "That didn't work." });
    setMsg({ tone: "success", text: r.data.status === "ACTIVE" ? `You are now part of ${r.data.gymName}.` : `Request sent. ${r.data.gymName} will approve you.` });
    setCode("");
    setFound(null);
    await refreshAccounts();
  };

  const leaveNow = async () => {
    const r = await api("/api/gym/join", { method: "DELETE" });
    if (!r.ok) setMsg({ tone: "error", text: r.error ?? "That didn't work." });
    else setMsg({ tone: "success", text: "You now coach independently." });
    await refreshAccounts();
  };

  const logo = g ? mediaUrl(g.id, "logo", g.logoV) : null;

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-bold">Gym or academy</h2>
        <p className="mt-0.5 text-xs text-muted">Working with a gym or coaching academy? Enter its 6-digit gym code. Leave it blank if you are an independent coach.</p>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      {g ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-xl border border-line bg-field p-3">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="h-11 w-11 rounded-lg bg-surface object-contain p-1" />
            ) : (
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-surface text-accent">
                <Building2 size={20} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{g.name}</div>
              <div className="text-xs text-muted">{g.status === "PENDING" ? "Waiting for the gym to approve you" : g.status === "DISABLED" ? "Switched off by an administrator" : `Your role: ${g.roleName}`}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {hasPortalAccess(g) && (
              <Link href="/gym-admin">
                <Button variant="secondary">Open the gym portal</Button>
              </Link>
            )}
            {g.isOwner ? <span className="text-xs text-muted">You own this gym.</span> : (
              <Button variant="danger" onClick={() => (g.status === "PENDING" ? void leaveNow() : setLeave(true))}>
                {g.status === "PENDING" ? "Withdraw my request" : "Leave this gym"}
              </Button>
            )}
          </div>
          {g.status === "ACTIVE" && !g.isOwner && <p className="text-xs text-muted">Your gym can see your schedule and your completed hours. Your clients and their data stay yours.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Gym code (optional)" hint={lookupError ?? undefined} error={lookupError}>
            <Input value={code} onChange={(e) => onCode(e.target.value)} inputMode="numeric" placeholder="6 digits" maxLength={6} className="font-mono tracking-widest" />
          </Field>
          {found && (
            <>
              <div className="flex items-center gap-2 text-sm font-semibold text-success">
                <Check size={16} /> Linked to {found}
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>I understand {found} will see my schedule and my completed hours. My clients and their data stay mine.</span>
              </label>
              <Button disabled={!agree || busy} onClick={() => void join()}>
                {busy ? "Linking…" : "Link my account"}
              </Button>
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={leave}
        onClose={() => setLeave(false)}
        danger
        title="Leave this gym?"
        message="You go back to coaching independently. You keep your account, your clients and everything you set up. The gym is told."
        confirmLabel="Leave"
        onConfirm={leaveNow}
      />
    </Card>
  );
}
