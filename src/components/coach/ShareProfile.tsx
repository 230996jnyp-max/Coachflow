"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";

/** Shares the page (the phone's share sheet when there is one, else copies the link). */
export function ShareProfile({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = window.location.href.split("?")[0];
    try {
      if (navigator.share) {
        await navigator.share({ title: `${name} on CoachFlow`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the person closed the share sheet */
    }
  };
  return (
    <button type="button" onClick={() => void share()} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-muted hover:text-ink">
      {copied ? <Check size={16} className="text-success" /> : <Share2 size={16} />} {copied ? "Link copied" : "Share"}
    </button>
  );
}
