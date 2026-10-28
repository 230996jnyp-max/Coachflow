"use client";

import { Check, Dumbbell, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { AiSportModal } from "@/components/sports/AiSportModal";
import { ThemeMenu } from "@/components/ThemeSwitcher";
import { Button, Card, Input, Notice } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { finishNicheStep } from "@/lib/nicheGate";
import { ensureNiches, useNicheSeed } from "@/lib/nicheSeed";
import { CORE_SPORTS, POWERLIFTING, STRENGTH, sportLabel } from "@/lib/sports";
import { updateSettingsNow } from "@/lib/store";
import { cn } from "@/lib/utils";

const BLURB: Record<string, { title: string; text: string }> = {
  [STRENGTH]: { title: "Strength & Gym", text: "Hypertrophy and general fitness" },
  [POWERLIFTING]: { title: "Powerlifting & Maximal Strength", text: "Squat, bench, deadlift, variations, specialty bars, weak-point work" },
  "Yoga & Mindful Movement": { title: "Yoga & Mindful Movement", text: "Standing poses, flows, yin holds, breathwork, inversions" },
  "Mobility & Flexibility": { title: "Mobility, Rehab & Prehab", text: "CARs, PAILs/RAILs, banded work, stability and posture drills" },
  "Boxing & Combat Conditioning": { title: "Boxing & Combat Sports", text: "Shadowboxing, bag and pad work, footwork, defence" },
  "Basketball & Court Athletics": { title: "Basketball & Court Athletics", text: "Shooting, ball handling, finishing, defensive slides, plyos" },
  "Swimming & Aquatics": { title: "Swimming & Aquatics", text: "Stroke drills, kick and pull sets, pace intervals, breath control" },
  "Endurance & Conditioning": { title: "Running, Track & HYROX", text: "Intervals, tempo and long runs, sleds, rowing, conditioning" },
};

/**
 * The step after sign-in (and after the set-your-password screen, when there is one): the coach picks their niche (a primary one and
 * any others they also coach), and the Exercise Library and starter routines are built around it. One tap continues with last time's
 * choice. It is shown in place of the app, not as a page of its own.
 */
export function NicheStep() {
  const { db, user } = useViewer();
  const saved = db.settings.specialties ?? [];
  const customs = (db.settings.sports ?? []).filter((s) => !(CORE_SPORTS as readonly string[]).includes(s));
  const [selected, setSelected] = useState<string[]>(saved);
  const [other, setOther] = useState("");
  const [ai, setAi] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The step replaces whatever page the coach was on, so start at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const toggle = (s: string) => setSelected((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const makePrimary = (s: string) => setSelected((cur) => [s, ...cur.filter((x) => x !== s)]);
  const unchanged = saved.length > 0 && saved.length === selected.length && saved.every((s, i) => s === selected[i]);

  const carryOn = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    setError(null);
    const ok = await updateSettingsNow({ specialties: selected });
    setBusy(false);
    if (!ok) return setError("Couldn't save your choice. Check your connection and try again.");
    void ensureNiches(selected); // builds the library and starter routines in the background
    finishNicheStep();
  };

  const cards = [...CORE_SPORTS, ...customs];

  return (
    <div className="pt-safe pb-safe min-h-dvh px-4 py-8">
      <div className="absolute right-4 top-4">
        <ThemeMenu />
      </div>
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-on-accent shadow-lg shadow-accent/30">
            <Dumbbell size={28} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">What do you coach{user ? `, ${user.name.split(" ")[1] ?? user.name}` : ""}?</h1>
          <p className="mt-1 max-w-md text-sm text-muted">Pick your main niche, and any others you also coach. Your exercise library and starter routines are built around it. You can still use every other sport any time.</p>
        </div>

        {saved.length > 0 && (
          <Button size="lg" className="mb-5 w-full" onClick={() => void carryOn()} disabled={busy || !unchanged}>
            Continue with {sportLabel(saved[0])}
            {saved.length > 1 ? ` + ${saved.length - 1} more` : ""}
          </Button>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {cards.map((s) => {
            const on = selected.includes(s);
            const rank = selected.indexOf(s);
            const info = BLURB[s] ?? { title: s, text: "Added with AI" };
            return (
              <div key={s} className="relative">
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(s)}
                  className={cn("flex min-h-24 w-full flex-col items-start gap-1 rounded-2xl border p-4 text-left transition-colors", on ? "border-accent bg-accent/10" : "border-line bg-surface hover:border-accent/40", on && rank > 0 && "pb-9")}
                >
                  <span className="flex w-full items-start justify-between gap-2">
                    <span className="font-semibold">{info.title}</span>
                    {on && (
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-on-accent">
                        <Check size={11} strokeWidth={3} /> {rank === 0 ? "Primary" : "Also"}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted">{info.text}</span>
                </button>
                {on && rank > 0 && (
                  <button type="button" onClick={() => makePrimary(s)} className="absolute bottom-2.5 left-4 text-xs font-semibold text-accent">
                    Make primary
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <Card className="mt-3 space-y-3 p-4">
          <div>
            <div className="font-semibold">Something else?</div>
            <p className="text-xs text-muted">Type any sport or specialty (Pilates, Muay Thai, Tennis, Golf, Climbing, Calisthenics…). The AI builds a library of drills for it.</p>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (other.trim().length >= 2) setAi(other.trim());
            }}
          >
            <Input value={other} onChange={(e) => setOther(e.target.value)} maxLength={60} placeholder="e.g. Pilates" aria-label="Other sport or specialty" />
            <Button type="submit" variant="secondary" disabled={other.trim().length < 2}>
              <Sparkles size={15} /> Find
            </Button>
          </form>
        </Card>

        {error && (
          <div className="mt-4">
            <Notice tone="error">{error}</Notice>
          </div>
        )}

        <div className="mt-5">
          <Button size="lg" className="w-full" onClick={() => void carryOn()} disabled={busy || selected.length === 0}>
            {busy ? "Saving…" : selected.length === 0 ? "Pick at least one niche" : unchanged ? `Continue with ${sportLabel(selected[0])}${selected.length > 1 ? ` + ${selected.length - 1} more` : ""}` : "Continue"}
          </Button>
        </div>
      </div>

      <AiSportModal
        open={ai !== null}
        onClose={() => {
          setAi(null);
          setOther("");
        }}
        initialSport={ai ?? ""}
        onSaved={(niche) => setSelected((cur) => (cur.includes(niche) ? cur : [...cur, niche]))}
      />
    </div>
  );
}

/** Runs in the background for coaches: keeps each niche's library growing toward ~300 drills and gives the starter routines. */
export function NicheSeeder() {
  const { db, user, isTrainer } = useViewer();
  const key = [...(db.settings.specialties ?? []), ...(db.settings.sports ?? [])].filter((s, i, a) => a.indexOf(s) === i).join("|");
  useEffect(() => {
    if (!user || !isTrainer || !key) return;
    void ensureNiches(key.split("|"));
  }, [user, isTrainer, key]);
  return null;
}

/** "⚡ Building Yoga library in the background: 185 / 300 exercises ready" */
export function SeedPill({ className }: { className?: string }) {
  const s = useNicheSeed();
  if (!s.active && !s.routines) return null;
  return (
    <div role="status" className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent", className)}>
      <span aria-hidden>⚡</span>
      <span className="truncate">{s.active ? `Building ${sportLabel(s.niche)} library in the background: ${s.count} / ${s.target} exercises ready` : `Preparing your ${sportLabel(s.niche)} starter routines…`}</span>
    </div>
  );
}
