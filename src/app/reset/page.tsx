"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AuthShell } from "@/components/signup/AuthShell";
import { Button, Field, Input, Notice } from "@/components/ui";
import { api } from "@/lib/store";

/** Public: choose a new password with the link from the reset email. */
export default function ResetPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return setError("Password: at least 8 characters with a letter and a number.");
    if (password !== confirm) return setError("The two passwords don't match.");
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    setBusy(true);
    const r = await api("/api/auth/reset", { body: { token, password } });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Something went wrong. Please try again.");
    setDone(true);
  };

  return (
    <AuthShell title="Choose a new password">
      {done ? (
        <div className="space-y-4 text-center">
          <CheckCircle2 size={44} className="mx-auto rounded-full bg-success/15 p-2.5 text-success" />
          <h2 className="text-lg font-bold">Password changed</h2>
          <p className="text-sm text-muted">You&apos;ve been signed out everywhere. Sign in with your new password.</p>
          <Link href="/login" className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:brightness-110">
            Sign in
          </Link>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={submit} aria-busy={busy}>
          <Field label="New password" hint="At least 8 characters, with a letter and a number.">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" maxLength={128} required />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" maxLength={128} required />
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? "Saving…" : "Change password"}
          </Button>
          <p className="text-center text-sm">
            <Link href="/forgot" className="font-semibold text-accent hover:underline">
              Need a new link?
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
