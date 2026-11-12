"use client";

import type { ReactNode } from "react";
import { HOME_SECTIONS } from "@/lib/prefs";
import { useViewer } from "@/lib/hooks";

/**
 * One block of a home screen that the person can hide or move (Settings → Appearance → Home screen). The page lays its blocks out in a
 * flex column; each slot sets its own `order`, so nothing about the blocks themselves changes. A block that draws nothing takes no space.
 */
export function HomeSlot({ side, id, children }: { side: "client" | "coach"; id: string; children: ReactNode }) {
  const { user } = useViewer();
  const setting = user?.prefs?.home?.[side];
  if (setting?.hidden.includes(id)) return null;
  const natural = HOME_SECTIONS[side].findIndex((s) => s.id === id);
  const saved = setting?.order.indexOf(id) ?? -1;
  // Saved order first, then anything not yet in it in the page's own order.
  const order = (saved >= 0 ? saved : 100 + natural) + 1;
  return (
    <div className="empty:hidden" style={{ order }}>
      {children}
    </div>
  );
}
