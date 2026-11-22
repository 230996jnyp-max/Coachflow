"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { idleLimitMs, isIdleStale, markActive, readLastActive, setIdleNotice } from "@/lib/idle";
import { api, logout, useStore } from "@/lib/store";

const WRITE_EVERY_MS = 15_000;
const PING_EVERY_MS = 2 * 60_000;
const CHECK_EVERY_MS = 30_000;
const EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"] as const;

/** Signs every account out after 4 hours without real activity (30 days if they chose to stay signed in). Mounted once, and only does anything while signed in. */
export function IdleGuard() {
  const { sessionUserId } = useStore();
  const pathname = usePathname();
  const signedIn = !!sessionUserId;

  // Mouse, keyboard, touch and scroll count as activity.
  useEffect(() => {
    if (!signedIn) return;
    let lastWrite = 0;
    let lastPing = 0;
    let signingOut = false;

    const signOut = async () => {
      if (signingOut) return;
      signingOut = true;
      setIdleNotice();
      await logout({ idle: true }); // saves any pending workout edits first, then ends the session
      window.location.replace("/login");
    };

    const activity = () => {
      const now = Date.now();
      if (now - lastWrite > WRITE_EVERY_MS) {
        lastWrite = now;
        markActive(now);
      }
      if (now - lastPing > PING_EVERY_MS) {
        lastPing = now;
        void api("/api/auth/activity", { method: "POST", body: {} });
      }
    };

    const check = () => {
      const last = readLastActive();
      if (last !== null && Date.now() - last > idleLimitMs()) void signOut();
    };

    // Re-opening the app after a long absence signs out straight away; otherwise the clock starts now.
    if (isIdleStale()) {
      void signOut();
      return;
    }
    activity();

    for (const e of EVENTS) window.addEventListener(e, activity, { passive: true, capture: true });
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, activity, { capture: true });
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      clearInterval(timer);
    };
  }, [signedIn]);

  // Moving between pages counts as activity too.
  useEffect(() => {
    if (signedIn) markActive();
  }, [pathname, signedIn]);

  return null;
}
