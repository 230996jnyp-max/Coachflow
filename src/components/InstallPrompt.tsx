"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { usePwa } from "@/lib/pwa";
import { InstallButton } from "./InstallButton";

const KEY = "coachflow-install-prompt-seen";

/** A small, one-time nudge to install the app. After "Not now" (or installing) it never returns; Settings → App keeps the button. */
export function InstallPrompt() {
  const pwa = usePwa();
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return true;
    }
  });
  if (seen || pwa.standalone) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setSeen(true);
  };
  return (
    <div className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-2xl md:bottom-4 md:left-auto md:right-4 md:w-96">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold">Add CoachFlow to your home screen</div>
        <div className="text-xs text-muted">Opens full-screen, like a normal app.</div>
      </div>
      <InstallButton compact />
      <button type="button" aria-label="Not now" onClick={close} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-field hover:text-ink">
        <X size={16} />
      </button>
    </div>
  );
}
