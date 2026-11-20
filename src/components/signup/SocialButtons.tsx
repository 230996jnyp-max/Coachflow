"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/store";

export interface SocialProviderInfo {
  id: string;
  label: string;
}

/** The providers whose keys are set on the server (none until they are, so nothing shows before then). */
export function useSocialProviders(): SocialProviderInfo[] {
  const [providers, setProviders] = useState<SocialProviderInfo[]>([]);
  useEffect(() => {
    let live = true;
    void api<{ providers: SocialProviderInfo[] }>("/api/auth/social/providers").then((r) => {
      if (live && r.ok && r.data) setProviders(r.data.providers);
    });
    return () => {
      live = false;
    };
  }, []);
  return providers;
}

export function ProviderIcon({ id, size = 18 }: { id: string; size?: number }) {
  if (id === "google")
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
        <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
        <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
      </svg>
    );
  if (id === "microsoft")
    return (
      <svg width={size} height={size} viewBox="0 0 23 23" aria-hidden>
        <path fill="#F25022" d="M1 1h10v10H1z" />
        <path fill="#7FBA00" d="M12 1h10v10H12z" />
        <path fill="#00A4EF" d="M1 12h10v10H1z" />
        <path fill="#FFB900" d="M12 12h10v10H12z" />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path fill="#fff" d="M16.7 15.5l.5-3.5h-3.3V9.7c0-1 .5-1.9 2-1.9h1.5V4.8s-1.4-.2-2.7-.2c-2.7 0-4.5 1.7-4.5 4.7V12H7.2v3.5h3V24h3.7v-8.5h2.8z" />
    </svg>
  );
}

const DIVIDER = (
  <div className="flex items-center gap-3 text-xs text-muted" aria-hidden>
    <span className="h-px flex-1 bg-line" />
    or
    <span className="h-px flex-1 bg-line" />
  </div>
);

/**
 * "Continue with Google / Facebook / Microsoft". Plain links (the sign-in happens on the provider's own page and comes back to us), shown only
 * for the providers that are set up. `divider` puts an "or" line before or after them, towards the email form.
 */
export function SocialButtons({ mode, divider }: { mode: "login" | "signup"; divider: "before" | "after" }) {
  const providers = useSocialProviders();
  if (providers.length === 0) return null;
  return (
    <div className="space-y-3">
      {divider === "before" && DIVIDER}
      <div className="space-y-2">
        {providers.map((p) => (
          <a
            key={p.id}
            href={`/api/auth/social/${p.id}/start?mode=${mode}`}
            className="flex min-h-11 w-full items-center justify-center gap-3 rounded-xl border border-line bg-field px-4 text-sm font-semibold transition-colors hover:border-accent/50"
          >
            <ProviderIcon id={p.id} />
            {mode === "signup" ? "Sign up with" : "Continue with"} {p.label}
          </a>
        ))}
      </div>
      {divider === "after" && DIVIDER}
    </div>
  );
}

const LABEL: Record<string, string> = { google: "Google", facebook: "Facebook", microsoft: "Microsoft" };
export const providerLabel = (id: string | null | undefined): string => (id && LABEL[id]) || "that account";

/** What to tell someone who comes back to the login or signup page after a social sign-in that didn't finish. */
export function socialMessage(code: string | null, provider: string | null): { tone: "warn" | "error" | "info"; text: string; signIn?: boolean } | null {
  const p = providerLabel(provider);
  switch (code) {
    case "exists":
      return { tone: "warn", text: `You already have a CoachFlow account with this ${p === "that account" ? "sign-in or email" : `${p} account or email`}. Log in instead.`, signIn: true };
    case "conflict":
      return { tone: "warn", text: `An account with that email already exists, but ${p} can't confirm the email is yours. Log in with your password (or Google), then connect ${p} in Settings → Profile.` };
    case "denied":
      return { tone: "info", text: "Sign-in was cancelled. You can try again, or use your email instead." };
    case "disabled":
      return { tone: "error", text: "This account has been disabled. Please contact c.darshstrength@gmail.com." };
    case "unverified":
      return { tone: "warn", text: "Please confirm your email first: open the link we sent you." };
    case "noemail":
      return { tone: "warn", text: `${p} didn't share an email address, so we can't set up your account that way. Please sign up with your email instead.` };
    case "unavailable":
      return { tone: "error", text: "That way of signing in isn't available right now. Please use your email." };
    case "busy":
      return { tone: "error", text: "Too many attempts. Please wait a few minutes and try again." };
    case "error":
      return { tone: "error", text: "That sign-in didn't work. Please try again, or use your email." };
    default:
      return null;
  }
}
