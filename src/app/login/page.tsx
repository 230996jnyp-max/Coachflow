"use client";

import { Dumbbell, Eye, EyeOff, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { InstallButton } from "@/components/InstallButton";
import { Splash } from "@/components/Providers";
import { Button, Card, Field, Input } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { login } from "@/lib/store";

export default function LoginPage() {
  const { ready, user, isTrainer, db } = useViewer();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace(isTrainer ? "/trainer" : "/home");
  }, [ready, user, isTrainer, router]);

  if (!ready || user) return <Splash />;

  const attempt = async (u: string, p: string) => {
    setBusy(true);
    const err = await login(u, p);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="pt-safe pb-safe flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-white shadow-lg shadow-accent/30">
            <Dumbbell size={32} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{db.settings.brandName}</h1>
          <p className="mt-1 text-sm text-muted">Train. Track. Book. Your coaching, in your pocket.</p>
        </div>

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
            {error && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-red-200">{error}</p>}
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
