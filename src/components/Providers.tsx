"use client";

import { useEffect } from "react";
import { IdleGuard } from "@/components/IdleGuard";
import { initStore } from "@/lib/store";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initStore();
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);
  return (
    <>
      <IdleGuard />
      {children}
    </>
  );
}

export function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-line border-t-accent" />
        <div className="text-xs font-medium uppercase tracking-widest text-muted">Loading CoachFlow</div>
      </div>
    </div>
  );
}
