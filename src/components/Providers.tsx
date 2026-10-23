"use client";

import { useEffect } from "react";
import { IdleGuard } from "@/components/IdleGuard";
import { initStore, saveThemePreference } from "@/lib/store";
import { useCurrentUser } from "@/lib/store";
import { applyTheme, storedTheme } from "@/lib/theme";

const themeSynced = new Set<string>();

/**
 * Account and device keep the same theme: a saved account theme is applied when someone signs in (so it follows them to
 * a new device); an account with none yet adopts the theme this device is showing.
 */
function ThemeSync() {
  const user = useCurrentUser();
  const id = user?.id;
  const pref = user?.themePreference;
  useEffect(() => {
    if (!id || themeSynced.has(id)) return;
    const t = setTimeout(() => {
      themeSynced.add(id);
      if (pref) applyTheme(pref);
      else saveThemePreference(storedTheme());
    }, 0);
    return () => clearTimeout(t);
  }, [id, pref]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Re-assert the saved theme once the page is live (also sets the phone's browser-bar colour).
    applyTheme(storedTheme());
    initStore();
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);
  return (
    <>
      <IdleGuard />
      <ThemeSync />
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
