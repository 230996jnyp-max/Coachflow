"use client";

import { Building2, ChevronRight } from "lucide-react";
import Link from "next/link";
import { hasPortalAccess } from "@/lib/gymPerms";
import { useViewer } from "@/lib/hooks";
import { mediaUrl } from "@/lib/prefs";

/** A coach in a gym: the gym's logo and name on their dashboard, and the way into the gym portal when their role has one. */
export function GymChip() {
  const { user } = useViewer();
  const g = user?.gym;
  if (!g || g.status === "DISABLED") return null;
  const logo = mediaUrl(g.id, "logo", g.logoV);
  const portal = hasPortalAccess(g);
  const body = (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-line bg-field object-contain p-1" />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-field text-accent">
          <Building2 size={20} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-bold">{g.name}</div>
        <div className="text-xs text-muted">{g.status === "PENDING" ? "Waiting for approval" : portal ? `${g.roleName} · open the gym portal` : g.roleName}</div>
      </div>
      {portal && <ChevronRight size={18} className="shrink-0 text-muted" />}
    </div>
  );
  return portal ? <Link href="/gym-admin">{body}</Link> : body;
}
