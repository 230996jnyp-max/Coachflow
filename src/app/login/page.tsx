"use client";

import { ThemeMenu } from "@/components/ThemeSwitcher";
import { Dumbbell, Eye, EyeOff, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { InstallButton } from "@/components/InstallButton";
import { Splash } from "@/components/Providers";
import { Button, Card, Field, Input, Notice } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { IDLE_NOTICE, savedUsername, takeIdleNotice } from "@/lib/idle";
import { login } from "@/lib/store";

export default function LoginPage() {
  const { ready, user, isTrainer, db } = useViewer();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idleNotice, setIdleNotice] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ready && user) router.replace(isTrainer ? "/trainer" : "/home");
  }, [ready, user, isTrainer, router]);

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
    });
  }, [ready, user]);

  if (!ready || user) return <Splash />;

  const attempt = async (u: string, p: string) => {
    setBusy(true);
    const err = await login(u, p);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="pt-safe pb-safe flex min-h-dvh items-center justify-center px-4 py-10">
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
            {error && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              <LogIn size={18} /> {busy ? "Signing in…" : "Log in"}
            </Button>
            <p className="text-center text-xs text-muted">
              Accounts are created by your coach. Ask them for your username and temporary password.
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
