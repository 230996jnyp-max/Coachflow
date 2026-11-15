"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { GymActivity } from "@/components/gym/GymActivity";
import { GymHours } from "@/components/gym/GymHours";
import { GymOverview } from "@/components/gym/GymOverview";
import { GymRoles } from "@/components/gym/GymRoles";
import { GymSchedule } from "@/components/gym/GymSchedule";
import { GymSettingsPanel } from "@/components/gym/GymSettingsPanel";
import { GymTeam } from "@/components/gym/GymTeam";
import { can, type GymState } from "@/components/gym/types";
import { Card, Notice, PageHeader } from "@/components/ui";
import { hasPortalAccess } from "@/lib/gymPerms";
import { useViewer } from "@/lib/hooks";
import { mediaUrl } from "@/lib/prefs";
import { api } from "@/lib/store";
import { cn } from "@/lib/utils";

type Tab = "overview" | "schedule" | "hours" | "team" | "roles" | "settings" | "activity";

/** The gym portal: everything a gym owner or manager needs, shown according to the permissions of their role. */
export default function GymAdminPage() {
  const { user } = useViewer();
  const [state, setState] = useState<GymState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  const load = useCallback(async () => {
    const r = await api<GymState>("/api/gym");
    if (r.ok && r.data) {
      setState(r.data);
      setError(null);
    } else setError(r.error ?? "Could not load your gym.");
  }, []);

  useEffect(() => {
    let alive = true;
    api<GymState>("/api/gym").then((r) => {
      if (!alive) return;
      if (r.ok && r.data) setState(r.data);
      else setError(r.error ?? "Could not load your gym.");
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!user) return null;
  const g = state?.gym ?? user.gym ?? null;
  if (state && !hasPortalAccess(g)) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <PageHeader title="Gym" />
        <Card className="space-y-2 p-5 text-sm">
          {!g ? <p>You aren&apos;t part of a gym yet.</p> : g.status === "PENDING" ? <p>Your request to join {g.name} is waiting for approval.</p> : g.status === "DISABLED" ? <p>{g.name} has been switched off by an administrator. Your own coaching is not affected.</p> : <p>Your role in {g.name} doesn&apos;t include the gym portal.</p>}
          <Link href="/settings/coaching" className="font-semibold text-accent">
            Gym settings →
          </Link>
        </Card>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "overview", label: "Overview", show: true },
    { id: "schedule", label: "Schedule", show: can(g, "schedule.view") },
    { id: "hours", label: "Hours", show: can(g, "hours.view") },
    { id: "team", label: "Team", show: true },
    { id: "roles", label: "Roles", show: can(g, "roles.manage") },
    { id: "settings", label: "Settings", show: can(g, "branding.manage") || can(g, "coaches.manage") },
    { id: "activity", label: "Activity", show: can(g, "activity.view") },
  ];
  const logo = g ? mediaUrl(g.id, "logo", g.logoV) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={g?.name ?? "Gym"}
        subtitle={g ? `You are signed in as ${g.roleName}.` : undefined}
        actions={
          logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="h-12 w-12 rounded-xl border border-line bg-field object-contain p-1" />
          ) : undefined
        }
      />
      {error && <Notice tone="error">{error}</Notice>}

      <div role="tablist" aria-label="Gym sections" className="flex gap-1.5 overflow-x-auto pb-1">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.id}
              data-tour={`gym-tab-${t.id}`}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn("inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-semibold transition-colors", tab === t.id ? "border-accent bg-accent text-on-accent" : "border-line bg-field text-muted hover:text-ink")}
            >
              {t.label}
              {t.id === "team" && !!state?.overview?.pending && <span className="ml-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-bold text-white">{state.overview.pending}</span>}
            </button>
          ))}
      </div>

      {!state && !error && <Card className="p-6 text-center text-sm text-muted">Loading…</Card>}
      {state && g && state.settings && (
        <>
          {tab === "overview" && <GymOverview state={state} goTo={(t) => setTab(t as Tab)} />}
          {tab === "schedule" && <GymSchedule gym={g} />}
          {tab === "hours" && <GymHours />}
          {tab === "team" && <GymTeam gym={g} settings={state.settings} />}
          {tab === "roles" && <GymRoles editable={can(g, "roles.manage")} />}
          {tab === "settings" && <GymSettingsPanel gym={g} settings={state.settings} onChanged={() => void load()} />}
          {tab === "activity" && <GymActivity />}
        </>
      )}
    </div>
  );
}
