"use client";

import { format, parseISO } from "date-fns";
import { useCallback, useEffect, useState } from "react";
import { Badge, Stat, Toggle } from "@/components/ui";
import { sgd, type BillingStatus } from "@/lib/billing";
import { api } from "@/lib/store";

export interface BillingLine {
  coachId: string;
  name: string;
  email: string;
  role: "OWNER" | "COACH";
  status: BillingStatus;
  exempt: boolean;
  activeClients: number;
  tierCents: number;
  renewsOn: string | null;
  trialDaysLeft: number;
  hasSubscription: boolean;
}

export interface BillingOverview {
  coaches: BillingLine[];
  totals: { subscribed: number; trials: number; mrrCents: number };
}

/** The owner's billing numbers, with a way to reload after a change. */
export function useBillingOverview(): { data: BillingOverview | null; reload: () => Promise<void>; error: string | null } {
  const [data, setData] = useState<BillingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const r = await api<BillingOverview>("/api/admin/billing");
    if (r.ok && r.data) {
      setData(r.data);
      setError(null);
    } else setError(r.error ?? "Could not load billing.");
  }, []);
  useEffect(() => {
    let alive = true;
    api<BillingOverview>("/api/admin/billing").then((r) => {
      if (!alive) return;
      if (r.ok && r.data) setData(r.data);
      else setError(r.error ?? "Could not load billing.");
    });
    return () => {
      alive = false;
    };
  }, []);
  return { data, reload, error };
}

/** Subscribed coaches, active trials and monthly recurring revenue. */
export function BillingStats({ data }: { data: BillingOverview | null }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <Stat label="Subscribed" value={data?.totals.subscribed ?? "—"} tone="success" sub="coaches" />
      <Stat label="Active trials" value={data?.totals.trials ?? "—"} tone="accent" sub="free 30 days" />
      <Stat label="MRR" value={data ? sgd(data.totals.mrrCents) : "—"} tone="pr" sub="per month (before GST)" />
    </div>
  );
}

const STATUS: Record<BillingStatus, { text: string; cls: string }> = {
  LIFETIME_FREE: { text: "Lifetime free", cls: "border-success/30 bg-success/15 text-success" },
  TRIALING: { text: "Trial", cls: "border-accent/30 bg-accent/15 text-accent" },
  ACTIVE: { text: "Subscribed", cls: "border-success/30 bg-success/15 text-success" },
  PAST_DUE: { text: "Payment failed", cls: "border-danger/30 bg-danger/15 text-danger" },
  CANCELED: { text: "Cancelled", cls: "border-danger/30 bg-danger/15 text-danger" },
  EXPIRED: { text: "Trial ended", cls: "border-danger/30 bg-danger/15 text-danger" },
};

/** One coach's plan, tier and renewal, and the "Exempt / Beta Lifetime Access" switch (not for the owner, who is always exempt). */
export function CoachBillingLine({ line, onChanged }: { line: BillingLine | undefined; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!line) return null;
  const st = STATUS[line.status];
  return (
    <div className="space-y-1 border-t border-line pt-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={st.cls}>{st.text}</Badge>
        {!line.exempt && (
          <span className="text-muted">
            {sgd(line.tierCents)}/mo · {line.activeClients} active client{line.activeClients === 1 ? "" : "s"}
            {line.status === "TRIALING" && !line.hasSubscription ? ` · ${line.trialDaysLeft} trial day${line.trialDaysLeft === 1 ? "" : "s"} left` : ""}
            {line.renewsOn && line.hasSubscription ? ` · renews ${format(parseISO(line.renewsOn), "d MMM yyyy")}` : ""}
          </span>
        )}
      </div>
      {line.role === "COACH" && (
        <Toggle
          checked={line.exempt}
          label="Exempt / Beta Lifetime Access"
          onChange={async (v) => {
            if (busy) return;
            setBusy(true);
            setError(null);
            const r = await api(`/api/admin/billing/${line.coachId}`, { body: { exempt: v } });
            setBusy(false);
            if (!r.ok) setError(r.error ?? "Could not change it.");
            onChanged();
          }}
        />
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
