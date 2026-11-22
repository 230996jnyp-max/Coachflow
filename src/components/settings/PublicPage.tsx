"use client";

import { ExternalLink, Video } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, Field, Input, Notice, Textarea, Toggle } from "@/components/ui";
import { CONSULT_PRICE_CENTS, CONSULT_TRAINER_CENTS, money, PAYOUT_DELAY_HOURS } from "@/lib/consults";
import type { MyPublicProfile, PublicData } from "@/lib/consultsApi";
import { api } from "@/lib/store";

/** Settings, Public page & consults (coaches): the public profile page, and whether they take paid consults from people training solo. */
export function PublicPageSection() {
  const [me, setMe] = useState<MyPublicProfile | null>(null);
  const [draft, setDraft] = useState<PublicData | null>(null);
  const [certs, setCerts] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void api<MyPublicProfile>("/api/coach-profile").then((r) => {
      if (!alive) return;
      if (r.ok && r.data) {
        setMe(r.data);
        setDraft(r.data.data);
        setCerts(r.data.data.certifications.join("\n"));
      } else setError(r.error ?? "Couldn't load your public page.");
    });
    return () => {
      alive = false;
    };
  }, []);

  const put = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const r = await api<MyPublicProfile>("/api/coach-profile", { method: "PUT", body });
    setBusy(false);
    if (!r.ok || !r.data) {
      setError(r.error ?? "Couldn't save that.");
      return false;
    }
    setMe(r.data);
    return true;
  };

  if (!me || !draft) return <p className="text-sm text-muted">{error ?? "Loading…"}</p>;
  const url = typeof window !== "undefined" ? `${window.location.origin}${me.path}` : me.path;

  return (
    <div className="space-y-5">
      {error && <Notice tone="error">{error}</Notice>}
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Your public page</h2>
          {me.isPublic && (
            <Link href={me.path} target="_blank" className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-accent">
              View my page <ExternalLink size={14} />
            </Link>
          )}
        </div>
        <Toggle checked={me.isPublic} onChange={(v) => void put({ isPublic: v })} label="Anyone with the link can see my page" />
        <p className="text-xs text-muted">
          {me.isPublic ? (
            <>
              Your page: <span className="break-all font-semibold text-ink">{url}</span>. Share it on Instagram or WhatsApp. It never shows your email, phone or anything about your clients.
            </>
          ) : (
            "Your page is switched off: the link shows 'not found'."
          )}
        </p>
        {me.path.includes("/coach/c-") && <p className="text-xs text-muted">Your username is your email, so the address uses your coach code instead. Choose a username (Settings, Profile) for a nicer link.</p>}
      </Card>

      <Card className="space-y-4 p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted">What it shows</h2>
        <Field label="Headline" hint="One line under your name, e.g. 'Strength coach for busy parents'.">
          <Input value={draft.headline} maxLength={120} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} />
        </Field>
        <Field label="About you">
          <Textarea rows={5} value={draft.about} maxLength={1500} onChange={(e) => setDraft({ ...draft, about: e.target.value })} placeholder="How you coach, who you help, what clients can expect." />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Years of experience">
            <Input inputMode="numeric" value={draft.experienceYears ?? ""} onChange={(e) => setDraft({ ...draft, experienceYears: e.target.value === "" ? null : Math.max(0, Math.min(60, Number(e.target.value.replace(/\D/g, "")) || 0)) })} />
          </Field>
          <Field label="Area" hint="A neighbourhood or city, never a street address.">
            <Input value={draft.area} maxLength={60} onChange={(e) => setDraft({ ...draft, area: e.target.value })} placeholder="e.g. Tampines" />
          </Field>
        </div>
        <Field label="Certifications" hint="One per line (up to 10).">
          <Textarea rows={3} value={certs} onChange={(e) => setCerts(e.target.value)} placeholder={"e.g. ACE Certified Personal Trainer\nFirst Aid & CPR"} />
        </Field>
        <Toggle checked={draft.showPackages} onChange={(v) => setDraft({ ...draft, showPackages: v })} label="Show my packages and prices (from Settings, Payments)" />
        <p className="text-xs text-muted">Your photo, niches and gym come from your profile, coaching settings and gym. Ratings and reviews appear after consults.</p>
        <div className="flex items-center gap-3">
          <Button
            disabled={busy}
            onClick={async () => {
              const ok = await put({ data: { ...draft, certifications: certs.split("\n").map((c) => c.trim()).filter(Boolean) } });
              if (ok) {
                setSaved(true);
                setTimeout(() => setSaved(false), 2500);
              }
            }}
          >
            Save page
          </Button>
          {saved && <span className="text-sm font-semibold text-success">Saved</span>}
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted">
          <Video size={16} /> Consults
        </h2>
        <p className="text-sm">
          People training on their own with the AI trainer can pay {money(CONSULT_PRICE_CENTS)} for a one-hour video consult. When one comes in, every trainer who takes consults is told; the first to accept gets it. You receive{" "}
          <span className="font-semibold">{money(CONSULT_TRAINER_CENTS)}</span> in your Stripe account {PAYOUT_DELAY_HOURS} hours after the consult (CoachFlow pays the card fee). The person sees your public page during and after the call, and can rate you.
        </p>
        {me.consultsSuspended ? (
          <Notice tone="warn">Consults are paused for your account after a report. Contact CoachFlow support to talk about it.</Notice>
        ) : !me.stripeReady ? (
          <Notice tone="info" action={<Link href="/settings/payments" className="text-sm font-semibold text-accent">Connect Stripe</Link>}>
            Connect your Stripe account first: that’s where your share is paid.
          </Notice>
        ) : (
          <>
            <Toggle checked={me.takesConsults} onChange={(v) => void put({ takesConsults: v })} label="Take consults" />
            {me.takesConsults && (
              <Link href="/consult" className="inline-flex min-h-9 items-center text-sm font-semibold text-accent">
                See consults waiting →
              </Link>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
