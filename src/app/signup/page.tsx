"use client";

import { ArrowLeft, CheckCircle2, Dumbbell, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Splash } from "@/components/Providers";
import { ThemeMenu } from "@/components/ThemeSwitcher";
import { Button, Card, Field, Input } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { api } from "@/lib/store";

/** Public: a coach asks for an account. Nothing is created until the owner approves it. */
export default function SignupPage() {
  const { ready, user, isTrainer, db } = useViewer();
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState(""); // hidden trap field: people never see or fill it
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Someone who is already signed in has no need for this page.
  useEffect(() => {
    if (ready && user) router.replace(isTrainer ? "/trainer" : "/home");
  }, [ready, user, isTrainer, router]);

  if (!ready || user) return <Splash />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await api("/api/signup", { body: { fullName: fullName.trim(), email: email.trim(), phone: phone.trim(), website } });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Something went wrong. Please try again.");
    setSent(true);
  };

  return (
    <div className="pt-safe pb-safe animate-fade-in flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeMenu />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-on-accent shadow-lg shadow-accent/30">
            <Dumbbell size={32} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{db.settings.brandName}</h1>
          <p className="mt-1 text-sm text-muted">Request a coach account</p>
        </div>

        {sent ? (
          <Card className="space-y-4 p-6 text-center">
            <CheckCircle2 size={44} className="mx-auto rounded-full bg-success/15 p-2.5 text-success" />
            <h2 className="text-lg font-bold">Request submitted</h2>
            <p className="text-sm text-muted">
              Your coach account request has been submitted! Please wait for admin approval. As soon as your account is approved, your login credentials will be emailed to you immediately.
            </p>
            <p className="text-xs text-muted">We also sent a confirmation to {email.trim().toLowerCase()}.</p>
            <Link href="/login" className="inline-flex min-h-11 items-center justify-center gap-1 text-sm font-semibold text-accent">
              <ArrowLeft size={15} /> Back to sign in
            </Link>
          </Card>
        ) : (
          <Card className="p-5">
            <form className="space-y-4" onSubmit={submit} aria-busy={busy}>
              <p className="text-sm text-muted">Tell us who you are. Once the administrator approves your request, your login details are emailed to you.</p>
              <Field label="Full name">
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" maxLength={100} required minLength={2} />
              </Field>
              <Field label="Email address">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" maxLength={200} required />
              </Field>
              <Field label="Phone / WhatsApp number">
                <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" maxLength={30} required />
              </Field>
              {/* Trap for bots: hidden from people and from screen readers. */}
              <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
                <label>
                  Website
                  <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
                </label>
              </div>
              {error && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
              <Button type="submit" size="lg" className="w-full" disabled={busy}>
                <Send size={17} /> {busy ? "Sending…" : "Request account"}
              </Button>
              <p className="text-center text-sm text-muted">
                <Link href="/login" className="font-semibold text-accent hover:underline">
                  Back to sign in
                </Link>
              </p>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
