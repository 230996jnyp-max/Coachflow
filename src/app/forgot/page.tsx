"use client";

import { ArrowLeft, Mail } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AuthShell } from "@/components/signup/AuthShell";
import { Button, Field, Input, Notice } from "@/components/ui";
import { api } from "@/lib/store";

/** Public: ask for a password-reset email. */
export default function ForgotPage() {
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await api("/api/auth/forgot", { body: { identifier: who.trim() } });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Something went wrong. Please try again.");
    setSent(true);
  };

  return (
    <AuthShell title="Forgot your password?" subtitle="We'll email you a link to choose a new one">
      {sent ? (
        <div className="space-y-4 text-center">
          <Mail size={44} className="mx-auto rounded-full bg-accent/15 p-2.5 text-accent" />
          <p className="text-sm text-muted">
            If there&apos;s an account with that email or username, a reset link is on its way. It works for one hour. Check your spam folder too.
          </p>
          <p className="text-xs text-muted">Accounts your coach made for you may have no email on file. If that&apos;s you, ask your coach to reset your password.</p>
          <Link href="/login" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent">
            <ArrowLeft size={15} /> Back to sign in
          </Link>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={submit} aria-busy={busy}>
          <Field label="Email or username">
            <Input value={who} onChange={(e) => setWho(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="username" maxLength={200} required />
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" size="lg" className="w-full" disabled={busy || !who.trim()}>
            {busy ? "Sending…" : "Email me a reset link"}
          </Button>
          <p className="text-center text-sm">
            <Link href="/login" className="font-semibold text-accent hover:underline">
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
