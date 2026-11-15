"use client";

import { format, formatDistanceToNowStrict, parseISO } from "date-fns";
import { Check, Mail, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, ConfirmDialog, Field, Input, Notice, SectionTitle, Select } from "@/components/ui";
import type { GymInfo } from "@/lib/gymPerms";
import { api } from "@/lib/store";
import { can, type GymSettingsData, type RoleData, type TeamPerson } from "./types";

interface TeamData {
  people: TeamPerson[];
  invites: { id: string; email: string; roleName: string; createdAt: string }[];
}

/** The people in the gym: requests to approve, members with their role, hall and hourly rate, and invitations by email. */
export function GymTeam({ gym, settings }: { gym: GymInfo; settings: GymSettingsData }) {
  const [team, setTeam] = useState<TeamData | null>(null);
  const [roles, setRoles] = useState<RoleData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ tone: "success" | "warn"; text: string } | null>(null);
  const [remove, setRemove] = useState<TeamPerson | null>(null);
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState("");
  const [busy, setBusy] = useState(false);
  // The role picked on each waiting request (the one they asked with is the default).
  const [roleSel, setRoleSel] = useState<Record<string, string>>({});
  const manage = can(gym, "coaches.manage");
  const canRoles = can(gym, "roles.manage");

  const load = useCallback(async () => {
    const [t, r] = await Promise.all([api<TeamData>("/api/gym/team"), api<{ roles: RoleData[] }>("/api/gym/roles")]);
    if (t.ok && t.data) setTeam(t.data);
    else setError(t.error ?? "Could not load the team.");
    if (r.ok && r.data) {
      setRoles(r.data.roles);
      setInvRole((cur) => cur || (r.data!.roles.find((x) => x.name === "Coach") ?? r.data!.roles.find((x) => !x.locked))?.id || "");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([api<TeamData>("/api/gym/team"), api<{ roles: RoleData[] }>("/api/gym/roles")]).then(([t, r]) => {
      if (!alive) return;
      if (t.ok && t.data) setTeam(t.data);
      else setError(t.error ?? "Could not load the team.");
      if (r.ok && r.data) {
        setRoles(r.data.roles);
        setInvRole((cur) => cur || (r.data!.roles.find((x) => x.name === "Coach") ?? r.data!.roles.find((x) => !x.locked))?.id || "");
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const post = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const r = await api<{ status?: string }>("/api/gym/team", { body });
    setBusy(false);
    if (!r.ok) return setFlash({ tone: "warn", text: r.error ?? "That didn't work." });
    setFlash({ tone: "success", text: ok });
    await load();
    return r;
  };

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!team) return <Card className="p-6 text-center text-sm text-muted">Loading…</Card>;
  const pending = team.people.filter((p) => p.status === "PENDING");
  const active = team.people.filter((p) => p.status === "ACTIVE");
  const assignable = roles.filter((r) => !r.locked);

  return (
    <div className="space-y-6">
      {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}

      {pending.length > 0 && (
        <section>
          <SectionTitle>Waiting for you</SectionTitle>
          <div className="space-y-2">
            {pending.map((p) => (
              <Card key={p.userId} className="flex flex-wrap items-center gap-3 border-pr/30 p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{p.name}</div>
                  <div className="truncate text-xs text-muted">
                    {p.email} · asked {format(parseISO(p.requestedAt), "d MMM")}
                  </div>
                </div>
                {manage && (
                  <>
                    <Select aria-label={`Role for ${p.name}`} value={roleSel[p.userId] ?? p.roleId} onChange={(e) => setRoleSel((s) => ({ ...s, [p.userId]: e.target.value }))} className="w-40">
                      {assignable.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </Select>
                    <Button size="sm" variant="success" disabled={busy} onClick={() => void post({ action: "approve", userId: p.userId, roleId: roleSel[p.userId] ?? p.roleId }, `${p.name} is in.`)}>
                      <Check size={14} /> Approve
                    </Button>
                    <Button size="sm" variant="danger" disabled={busy} onClick={() => void post({ action: "decline", userId: p.userId }, `${p.name} was declined.`)}>
                      <X size={14} /> Decline
                    </Button>
                  </>
                )}
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle>People in your gym</SectionTitle>
        <div className="space-y-2">
          {active.map((p) => (
            <MemberCard key={p.userId} p={p} roles={assignable} settings={settings} manage={manage} canRoles={canRoles} showRate={p.rateCents !== null || manage} onSave={(body, text) => post({ action: "set_details", userId: p.userId, ...body }, text)} onRole={(roleId) => post({ action: "set_role", userId: p.userId, roleId }, `${p.name} is now ${roles.find((r) => r.id === roleId)?.name}.`)} onRemove={() => setRemove(p)} />
          ))}
        </div>
      </section>

      {manage && (
        <section>
          <SectionTitle>Invite by email</SectionTitle>
          <Card className="space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
              <Field label="Email">
                <Input type="email" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} placeholder="coach@example.com" autoCapitalize="none" />
              </Field>
              <Field label="Role">
                <Select value={invRole} onChange={(e) => setInvRole(e.target.value)}>
                  {assignable.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                disabled={busy || !invEmail.includes("@") || !invRole}
                onClick={async () => {
                  const r = await post({ action: "invite", email: invEmail, roleId: invRole }, `Invitation sent to ${invEmail}.`);
                  if (r) setInvEmail("");
                }}
              >
                <Mail size={16} /> Send invite
              </Button>
            </div>
            <p className="text-xs text-muted">They get your gym code and a sign-up link with it filled in. Someone invited by email joins straight away with that role, with no waiting for approval.</p>
            {team.invites.length > 0 && (
              <div className="divide-y divide-line rounded-xl border border-line">
                {team.invites.map((i) => (
                  <div key={i.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">
                      {i.email} <span className="text-muted">as {i.roleName}</span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => void post({ action: "cancel_invite", inviteId: i.id }, "Invitation cancelled.")}>
                      Cancel
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section>
      )}

      <ConfirmDialog
        open={!!remove}
        onClose={() => setRemove(null)}
        danger
        title={`Remove ${remove?.name}?`}
        message="They leave your gym and keep their account and their own clients. You will no longer see their schedule or hours. They are told."
        confirmLabel="Remove"
        onConfirm={async () => {
          if (remove) await post({ action: "remove", userId: remove.userId }, `${remove.name} was removed.`);
        }}
      />
    </div>
  );
}

function MemberCard({
  p,
  roles,
  settings,
  manage,
  canRoles,
  showRate,
  onSave,
  onRole,
  onRemove,
}: {
  p: TeamPerson;
  roles: RoleData[];
  settings: GymSettingsData;
  manage: boolean;
  canRoles: boolean;
  showRate: boolean;
  onSave: (body: Record<string, unknown>, text: string) => Promise<unknown>;
  onRole: (roleId: string) => Promise<unknown>;
  onRemove: () => void;
}) {
  const [rate, setRate] = useState(p.rateCents === null ? "" : (p.rateCents / 100).toString());
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{p.name}</span>
        {p.isOwner ? <Badge className="border-accent/30 bg-accent/15 text-accent">Owner</Badge> : <Badge>{p.roleName}</Badge>}
        <span className="truncate text-xs text-muted">{p.email}</span>
      </div>
      <div className="text-xs text-muted">
        {p.niches.length ? p.niches.join(", ") : "No niche yet"} · {p.joinedAt ? `joined ${format(parseISO(p.joinedAt), "d MMM yyyy")}` : ""} · {p.lastLoginAt ? `last active ${formatDistanceToNowStrict(parseISO(p.lastLoginAt))} ago` : "not signed in yet"}
      </div>
      {!p.isOwner && (
        <div className="grid gap-3 sm:grid-cols-3">
          {canRoles && (
            <Field label="Role">
              <Select value={p.roleId} onChange={(e) => void onRole(e.target.value)}>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {manage && (
            <Field label="Hall / branch">
              <Select value={p.branchId ?? ""} onChange={(e) => void onSave({ branchId: e.target.value || null }, `${p.name}'s hall updated.`)}>
                <option value="">Not set</option>
                {settings.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {showRate && (
            <Field label="Hourly rate ($)">
              <Input type="number" min={0} step="0.5" value={rate} disabled={!manage} onChange={(e) => setRate(e.target.value)} onBlur={() => manage && rate !== (p.rateCents === null ? "" : (p.rateCents / 100).toString()) && void onSave({ rate: rate === "" ? null : Number(rate) }, `${p.name}'s rate saved.`)} placeholder="Optional" />
            </Field>
          )}
        </div>
      )}
      {manage && !p.isOwner && (
        <Button size="sm" variant="danger" onClick={onRemove}>
          Remove from gym
        </Button>
      )}
    </Card>
  );
}
