"use client";

import { useEffect, useSyncExternalStore } from "react";

/** Is the device online right now? (The queue keeps retrying either way; this is only for telling the coach.) */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/** Keeps the screen on while `active` (the browser releases the lock when the tab is hidden, so it is asked for again on return). */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const acquire = async () => {
      try {
        const l = await navigator.wakeLock.request("screen");
        if (stopped) void l.release().catch(() => undefined);
        else lock = l;
      } catch {
        /* low battery, or not allowed: the screen just follows the device settings */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && !stopped) void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}
