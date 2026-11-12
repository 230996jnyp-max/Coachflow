"use client";

import { useEffect } from "react";
import { BACKGROUNDS, mediaUrl, type Prefs } from "@/lib/prefs";
import { setQuietHours } from "@/lib/chat";

/**
 * Applies a person's own look: accent colour, text size and spacing (as attributes on <html>, styled in globals.css), the
 * quiet-hours rule for pop-ups, and the background picture or pattern behind the app.
 */
export function Personalize({ userId, prefs }: { userId: string; prefs: Prefs | undefined }) {
  const accent = prefs?.accent ?? "";
  const text = prefs?.textSize && prefs.textSize !== "normal" ? prefs.textSize : "";
  const density = prefs?.density === "compact" ? "compact" : "";
  const quietFrom = prefs?.quiet?.from ?? "";
  const quietTo = prefs?.quiet?.to ?? "";

  useEffect(() => {
    const el = document.documentElement;
    const set = (name: string, v: string) => (v ? el.setAttribute(name, v) : el.removeAttribute(name));
    set("data-accent", accent);
    set("data-text", text);
    set("data-density", density);
    return () => {
      el.removeAttribute("data-accent");
      el.removeAttribute("data-text");
      el.removeAttribute("data-density");
    };
  }, [accent, text, density]);

  useEffect(() => {
    setQuietHours(quietFrom && quietTo ? { from: quietFrom, to: quietTo } : null);
    return () => setQuietHours(null);
  }, [quietFrom, quietTo]);

  return <Background userId={userId} prefs={prefs} />;
}

/** True when a background (a pattern or the person's own picture) is showing, so the page can let it through. */
export function hasBackground(prefs: Prefs | undefined): boolean {
  if (!prefs?.bg || prefs.bg === "none") return false;
  return prefs.bg !== "custom" || !!prefs.bgV;
}

function Background({ userId, prefs }: { userId: string; prefs: Prefs | undefined }) {
  if (!hasBackground(prefs)) return null;
  const custom = prefs!.bg === "custom";
  const preset = BACKGROUNDS.find((b) => b.id === prefs!.bg);
  const url = custom ? mediaUrl(userId, "bg", prefs!.bgV) : null;
  // A photo is covered with the theme colour so text stays readable; the soft patterns need little.
  const dim = prefs!.bgDim ?? (custom ? 60 : 0);
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          backgroundImage: url ? `url(${url})` : preset?.css,
          backgroundSize: url ? "cover" : preset?.id === "grid" ? "34px 34px" : undefined,
          backgroundPosition: "center",
          backgroundAttachment: "fixed",
        }}
      />
      {dim > 0 && <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-bg" style={{ opacity: dim / 100 }} />}
    </>
  );
}
