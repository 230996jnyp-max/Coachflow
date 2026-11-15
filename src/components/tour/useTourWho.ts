"use client";

import { useMemo } from "react";
import { hasPortalAccess, type GymPerm } from "@/lib/gymPerms";
import { useViewer } from "@/lib/hooks";
import type { TourWho } from "@/lib/tourSteps";

/** Who the person is, for choosing which tour parts fit them: coach, client or solo, owner, and any gym access. Also their first active client. */
export function useTourWho() {
  const { user, isTrainer, isPersonal, clients } = useViewer();
  const isOwner = !!user?.isOwner;
  const perms = user?.gym && hasPortalAccess(user.gym) ? (user.gym.perms as GymPerm[]) : null;
  const permKey = perms ? perms.join(",") : "";
  const who = useMemo<TourWho>(
    () => ({ isTrainer, isPersonal, isOwner, gymPerms: permKey ? (permKey.split(",") as GymPerm[]) : null }),
    [isTrainer, isPersonal, isOwner, permKey],
  );
  const firstClientId = clients.find((c) => !c.profile.archived)?.user.id ?? null;
  const seen = user?.prefs?.tours ?? [];
  return { user, who, firstClientId, seen };
}
