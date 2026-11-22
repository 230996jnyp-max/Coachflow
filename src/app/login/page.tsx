"use client";

import { ThemeMenu } from "@/components/ThemeSwitcher";
import { Dumbbell, Eye, EyeOff, LogIn } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { InstallButton } from "@/components/InstallButton";
import { Splash } from "@/components/Providers";
import { SocialButtons, socialMessage } from "@/components/signup/SocialButtons";
import { Button, Card, Field, Input, Notice } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { IDLE_NOTICE, savedUsername, takeIdleNotice } from "@/lib/idle";
import { api, loginResult } from "@/lib/store";

export default function LoginPage() {
  const { ready, user, isTrainer, db } = useViewer();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  // "Stay signed in on this device": off unless ticked, because the default is to sign out after 4 hours of no activity.
  const [stay, setStay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set when this form signed the person in: the card fades out as the next screen fades in, instead of flashing a loader.
  const [submitted, setSubmitted] = useState(false);
  const [fading, setFading] = useState(false);
  const [idleNotice, setIdleNotice] = useState(false);
  // Coming back from "Continue with Google / Facebook / Microsoft" without being signed in: say why.
  const [socialNote, setSocialNote] = useState<ReturnType<typeof socialMessage>>(null);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!(ready && user)) return;
    const to = isTrainer ? "/trainer" : "/home";
    if (!submitted) {
      router.replace(to);
      return;
    }
    const a = setTimeout(() => setFading(true), 0);
    const b = setTimeout(() => router.replace(to), 220);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [ready, user, isTrainer, router, submitted]);

  // When the form first appears: fill in this device's last username (never a password), keep the password empty and focused,
  // and explain an inactivity sign-out. Storage is browser-only, so this runs after mount.
  useEffect(() => {
    if (!ready || user) return;
    Promise.resolve().then(() => {
      const saved = savedUsername();
      if (saved) {
        setUsername(saved);
        passwordRef.current?.focus();
      }
      if (takeIdleNotice()) setIdleNotice(true);
      const q = new URLSearchParams(window.location.search);
      setSocialNote(socialMessage(q.get("social"), q.get("provider")));
    });
  }, [ready, user]);

  if (!ready || (user && !submitted)) return <Splash />;

  const attempt = async (u: string, p: string) => {
    setBusy(true);
    setSubmitted(true);
    const r = await loginResult(u, p, stay);
    if (r.error) {
      setBusy(false);
      setSubmitted(false);
      setError(r.error);
      setUnverified(r.code === "unverified");
      setResent(false);
    }
  };

  const resend = async () => {
    await api("/api/auth/resend", { body: { identifier: username.trim() } });
    setResent(true);
  };

  return (
    <div className={`pt-safe pb-safe flex min-h-dvh items-center justify-center px-4 py-10 ${fading ? "fade-out" : ""}`}>
      <div className="absolute right-4 top-4">
        <ThemeMenu />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-on-accent shadow-lg shadow-accent/30">
            <Dumbbell size={32} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{db.settings.brandName}</h1>
          <p className="mt-1 text-sm text-muted">Train. Track. Book. Your coaching, in your pocket.</p>
        </div>

        {socialNote && (
          <div className="mb-4">
            <Notice tone={socialNote.tone}>{socialNote.text}</Notice>
          </div>
        )}
        {idleNotice && (
          <div className="mb-4">
            <Notice tone="warn">{IDLE_NOTICE}</Notice>
          </div>
        )}

        <Card className="p-5">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              void attempt(username, password);
            }}
          >
            <Field label="Username">
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                placeholder="your username or coach email"
                required
              />
            </Field>
            <Field label="Password">
              <div className="relative">
                <Input
                  ref={passwordRef}
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="pr-12"
                  required
                />
                <button
                  type="button"
                  aria-label={show ? "Hide password" : "Show password"}
                  onClick={() => setShow((s) => !s)}
                  className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-muted"
                >
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </Field>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg py-1">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-accent" checked={stay} onChange={(e) => setStay(e.target.checked)} />
              <span className="text-sm">
                <span className="font-semibold">Stay signed in on this device</span>
                <span className="block text-xs text-muted">Only on your own phone or computer. You stay signed in for 30 days; otherwise you are signed out after 4 hours of no activity.</span>
              </span>
            </label>
            {error && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            {unverified && (
              <Button type="button" variant="secondary" className="w-full" onClick={resend} disabled={resent}>
                {resent ? "Sent. Check your email" : "Resend the confirmation email"}
              </Button>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              <LogIn size={18} /> {busy ? "Signing in…" : "Log in"}
            </Button>
            <SocialButtons mode="login" divider="before" />
            <p className="text-center text-sm">
              <Link href="/forgot" className="font-semibold text-accent hover:underline">
                Forgot your password?
              </Link>
            </p>
            <p className="text-center text-xs text-muted">Your coach made your account? Use the username and temporary password they gave you.</p>
            <p className="border-t border-line pt-4 text-center text-sm text-muted">
              New to CoachFlow?{" "}
              <Link href="/signup" className="font-semibold text-accent hover:underline">
                Sign up free
              </Link>
            </p>
          </form>
        </Card>

        <div className="mt-6 flex justify-center">
          <InstallButton />
        </div>
      </div>
    </div>
  );
}
