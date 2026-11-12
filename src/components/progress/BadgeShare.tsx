"use client";

import { format, parseISO } from "date-fns";
import { useState } from "react";
import { badgePng, shareBadge } from "@/lib/badgeImage";
import type { BadgeStatus } from "@/lib/badges";
import { useViewer } from "@/lib/hooks";

export type ShareFlash = { tone: "success" | "error"; text: string } | null;

/**
 * Makes the picture for an earned badge and shares it (the phone's share sheet, or a saved PNG when that is not available).
 * `clientId` is whose badge it is, so a coach can share a client's.
 */
export function useBadgeShare(clientId: string) {
  const { db } = useViewer();
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<ShareFlash>(null);

  const share = async (s: BadgeStatus) => {
    if (!s.earnedAt || busy) return;
    setBusy(s.def.id);
    setFlash(null);
    try {
      const name = db.users.find((u) => u.id === clientId)?.name ?? "";
      const blob = await badgePng({ emoji: s.def.emoji, title: s.def.title, blurb: s.def.blurb, name, date: format(parseISO(s.earnedAt), "d MMM yyyy"), brand: db.settings.brandName });
      const result = await shareBadge(blob, `${s.def.id}.png`, `${name ? `${name} earned` : "Earned"} the “${s.def.title}” badge on ${db.settings.brandName}!`);
      if (result === "saved") setFlash({ tone: "success", text: "Picture saved. Post it wherever you like." });
      else if (result === "shared") setFlash({ tone: "success", text: "Shared." });
    } catch {
      setFlash({ tone: "error", text: "Couldn't make the picture. Please try again." });
    }
    setBusy(null);
  };

  return { share, busy, flash };
}
