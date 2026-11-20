"use client";

import { Check, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, Notice, SectionTitle, Segmented, Textarea } from "@/components/ui";
import { VERDICT_LABEL, VERDICTS, type CaseAnswer, type Verdict } from "@/lib/aiReview";
import { useViewer } from "@/lib/hooks";
import type { ReviewView } from "@/lib/server/aiReview";
import { api } from "@/lib/store";

type Draft = { verdict: Verdict | ""; removed: string[]; avoid: string; why: string };
const blank = (): Draft => ({ verdict: "", removed: [], avoid: "", why: "" });
const done = (d: Draft | undefined) => !!d && d.verdict !== "" && d.why.trim().length >= 15 && (d.verdict !== "CHANGES" || d.removed.length > 0 || d.avoid.trim().length >= 10) && (d.verdict !== "UNSAFE" || d.why.trim().length >= 30);

function monthName(m: string): string {
  const d = new Date(`${m}-01T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? m : d.toLocaleDateString("en-SG", { month: "long", year: "numeric", timeZone: "UTC" });
}
const STATUS_TEXT: Record<string, string> = { APPROVED: "Accepted", REJECTED: "Not accepted", SUBMITTED: "Waiting for a check" };

/** Settings → Monthly AI review: a coach reads five made-up profiles with a plan the AI drafted, says what is safe, and earns 10% off. */
export function AiReviewSection() {
  const { exMap } = useViewer();
  const [view, setView] = useState<ReviewView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await api<{ review: ReviewView }>("/api/ai-review");
      if (!live) return;
      if (!r.ok || !r.data) return setError(r.error ?? "Couldn't load the review.");
      setView(r.data.review);
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!view) return error ? <Notice tone="error">{error}</Notice> : <LoaderCircle className="animate-spin text-muted" size={20} />;

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const r = await api<{ review: ReviewView }>("/api/ai-review", { body });
    setBusy(false);
    if (!r.ok || !r.data) return setError(r.error ?? "That didn't work. Please try again.");
    setView(r.data.review);
  };
  const set = (id: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? blank()), ...patch } }));
  const allDone = view.cases.length > 0 && view.cases.every((c) => done(drafts[c.id]));
  const submit = () => {
    const answers: CaseAnswer[] = view.cases.map((c) => {
      const d = drafts[c.id] ?? blank();
      return { caseId: c.id, verdict: d.verdict as Verdict, removed: d.removed, avoid: d.avoid.trim(), why: d.why.trim() };
    });
    void act({ action: "submit", answers });
  };

  return (
    <div className="space-y-5">
      {error && <Notice tone="error">{error}</Notice>}

      {view.status === "NONE" && (
        <Card className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 shrink-0 text-accent" size={22} />
            <div className="space-y-2 text-sm">
              <p className="font-semibold">Help train the AI trainer, get {view.discount.percent}% off</p>
              <p className="text-muted">
                CoachFlow&apos;s AI trainer writes workouts for people with no coach. It is only as safe as the coaches who check it. Each month you read five made-up people with a plan the AI drafted, say whether it is safe, and take out
                anything you would not give them. It takes about 10 minutes. What you teach it is used to keep unsafe exercises out of real people&apos;s plans.
              </p>
              <p className="text-muted">Some drafts contain a mistake on purpose, so read them properly. {view.discount.text}</p>
            </div>
          </div>
          <Button disabled={busy} onClick={() => void act({ action: "start" })}>
            {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Check size={16} />} Start {monthName(view.month)}&apos;s review
          </Button>
        </Card>
      )}

      {view.status === "STARTED" && (
        <>
          <Notice tone="info">
            Five people, one at a time. Read each draft plan, tick any exercise you would take out, and say why in your own words. Plans for the same person are checked against what other coaches said, so be specific. {view.discount.text}
          </Notice>
          {view.cases.map((c, n) => {
            const d = drafts[c.id] ?? blank();
            return (
              <Card key={c.id} className="space-y-4 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <SectionTitle>
                      {n + 1} of {view.cases.length} · {c.title}
                    </SectionTitle>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted">
                      {c.lines.map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.gentle && <Badge className="border-pr/30 bg-pr/15 text-pr">Gentle plan</Badge>}
                    {done(d) && <Badge className="border-success/30 bg-success/15 text-success">Answered</Badge>}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">The AI&apos;s draft plan (tick what you would take out)</div>
                  {c.plan.days.map((day, di) => (
                    <details key={di} open={di === 0} className="rounded-xl border border-line px-3 py-2">
                      <summary className="cursor-pointer text-sm font-semibold">
                        {day.name} <span className="font-normal text-muted">· {day.focus}</span>
                      </summary>
                      <ul className="mt-2 space-y-1">
                        {day.exercises.map((e) => {
                          const out = d.removed.includes(e.exerciseId);
                          return (
                            <li key={e.exerciseId}>
                              <label className="flex min-h-9 cursor-pointer items-center gap-3 text-sm">
                                <input type="checkbox" className="h-5 w-5 shrink-0 accent-accent" checked={out} onChange={() => set(c.id, { removed: out ? d.removed.filter((x) => x !== e.exerciseId) : [...d.removed, e.exerciseId] })} />
                                <span className={out ? "text-muted line-through" : ""}>
                                  {exMap.get(e.exerciseId)?.name ?? "Exercise"} · {e.durationSec ? `${Math.round(e.durationSec / 60)} min` : `${e.sets} × ${e.repMin}-${e.repMax}`}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  ))}
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-semibold">Is this plan safe for this person?</div>
                  <Segmented value={d.verdict} onChange={(v) => v && set(c.id, { verdict: v })} options={VERDICTS.map((v) => ({ value: v, label: VERDICT_LABEL[v] }))} className="flex-wrap" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold" htmlFor={`why-${c.id}`}>
                    Why? <span className="font-normal text-muted">(a sentence or two, in your own words)</span>
                  </label>
                  <Textarea id={`why-${c.id}`} value={d.why} onChange={(e) => set(c.id, { why: e.target.value })} maxLength={400} placeholder="What you looked at and what you decided" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold" htmlFor={`avoid-${c.id}`}>
                    What should the AI avoid or do differently for someone like this? <span className="font-normal text-muted">(needed if you chose &ldquo;Needs changes&rdquo; and took nothing out)</span>
                  </label>
                  <Textarea id={`avoid-${c.id}`} value={d.avoid} onChange={(e) => set(c.id, { avoid: e.target.value })} maxLength={300} placeholder="e.g. No loaded spinal flexion; keep lower-body work to machines and glute bridges" />
                </div>
              </Card>
            );
          })}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted">{view.cases.filter((c) => done(drafts[c.id])).length} of {view.cases.length} answered</span>
            <Button disabled={!allDone || busy} onClick={submit}>
              {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Check size={16} />} Send my review
            </Button>
          </div>
        </>
      )}

      {view.status === "SUBMITTED" && (
        <Card className="space-y-2 p-5 text-sm">
          <p className="font-semibold">Thank you. Your review is with the owner.</p>
          <p className="text-muted">It was held for a quick check, so the discount isn&apos;t applied yet. You&apos;ll get a notification when it&apos;s decided.</p>
          {view.flags.length > 0 && <p className="text-xs text-muted">Held because: {view.flags.join("; ")}.</p>}
        </Card>
      )}

      {view.status === "APPROVED" && (
        <Card className="space-y-2 p-5 text-sm">
          <p className="font-semibold">{monthName(view.month)}&apos;s review is done. Thank you.</p>
          <p className="text-muted">{view.discountNote || view.discount.text}</p>
          <p className="text-muted">
            Your reviews have taught the AI trainer {view.rulesTaught} lesson{view.rulesTaught === 1 ? "" : "s"} so far. Next month&apos;s review opens on the 1st.
          </p>
        </Card>
      )}

      {view.status === "REJECTED" && (
        <Notice tone="warn">
          This month&apos;s review wasn&apos;t accepted{view.decisionNote ? `: ${view.decisionNote}` : "."} You can do next month&apos;s.
        </Notice>
      )}

      {view.history.length > 0 && (
        <Card className="space-y-2 p-4">
          <SectionTitle>Your reviews</SectionTitle>
          <ul className="divide-y divide-line text-sm">
            {view.history.map((h) => (
              <li key={h.month} className="flex items-center justify-between gap-3 py-2">
                <span>{monthName(h.month)}</span>
                <span className="text-muted">{STATUS_TEXT[h.status] ?? h.status}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
