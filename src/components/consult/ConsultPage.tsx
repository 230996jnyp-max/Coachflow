"use client";

import { AlertTriangle, ExternalLink, Flag, Loader2, PhoneOff, ShieldCheck, Star, Video } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, Button, Card, EmptyState, Field, Modal, Notice, PageHeader, Textarea, Toggle } from "@/components/ui";
import { ACCEPT_WINDOW_MIN, CONSULT_MINUTES, CONSULT_TRAINER_CENTS, money, REPORT_REASONS, WARN_BEFORE_END_MIN, type ReporterRole } from "@/lib/consults";
import { consultAction, loadBoard, loadConsult, startConsult, trainerPhoto, type ConsultView, type SoloBoard, type TrainerBoard, type TrainerCard } from "@/lib/consultsApi";
import { cn } from "@/lib/utils";

/* Consult a trainer. The person training on their own books and joins here; a trainer sees consults waiting, accepts one and joins. */

function useTick(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const when = (iso: string) => new Date(iso).toLocaleString("en-SG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function ConsultPage() {
  const [board, setBoard] = useState<SoloBoard | TrainerBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const r = await loadBoard();
    if (r.ok && r.data) {
      setBoard(r.data);
      setError(null);
    } else setError(r.error ?? "Couldn't load consults.");
  }, []);
  useEffect(() => {
    let alive = true;
    void loadBoard().then((r) => {
      if (!alive) return;
      if (r.ok && r.data) setBoard(r.data);
      else setError(r.error ?? "Couldn’t load consults.");
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!board) return <div className="py-16 text-center text-sm text-muted">{error ?? "Loading…"}</div>;
  return board.role === "SOLO" ? <SoloView board={board} reload={reload} /> : <TrainerView board={board} reload={reload} />;
}

/* ---------------- Someone training on their own ---------------- */
function SoloView({ board, reload }: { board: SoloBoard; reload: () => Promise<void> }) {
  const [fromStripe] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      return { id: q.get("id"), paid: q.get("paid") === "1", cancelled: q.get("cancelled") === "1" };
    } catch {
      return { id: null, paid: false, cancelled: false };
    }
  });
  const [confirming, setConfirming] = useState<ConsultView | null>(null);
  const active = board.consults.find((c) => c.status === "OPEN" || c.status === "LIVE") ?? null;

  // Back from Stripe: wait for the payment hold to be confirmed, then the page shows the search for a trainer.
  useEffect(() => {
    if (!fromStripe.paid || !fromStripe.id || active) return;
    let alive = true;
    let tries = 0;
    const poll = async () => {
      const r = await loadConsult(fromStripe.id!);
      if (!alive) return;
      if (r.ok && r.data) {
        setConfirming(r.data);
        if (r.data.status !== "PAYING") return void reload();
      }
      if (++tries < 30) setTimeout(() => void poll(), 2000);
    };
    void poll();
    return () => {
      alive = false;
    };
  }, [fromStripe, active, reload]);

  // While a consult is waiting or running, keep the page fresh.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void reload(), active.status === "OPEN" ? 5000 : 15000);
    return () => clearInterval(t);
  }, [active, reload]);

  const past = board.consults.filter((c) => c !== active);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Consult a trainer" subtitle={`${CONSULT_MINUTES} minutes on a video call with a real CoachFlow trainer, for ${money(board.priceCents)}.`} />
      {fromStripe.cancelled && !active && <Notice>Payment cancelled. You weren’t charged.</Notice>}
      {confirming?.status === "PAYING" && !active && (
        <Notice>
          <span className="inline-flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" /> Confirming your payment…
          </span>
        </Notice>
      )}
      {active ? <ActiveSolo c={active} reload={reload} /> : <BookCard board={board} />}
      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Your consults</h2>
          {past.map((c) => (
            <PastConsult key={c.id} c={c} reload={reload} />
          ))}
        </section>
      )}
    </div>
  );
}

function BookCard({ board }: { board: SoloBoard }) {
  const [question, setQuestion] = useState("");
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!board.available) return <Notice tone="info">{board.reason}</Notice>;
  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-start gap-3">
        <Video size={22} className="mt-0.5 shrink-0 text-accent" />
        <div className="text-sm">
          <p className="font-semibold">Ask a trainer about your AI plan, your form, a niggle, or what to do next.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
            <li>The first free trainer takes it; you see their profile during and after the call.</li>
            <li>Your card is only held. You’re charged when a trainer accepts, and if nobody does within {ACCEPT_WINDOW_MIN} minutes the hold is released.</li>
            <li>The hour starts when the trainer accepts. Something wrong? Report it and CoachFlow will look into it.</li>
          </ul>
        </div>
      </div>
      <Field label="What would you like help with?" hint="The trainer sees this before accepting.">
        <Textarea rows={3} maxLength={1000} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. My squats hurt my knees on the AI plan's leg day. Can we check my form and adjust it?" />
      </Field>
      <Toggle checked={share} onChange={setShare} label="Share my health answers with the trainer" />
      <p className="-mt-2 text-xs text-muted">The trainer always sees your goal, your AI plan and your last few workouts. Your health questionnaire answers are shared only if you switch this on.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <Button
        size="lg"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await startConsult(question, share);
          if (r.ok && r.data?.url) window.location.assign(r.data.url);
          else {
            setBusy(false);
            setError(r.error ?? "That didn't work. Please try again.");
          }
        }}
      >
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Video size={18} />} Pay {money(board.priceCents)} and find a trainer
      </Button>
    </Card>
  );
}

function ActiveSolo({ c, reload }: { c: ConsultView; reload: () => Promise<void> }) {
  const now = useTick();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (c.status === "OPEN") {
    const left = c.acceptBy ? Date.parse(c.acceptBy) - now : 0;
    return (
      <Card className="space-y-3 p-5 text-center">
        <Loader2 size={28} className="mx-auto animate-spin text-accent" />
        <div className="text-lg font-bold">Finding a trainer…</div>
        <p className="text-sm text-muted">
          We’ve told every trainer who takes consults. The first to accept takes it and your hour starts. If nobody is free in {clock(left)}, the hold on your card is released and you aren’t charged.
        </p>
        {error && <Notice tone="error">{error}</Notice>}
        <Button
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await consultAction(c.id, "cancel");
            setBusy(false);
            if (!r.ok) setError(r.error ?? "Couldn't cancel.");
            await reload();
          }}
        >
          Cancel (no charge)
        </Button>
      </Card>
    );
  }
  return <LiveCall c={c} reload={reload} />;
}

function TrainerBadge({ t, big }: { t: TrainerCard; big?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar name={t.name} size={big ? 56 : 40} photo={trainerPhoto(t)} />
      <div className="min-w-0">
        <div className="font-semibold">{t.name}</div>
        {t.headline && <div className="truncate text-xs text-muted">{t.headline}</div>}
        <div className="mt-0.5 flex items-center gap-3 text-xs">
          {t.rating !== null && (
            <span className="inline-flex items-center gap-1">
              <Star size={12} className="fill-amber-400 text-amber-400" /> {t.rating.toFixed(1)}
            </span>
          )}
          {t.profilePath && (
            <Link href={t.profilePath} target="_blank" className="inline-flex items-center gap-1 font-semibold text-accent">
              View profile <ExternalLink size={12} />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/** The running consult: the video call inside the page, the time left, end and report. Both sides use it. */
function LiveCall({ c, reload, side }: { c: ConsultView; reload: () => Promise<void>; side?: React.ReactNode }) {
  const now = useTick();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [reporting, setReporting] = useState(false);
  const left = c.endsAt ? Date.parse(c.endsAt) - now : 0;
  const ended = useRef(false);

  // When the hour is up, the room closes by itself; the page moves on too.
  useEffect(() => {
    if (left <= 0 && !ended.current) {
      ended.current = true;
      setUrl(null);
      void reload();
    }
  }, [left, reload]);

  const join = async () => {
    setBusy(true);
    setError(null);
    const r = await consultAction<{ url: string }>(c.id, "join");
    setBusy(false);
    if (r.ok && r.data?.url) setUrl(r.data.url);
    else setError(r.error ?? "The call couldn't be opened. Try again.");
  };

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {c.myRole === "SOLO" && c.trainer ? <TrainerBadge t={c.trainer} big /> : <div className="font-semibold">Consult with {c.person?.firstName ?? "your client"}</div>}
        <div className={cn("rounded-full px-3 py-1 text-sm font-bold tabular-nums", left < WARN_BEFORE_END_MIN * 60_000 ? "bg-danger/15 text-danger" : "bg-accent/15 text-accent")}>{clock(left)} left</div>
      </div>
      {left > 0 && left < WARN_BEFORE_END_MIN * 60_000 && <Notice tone="warn">Less than {WARN_BEFORE_END_MIN} minutes left. The call closes by itself at the end of the hour.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <div className={cn("gap-4", side ? "lg:grid lg:grid-cols-[1fr_320px]" : "")}>
        <div>
          {url ? (
            <div className="space-y-2">
              <iframe title="Consult video call" src={url} allow="camera; microphone; fullscreen; display-capture; autoplay" className="h-[62vh] min-h-[360px] w-full rounded-2xl border border-line bg-black" />
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-ink">
                Call not loading? Open it in a new tab <ExternalLink size={12} />
              </a>
            </div>
          ) : (
            <div className="flex h-56 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line">
              <Video size={28} className="text-accent" />
              <Button size="lg" disabled={busy || left <= 0} onClick={() => void join()}>
                {busy ? <Loader2 size={18} className="animate-spin" /> : <Video size={18} />} Join the video call
              </Button>
              <p className="px-4 text-center text-xs text-muted">Your browser will ask to use your camera and microphone.</p>
            </div>
          )}
        </div>
        {side && <div className="mt-4 lg:mt-0">{side}</div>}
      </div>
      {c.question && (
        <p className="text-sm">
          <span className="font-semibold">{c.myRole === "SOLO" ? "You asked: " : "They asked: "}</span>
          <span className="text-muted">{c.question}</span>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setEnding(true)}>
          <PhoneOff size={16} /> End consult
        </Button>
        {c.canReport && (
          <Button variant="ghost" onClick={() => setReporting(true)}>
            <Flag size={16} /> Report a problem
          </Button>
        )}
        {c.reported && <span className="self-center text-xs text-muted">Reported. CoachFlow will look into it.</span>}
      </div>
      <Modal
        open={ending}
        onClose={() => setEnding(false)}
        title="End the consult now?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEnding(false)}>
              Keep going
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                setEnding(false);
                setUrl(null);
                await consultAction(c.id, "end");
                await reload();
              }}
            >
              End consult
            </Button>
          </>
        }
      >
        <p className="text-sm">The call closes for both of you and can’t be reopened. {c.myRole === "SOLO" ? "Ending early isn't refunded; if something went wrong, report it instead." : "Only end early if you've both finished."}</p>
      </Modal>
      <ReportModal open={reporting} onClose={() => setReporting(false)} c={c} onDone={reload} />
    </Card>
  );
}

function PastConsult({ c, reload }: { c: ConsultView; reload: () => Promise<void> }) {
  const [reporting, setReporting] = useState(false);
  const label = { DONE: "Done", EXPIRED: "No trainer was free (not charged)", CANCELLED: "Cancelled (not charged)", PAYING: "Not paid", OPEN: "Waiting", LIVE: "Live" }[c.status];
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {c.trainer ? <TrainerBadge t={c.trainer} /> : <div className="text-sm font-semibold">Consult</div>}
        <div className="text-right text-xs text-muted">
          <div>{when(c.acceptedAt ?? c.createdAt)}</div>
          <div>{label}</div>
          {c.refundedCents > 0 && <div className="font-semibold text-success">{money(c.refundedCents)} refunded</div>}
        </div>
      </div>
      {c.canRate && <RateBox c={c} onDone={reload} />}
      {c.stars !== null && (
        <div className="text-sm">
          <span className="inline-flex items-center gap-1 font-semibold">
            You rated {c.stars} <Star size={13} className="fill-amber-400 text-amber-400" />
          </span>
          {c.review && <span className="text-muted"> · {c.review}</span>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {c.canReport && (
          <Button size="sm" variant="ghost" onClick={() => setReporting(true)}>
            <Flag size={14} /> Report a problem
          </Button>
        )}
        {c.reported && <span className="text-xs text-muted">Reported. CoachFlow will look into it.</span>}
      </div>
      <ReportModal open={reporting} onClose={() => setReporting(false)} c={c} onDone={reload} />
    </Card>
  );
}

function RateBox({ c, onDone }: { c: ConsultView; onDone: () => Promise<void> }) {
  const [stars, setStars] = useState(0);
  const [review, setReview] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2 rounded-xl border border-line bg-field p-3">
      <div className="text-sm font-semibold">How was your consult with {c.trainer?.name.split(/\s+/)[0] ?? "the trainer"}?</div>
      <div className="flex gap-1" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" role="radio" aria-checked={stars === i} aria-label={`${i} star${i === 1 ? "" : "s"}`} onClick={() => setStars(i)} className="p-1">
            <Star size={26} className={i <= stars ? "fill-amber-400 text-amber-400" : "text-line"} />
          </button>
        ))}
      </div>
      <Textarea rows={2} maxLength={500} value={review} onChange={(e) => setReview(e.target.value)} placeholder="A few words for other people (shown on the trainer's page with your first name)." />
      {error && <Notice tone="error">{error}</Notice>}
      <Button
        size="sm"
        disabled={!stars || busy}
        onClick={async () => {
          setBusy(true);
          const r = await consultAction(c.id, "rate", { stars, review });
          setBusy(false);
          if (!r.ok) return setError(r.error ?? "Couldn't save that.");
          await onDone();
        }}
      >
        Send rating
      </Button>
    </div>
  );
}

function ReportModal({ open, onClose, c, onDone }: { open: boolean; onClose: () => void; c: ConsultView; onDone: () => Promise<void> }) {
  const role: ReporterRole = c.myRole;
  const [reason, setReason] = useState<string>("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Report a problem with this consult"
      footer={
        sent ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!reason || busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const r = await consultAction(c.id, "report", { reason, details });
                setBusy(false);
                if (!r.ok) return setError(r.error ?? "Couldn't send the report.");
                setSent(true);
                await onDone();
              }}
            >
              Send report
            </Button>
          </>
        )
      }
    >
      {sent ? (
        <div className="space-y-2 text-sm">
          <p className="flex items-center gap-2 font-semibold">
            <ShieldCheck size={18} className="text-success" /> Thanks, CoachFlow has your report.
          </p>
          <p className="text-muted">{role === "SOLO" ? "We'll look into it and let you know what we decide, including any refund." : "Your share is on hold until we've looked into it. We'll let you know what we decide."}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5" role="radiogroup" aria-label="What went wrong">
            {REPORT_REASONS[role].map((r) => (
              <button key={r.id} type="button" role="radio" aria-checked={reason === r.id} onClick={() => setReason(r.id)} className={cn("flex min-h-11 w-full items-center rounded-xl border px-3 text-left text-sm", reason === r.id ? "border-accent bg-accent/10 font-semibold" : "border-line hover:border-accent/50")}>
                {r.label}
              </button>
            ))}
          </div>
          <Field label="What happened?" hint={reason === "other" ? "Needed for 'Something else'." : "Optional, but it helps us decide fairly."}>
            <Textarea rows={3} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} />
          </Field>
          {reason === "unsafe" && <Notice tone="warn">If you’re hurt or unwell, stop training and see a doctor.</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      )}
    </Modal>
  );
}

/* ---------------- Trainers ---------------- */
function TrainerView({ board, reload }: { board: TrainerBoard; reload: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => void reload(), board.live ? 15000 : 8000);
    return () => clearInterval(t);
  }, [board.live, reload]);

  const accept = async (id: string) => {
    setBusy(id);
    setError(null);
    const r = await consultAction(id, "accept");
    setBusy(null);
    if (!r.ok) setError(r.error ?? "Couldn't accept that consult.");
    await reload();
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader title="Consults" subtitle={`People training on their own pay for a ${CONSULT_MINUTES}-minute video consult. The first trainer to accept takes it.`} />
      {board.suspended ? (
        <Notice tone="warn">Consults are paused for your account after a report. Contact CoachFlow support to talk about it.</Notice>
      ) : !board.enabled ? (
        <Notice action={<Link href="/settings/public-page" className="text-sm font-semibold text-accent">Switch on</Link>}>{board.stripeReady ? "You aren't taking consults. Switch them on in Settings, Public page & consults." : "Connect Stripe (Settings, Payments), then switch on consults in Settings, Public page & consults."}</Notice>
      ) : null}
      {error && <Notice tone="error">{error}</Notice>}

      {board.live && <LiveCall c={board.live} reload={reload} side={<PersonPanel c={board.live} />} />}

      {board.enabled && !board.live && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Waiting for a trainer</h2>
          {board.waiting.length === 0 ? (
            <EmptyState icon={<Video size={28} />} title="No consults waiting right now" hint="You'll get a notification when one comes in. Keep this page open to see them straight away." />
          ) : (
            board.waiting.map((w) => (
              <Card key={w.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{w.question ? `"${w.question}"` : <span className="text-muted">No question given.</span>}</div>
                  <div className="mt-1 text-xs text-muted">Waiting {w.waitingMin} min · {CONSULT_MINUTES}-minute video call · you get {money(CONSULT_TRAINER_CENTS)}</div>
                </div>
                <Button disabled={busy === w.id} onClick={() => void accept(w.id)}>
                  {busy === w.id ? <Loader2 size={16} className="animate-spin" /> : <Video size={16} />} Accept and start
                </Button>
              </Card>
            ))
          )}
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Your consults</h2>
          <div className="text-xs text-muted">
            {board.earnings.count} done · {money(board.earnings.paidCents)} paid · {money(board.earnings.heldCents)} on the way
          </div>
        </div>
        {board.history.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          board.history.map((c) => <TrainerPast key={c.id} c={c} reload={reload} />)
        )}
      </section>
    </div>
  );
}

function PersonPanel({ c }: { c: ConsultView }) {
  const p = c.person;
  if (!p) return null;
  const b = p.brief;
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-field p-3 text-sm">
      <div className="font-semibold">{p.firstName}</div>
      {!b.ready ? (
        <p className="text-muted">They haven’t set up the AI trainer yet.</p>
      ) : (
        <>
          <div className="space-y-0.5 text-xs">
            {b.goal && (
              <div>
                <span className="text-muted">Goal:</span> {b.goal}
              </div>
            )}
            {b.experience && (
              <div>
                <span className="text-muted">Experience:</span> {b.experience}
              </div>
            )}
            <div>
              <span className="text-muted">Trains:</span> {b.sessionsPerWeek} days a week{b.equipment ? ` · ${b.equipment}` : ""}
            </div>
          </div>
          {(b.gentle || b.needsClearance) && (
            <div className="flex items-start gap-2 rounded-lg bg-pr/10 p-2 text-xs text-pr">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {b.needsClearance ? "Their health answers need a doctor's clearance; the AI keeps the plan gentle." : "Their health answers mean the AI keeps the plan gentle."}
            </div>
          )}
          {b.plan && (
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-muted">This week’s AI plan</div>
              {b.plan.summary && <p className="mt-1 text-xs">{b.plan.summary}</p>}
              <ul className="mt-1 space-y-0.5 text-xs">
                {b.plan.days.map((d, i) => (
                  <li key={i}>
                    <span className="font-semibold">{d.name}</span> <span className="text-muted">· {d.focus} · {d.exercises} exercises</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {b.health ? (
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-muted">Health answers (shared)</div>
              {b.health.length === 0 ? (
                <p className="mt-1 text-xs">No “yes” answers.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-xs">
                  {b.health.map((h, i) => (
                    <li key={i}>
                      {h.question}
                      {h.detail && <span className="text-muted"> ({h.detail})</span>}
                    </li>
                  ))}
                </ul>
              )}
              {b.pastInjuries && <p className="mt-1 text-xs"><span className="text-muted">Past injuries:</span> {b.pastInjuries}</p>}
            </div>
          ) : (
            <p className="text-xs text-muted">They didn’t share their health answers.</p>
          )}
        </>
      )}
      {p.recent.length > 0 && (
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-muted">Recent workouts</div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {p.recent.map((w, i) => (
              <li key={i}>
                {w.title} <span className="text-muted">· {new Date(w.date).toLocaleDateString("en-SG", { day: "numeric", month: "short" })} · {w.exercises} exercises</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[11px] text-muted">Advice in a consult isn’t medical advice. If they mention pain, chest symptoms or dizziness, tell them to stop and see a doctor.</p>
    </div>
  );
}

function TrainerPast({ c, reload }: { c: ConsultView; reload: () => Promise<void> }) {
  const [reporting, setReporting] = useState(false);
  const pay = c.payout;
  const payText = !pay ? "" : pay.status === "PAID" ? `${money(pay.cents)} paid` : pay.status === "HELD" ? `${money(pay.cents)} on ${pay.dueAt ? when(pay.dueAt) : "its way"}` : pay.status === "CANCELLED" ? "Not paid (refunded)" : "";
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0 text-sm">
        <div className="font-semibold">{c.person?.firstName ?? "Client"}</div>
        <div className="text-xs text-muted">
          {when(c.acceptedAt ?? c.createdAt)}
          {c.stars !== null ? ` · rated ${c.stars}★` : ""}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold">{payText}</span>
        {c.canReport && (
          <Button size="sm" variant="ghost" onClick={() => setReporting(true)}>
            <Flag size={14} /> Report
          </Button>
        )}
        {c.reported && <span className="text-xs text-muted">Reported</span>}
      </div>
      <ReportModal open={reporting} onClose={() => setReporting(false)} c={c} onDone={reload} />
    </Card>
  );
}
