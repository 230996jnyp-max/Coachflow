"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: { sitekey: string; callback: (t: string) => void; "expired-callback": () => void; theme?: string }) => string; remove: (id: string) => void };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/** Cloudflare Turnstile ("are you a person?"). Shows nothing at all until a site key is set, so the form works without one. */
export function Captcha({ onToken }: { onToken: (token: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!SITE_KEY || !box.current) return;
    const el = box.current;
    let widget: string | null = null;
    let cancelled = false;
    const draw = () => {
      if (cancelled || !window.turnstile) return;
      widget = window.turnstile.render(el, { sitekey: SITE_KEY, callback: onToken, "expired-callback": () => onToken(""), theme: "auto" });
    };
    if (window.turnstile) draw();
    else {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = draw;
      document.head.appendChild(s);
    }
    return () => {
      cancelled = true;
      if (widget && window.turnstile) window.turnstile.remove(widget);
    };
  }, [onToken]);
  if (!SITE_KEY) return null;
  return <div ref={box} className="mt-4 flex justify-center" />;
}
