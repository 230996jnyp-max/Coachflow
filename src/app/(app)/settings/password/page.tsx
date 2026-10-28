"use client";

import { ArrowLeft, CheckCircle2, KeyRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, Card, Field, Input, Notice, PageHeader } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { changePassword, changeUsername } from "@/lib/store";

/** After a successful change we show the confirmation briefly, then land on the user's home screen. */
const REDIRECT_MS = 1000;

export default function PasswordPage() {
  const { user } = useViewer();
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  // On the first sign-in the person can also pick their own username (optional: they can keep the one they were given).
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // Guards against a second submit (double Enter / double tap) racing the first: the server invalidates the old
  // session the moment the first request succeeds, so a duplicate would come back as "Please log in".
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!user) return null;
  const home = user.role === "TRAINER" ? "/trainer" : "/home";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current || done) return;
    setError(null);
    if (next !== confirm) {
      setError("New password and confirmation don’t match.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    const wanted = (username ?? user.username).trim().toLowerCase();
    if (user.mustChangePassword && wanted !== user.username) {
      const nameErr = await changeUsername(wanted);
      if (nameErr) {
        setBusy(false);
        inFlight.current = false;
        setError(nameErr);
        return;
      }
    }
    const err = await changePassword(current, next);
    setBusy(false);
    if (err) {
      inFlight.current = false;
      setError(err);
      return;
    }
    // Success: the server issued a fresh session cookie, so the user stays signed in.
    setError(null);
    setDone(true);
    setCurrent("");
    setNext("");
    setConfirm("");
    timer.current = setTimeout(() => router.push(home), REDIRECT_MS);
  };

  return (
    <div className="mx-auto max-w-lg">
      <Link href="/settings" className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={16} /> Back to settings
      </Link>
      <PageHeader title="Account & Security" subtitle="Change your password" />
      {user.mustChangePassword && !done && (
        <div className="mb-4">
          <Notice tone="warn">You’re still using the temporary password you were given. Please set your own below.</Notice>
        </div>
      )}
      {done && (
        <div role="status" className="pointer-events-none fixed inset-x-0 top-3 z-[80] flex justify-center px-4 pt-safe">
          <div className="flex items-center gap-2 rounded-2xl border border-success/40 bg-surface px-4 py-3 text-sm font-semibold text-success shadow-2xl">
            <CheckCircle2 size={18} className="text-success" /> Password updated — taking you home…
          </div>
        </div>
      )}
      <Card className="p-5">
        <form onSubmit={submit} className="space-y-4" aria-busy={busy}>
          <fieldset disabled={busy || done} className="space-y-4">
            {user.mustChangePassword && (
              <Field label="Username" hint="Optional: choose your own, or keep this one. You can change it later in Settings.">
                <Input value={username ?? user.username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={100} />
              </Field>
            )}
            <Field label="Current password">
              <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
            </Field>
            <Field label="New password" hint="At least 8 characters, with a letter and a number.">
              <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required minLength={8} />
            </Field>
            <Field label="Confirm new password">
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            </Field>
          </fieldset>
          {/* An error and the success state are mutually exclusive. */}
          {error && !done && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          {done && <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">Password updated successfully.</p>}
          <Button type="submit" className="w-full" disabled={busy || done}>
            <KeyRound size={16} /> {busy ? "Updating…" : done ? "Redirecting…" : "Update password"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
