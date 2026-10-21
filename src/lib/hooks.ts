"use client";

import { useMemo } from "react";
import { useStore } from "./store";
import type { ClientProfile, DB, Exercise, UnitSystem, User } from "./types";

export interface Viewer {
  ready: boolean;
  db: DB;
  user: User | null;
  isTrainer: boolean;
  unit: UnitSystem;
  exMap: Map<string, Exercise>;
  clients: { user: User; profile: ClientProfile }[];
  /** The app owner (Coach Darsh), when visible to this viewer. */
  owner: User | null;
  /** Coaches other than the owner (only the owner sees these). */
  coaches: User[];
  /** The viewer's own coach: themselves for staff, the assigned coach for a client. */
  coach: User | null;
}

export function useViewer(): Viewer {
  const { ready, db, sessionUserId } = useStore();
  const user = db.users.find((u) => u.id === sessionUserId) ?? null;
  const exMap = useMemo(() => new Map(db.exercises.map((e) => [e.id, e])), [db.exercises]);
  const clients = useMemo(
    () =>
      db.clients
        .map((profile) => ({ profile, user: db.users.find((u) => u.id === profile.id) }))
        .filter((c): c is { user: User; profile: ClientProfile } => !!c.user)
        .sort((a, b) => a.user.name.localeCompare(b.user.name)),
    [db.clients, db.users],
  );
  const owner = db.users.find((u) => u.isOwner) ?? null;
  const coaches = db.users.filter((u) => u.role === "TRAINER" && !u.isOwner && u.id !== user?.id).sort((a, b) => a.name.localeCompare(b.name));
  const coach =
    user?.role === "CLIENT"
      ? (db.users.find((u) => u.id === db.clients.find((c) => c.id === user.id)?.coachId) ?? null)
      : user;
  return {
    ready,
    db,
    user,
    isTrainer: user?.role === "TRAINER",
    unit: user?.unit ?? "metric",
    exMap,
    clients,
    owner,
    coaches,
    coach,
  };
}
