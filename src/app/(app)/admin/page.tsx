"use client";

import { Megaphone, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AddUserModal, IssuedModal, type CoachRow, type Issued, type Roster } from "@/components/admin/AddUserModal";
import { useBillingOverview } from "@/components/admin/BillingAdmin";
import { PendingApprovals } from "@/components/admin/PendingApprovals";
import { AiReviewsPanel } from "@/components/admin/AiReviewsPanel";
import { AiUsagePanel } from "@/components/admin/AiUsagePanel";
import { ConsultsPanel } from "@/components/admin/ConsultsPanel";
import { UsersPanel } from "@/components/admin/UsersPanel";
import { BroadcastModal } from "@/components/chat/BroadcastModal";
import { Button, ConfirmDialog, Notice, PageHeader } from "@/components/ui";
import { refreshPendingCount, usePendingCoachRequests } from "@/lib/adminPending";
import { coachThread, requestThread } from "@/lib/chat";
import { useViewer } from "@/lib/hooks";
import { api } from "@/lib/store";

type Tab = "users" | "consults" | "ai" | "reviews" | "pending";

export default function AdminPage() {
  const { user } = useViewer();
  const router = useRouter();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [announce, setAnnounce] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [reset, setReset] = useState<CoachRow | null>(null);
  const [version, setVersion] = useState(0);
  // Notifications about a consult report open this page with ?tab=consults.
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return new URLSearchParams(window.location.search).get("tab") === "consults" ? "consults" : "users";
    } catch {
      return "users";
    }
  });
  const pending = usePendingCoachRequests();
  const billing = useBillingOverview();

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

  // Coaches now sign themselves up. The approvals tab only appears while a request from before that is still waiting.
  const tabs: [Tab, string][] = [
    ["users", "Users"],
    ["consults", "Consults"],
    ["ai", "AI usage"],
    ["reviews", "AI reviews"],
    ...(pending > 0 || tab === "pending" ? ([["pending", "Earlier requests"]] as [Tab, string][]) : []),
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Administrator"
        subtitle="Everyone on CoachFlow in one place. Client details stay private to each coach — only names and contact details are shown here, never training data."
        actions={
          <>
            <Button variant="secondary" onClick={() => setAnnounce(true)} disabled={!roster || roster.coaches.length < 2}>
              <Megaphone size={16} /> Announce
            </Button>
            <Button onClick={() => setAdding(true)} data-tour="admin-add-user">
              <Plus size={16} /> Add user
            </Button>
          </>
        }
      />

      {error && <Notice tone="error">{error}</Notice>}

      <div role="tablist" aria-label="Administrator sections" className="flex gap-1.5">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            data-tour={`admin-tab-${key}`}
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
      {tab === "users" && (
        <UsersPanel
          roster={roster}
          billing={billing.data}
          billingReload={() => void billing.reload()}
          version={version}
          meId={user.id}
          onChanged={() => void load()}
          onMessage={message}
          onReset={setReset}
        />
      )}
      {tab === "consults" && <ConsultsPanel />}
      {tab === "ai" && <AiUsagePanel />}
      {tab === "reviews" && <AiReviewsPanel />}

      <AddUserModal
        open={adding}
        onClose={() => setAdding(false)}
        coaches={roster?.coaches ?? []}
        onCreated={(i) => {
          setIssued(i);
          void load();
          setVersion((v) => v + 1);
          void billing.reload();
        }}
      />
      <BroadcastModal open={announce} onClose={() => setAnnounce(false)} count={roster ? roster.coaches.filter((c) => c.role === "COACH" && c.active).length : 0} />

      <ConfirmDialog
        open={!!reset}
        onClose={() => setReset(null)}
        title={`Set a temporary password for ${reset?.name}?`}
        message="A new temporary password is generated, emailed to the coach, and shown to you once. They must choose their own at next login, and are signed out everywhere."
        confirmLabel="Set temporary password"
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
