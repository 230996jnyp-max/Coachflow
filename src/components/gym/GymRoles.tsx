"use client";

import { Lock, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, Field, Input, Notice } from "@/components/ui";
import { GYM_PERMS, type GymPerm } from "@/lib/gymPerms";
import { api } from "@/lib/store";
import type { RoleData } from "./types";

/** Make roles with exactly the permissions you choose. The owner role has everything and can't be changed. */
export function GymRoles({ editable }: { editable: boolean }) {
  const [roles, setRoles] = useState<RoleData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [perms, setPerms] = useState<GymPerm[]>([]);

  useEffect(() => {
    let alive = true;
    api<{ roles: RoleData[] }>("/api/gym/roles").then((r) => {
      if (!alive) return;
      if (r.ok && r.data) setRoles(r.data.roles);
      else setError(r.error ?? "Could not load roles.");
    });
    return () => {
      alive = false;
    };
  }, []);

  const call = async (method: string, body: Record<string, unknown>, ok: string) => {
    setError(null);
    const r = await api<{ roles: RoleData[] }>("/api/gym/roles", { method, body });
    if (!r.ok) return setError(r.error ?? "That didn't work.");
    if (r.data) setRoles(r.data.roles);
    setFlash(ok);
  };

  if (!roles) return error ? <Notice tone="error">{error}</Notice> : <Card className="p-6 text-center text-sm text-muted">Loading…</Card>;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">A role is a name and a set of things that person can do. Give each person the role that fits. You, as owner, can always do everything.</p>
      {error && <Notice tone="error">{error}</Notice>}
      {flash && <Notice tone="success">{flash}</Notice>}

      <div className="space-y-3">
        {roles.map((r) => (
          <Card key={r.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{r.name}</span>
              {r.locked && (
                <Badge>
                  <Lock size={11} className="mr-1" /> Owner
                </Badge>
              )}
              <span className="text-xs text-muted">{r.members} {r.members === 1 ? "person" : "people"}</span>
              <div className="flex-1" />
              {editable && !r.locked && (
                <Button size="sm" variant="ghost" onClick={() => void call("DELETE", { id: r.id }, `${r.name} was deleted.`)} aria-label={`Delete ${r.name}`}>
                  <Trash2 size={15} />
                </Button>
              )}
            </div>
            <PermList value={r.perms} disabled={!editable || r.locked} onChange={(next) => void call("PATCH", { id: r.id, perms: next }, `${r.name} updated.`)} />
          </Card>
        ))}
      </div>

      {editable && (
        <Card className="space-y-3 p-4">
          <h3 className="font-bold">New role</h3>
          <Field label="Role name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Head coach, Front desk, Accountant" maxLength={40} />
          </Field>
          <PermList value={perms} onChange={setPerms} />
          <Button
            disabled={name.trim().length < 2}
            onClick={async () => {
              await call("POST", { name, perms }, `${name} created.`);
              setName("");
              setPerms([]);
            }}
          >
            <Plus size={16} /> Create role
          </Button>
        </Card>
      )}
    </div>
  );
}

function PermList({ value, onChange, disabled }: { value: GymPerm[]; onChange: (v: GymPerm[]) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {GYM_PERMS.map((p) => {
        const on = value.includes(p.id);
        return (
          <label key={p.id} className={`flex items-start gap-2 rounded-xl border border-line p-2.5 text-sm ${disabled ? "opacity-70" : "cursor-pointer hover:border-accent/40"}`}>
            <input type="checkbox" className="mt-1 h-4 w-4" checked={on} disabled={disabled} onChange={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])} />
            <span>
              <span className="block font-semibold">{p.label}</span>
              <span className="block text-xs text-muted">{p.hint}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
