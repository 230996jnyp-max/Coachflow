"use client";

import { Download, MoreVertical, PlusSquare, Share } from "lucide-react";
import { useState } from "react";
import { usePwa } from "@/lib/pwa";
import { Button, Modal } from "./ui";

export function InstallButton({ compact = false, className }: { compact?: boolean; className?: string }) {
  const pwa = usePwa();
  const [open, setOpen] = useState(false);

  if (pwa.standalone) return null;

  const onClick = async () => {
    if (pwa.canPrompt) {
      await pwa.promptInstall();
      return;
    }
    setOpen(true);
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={onClick} className={className} aria-label="Install mobile app">
        <Download size={16} />
        {!compact && "Install Mobile App"}
        {compact && <span className="hidden sm:inline">Install</span>}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Install CoachFlow">
        {pwa.isIOS ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">Add CoachFlow to your Home Screen for a full-screen, app-like experience.</p>
            <Step n={1} icon={<Share size={20} />} title="Tap the Share button" text="In Safari, tap the Share icon in the bottom toolbar." />
            <Step n={2} icon={<PlusSquare size={20} />} title="Tap “Add to Home Screen”" text="Scroll the list, tap Add to Home Screen, then Add." />
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Your browser hasn’t offered a one-tap install yet. You can still install CoachFlow manually:
            </p>
            <Step n={1} icon={<MoreVertical size={20} />} title="Open the browser menu" text="Tap ⋮ (Chrome/Android) or the install icon in the address bar (desktop Chrome/Edge)." />
            <Step n={2} icon={<Download size={20} />} title="Choose “Install app”" text="Or “Add to Home screen”. The app then opens full-screen like a native app." />
          </div>
        )}
      </Modal>
    </>
  );
}

function Step({ n, icon, title, text }: { n: number; icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-field p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">{icon}</div>
      <div>
        <div className="text-sm font-semibold">
          Step {n}: {title}
        </div>
        <div className="mt-0.5 text-xs text-muted">{text}</div>
      </div>
    </div>
  );
}
