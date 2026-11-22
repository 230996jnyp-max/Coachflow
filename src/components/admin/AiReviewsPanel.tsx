"use client";

import { format, parseISO } from "date-fns";
import { Check, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, Notice, SectionTitle, Textarea, Toggle } from "@/components/ui";
import { VERDICT_LABEL, type Verdict } from "@/lib/aiReview";
import type { OwnerReview, OwnerRule } from "@/lib/server/aiReview";
import { api } from "@/lib/store";

interface Data {
  reviews: OwnerReview[];
  rules: OwnerRule[];
}

const STATUS_BADGE: Record<string, string> = {
  SUBMITTED: "border-pr/30 bg-pr/15 text-pr",
  APPROVED: "border-success/30 bg-success/15 text-success",
  REJECTED: "border-danger/30 bg-danger/15 text-danger",
};
const STATUS_LABEL: Record<string, string> = { SUBMITTED: "Needs your check", APPROVED: "Accepted", REJECTED: "Not accepted" };
const DISCOUNT_LABEL: Record<string, string> = { STRIPE_CREDIT: "10% credited on Stripe", PENDING: "10% saved for their first invoice", EXEMPT: "No bill to reduce (free account)", GYM: "No bill to reduce (gym covers them)" };

const when = (iso: string | null) => {
  if (!iso) return "";
  try {
    return format(parseISO(iso), "d MMM yyyy, h:mm a");
  } catch {
    return iso;
  }
};

/** Admin → AI reviews: the coaches' monthly reviews the checks held back, and the lessons the AI trainer has learned from approved ones. */
export function AiReviewsPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await api<Data>("/api/admin/ai-reviews");
      if (!live) return;
      if (!r.ok || !r.data) return setError(r.error ?? "Couldn't load the reviews.");
      setData(r.data);
    })();
    return () => {
      live = false;
    };
  }, []);

  const post = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    setError(null);
    const r = await api<Data>("/api/admin/ai-reviews", { body });
    setBusy(null);
    if (!r.ok || !r.data) return setError(r.error ?? "That didn't work.");
    setData({ reviews: r.data.reviews, rules: r.data.rules });
    return r.data;
  };

  if (!data) return error ? <Notice tone="error">{error}</Notice> : <LoaderCircle className="animate-spin text-muted" size={20} />;
  const held = data.reviews.filter((r) => r.status === "SUBMITTED");
  const rest = data.reviews.filter((r) => r.status !== "SUBMITTED");

  const detail = (r: OwnerReview) => (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      {r.cases.map((c, i) => (
        <div key={i} className="space-y-1 text-sm">
          <div className="font-semibold">
            {c.title} <span className="font-normal text-muted">· {VERDICT_LABEL[c.verdict as Verdict] ?? c.verdict}</span>
            {c.planted && <span className="ml-2 text-xs font-normal text-muted">(has the planted mistake)</span>}
          </div>
          {c.removed.length > 0 && <div className="text-muted">Took out: {c.removed.join(", ")}</div>}
          {c.avoid && <div className="text-muted">Teaches the AI: “{c.avoid}”</div>}
          <div className="text-muted">Why: “{c.why}”</div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-5">
      {error && <Notice tone="error">{error}</Notice>}
      <p className="text-sm text-muted">
        Each month coaches check five made-up profiles for the AI trainer and earn 10% off. A review that passes the automatic checks is accepted at once. One that was rushed, copy-pasted or missed the planted mistake waits here for you.
      </p>

      <Card className="space-y-3 p-4">
        <SectionTitle>Waiting for your check ({held.length})</SectionTitle>
        {held.length === 0 && <p className="text-sm text-muted">Nothing is waiting.</p>}
        {held.map((r) => (
          <div key={r.id} className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold">
                  {r.coachName} · {r.month}
                </div>
                <div className="text-xs text-muted">
                  Sent {when(r.submittedAt)} · took {Math.floor(r.seconds / 60)} min {r.seconds % 60} s
                </div>
              </div>
              <Badge className={STATUS_BADGE.SUBMITTED}>{STATUS_LABEL.SUBMITTED}</Badge>
            </div>
            <ul className="mt-2 list-disc pl-5 text-sm text-pr">
              {r.flags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <button type="button" className="mt-2 text-sm font-semibold text-accent hover:underline" onClick={() => setOpen(open === r.id ? null : r.id)}>
              {open === r.id ? "Hide their answers" : "Read their answers"}
            </button>
            {open === r.id && detail(r)}
            <div className="mt-3 space-y-2">
              <Textarea value={notes[r.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} placeholder="A note to the coach (shown if you don't accept it)" maxLength={300} className="min-h-16" />
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy !== null}
                  onClick={async () => {
                    await post({ action: "reject", id: r.id, note: notes[r.id] ?? "" }, r.id + "r");
                  }}
                >
                  <X size={14} /> Don&apos;t accept
                </Button>
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={async () => {
                    await post({ action: "approve", id: r.id }, r.id + "a");
                  }}
                >
                  <Check size={14} /> Accept and give the 10%
                </Button>
              </div>
            </div>
          </div>
        ))}
      </Card>

      <Card className="space-y-3 p-4">
        <SectionTitle>What the AI trainer has learned ({data.rules.filter((x) => x.active).length} on)</SectionTitle>
        <p className="text-xs text-muted">Each lesson keeps certain exercises out of plans for people with those health answers, and its words are passed to the AI. Switch off any you disagree with.</p>
        {data.rules.length === 0 && <p className="text-sm text-muted">No lessons yet. They appear when a review is accepted.</p>}
        <ul className="divide-y divide-line">
          {data.rules.map((x) => (
            <li key={x.id} className="space-y-1 py-2">
              <Toggle checked={x.active} onChange={(v) => void post({ action: "rule", id: x.id, active: v }, x.id)} label={`For ${x.tags.join(" / ")}${x.exercises.length ? `: no ${x.exercises.slice(0, 4).join(", ")}${x.exercises.length > 4 ? "…" : ""}` : ""}`} />
              <div className="text-xs text-muted">
                {x.text ? `“${x.text}” · ` : ""}from {x.coachName}, {when(x.createdAt)}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-3 p-4">
        <SectionTitle>Earlier reviews</SectionTitle>
        {rest.length === 0 && <p className="text-sm text-muted">None yet.</p>}
        <ul className="divide-y divide-line">
          {rest.map((r) => (
            <li key={r.id} className="py-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-semibold">
                  {r.coachName} · {r.month}
                </span>
                <span className="flex items-center gap-2">
                  {r.flagged && <span className="text-xs text-muted">was held</span>}
                  <Badge className={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                </span>
              </div>
              <div className="text-xs text-muted">{r.status === "APPROVED" ? (r.discountKind ? DISCOUNT_LABEL[r.discountKind] ?? r.discountKind : "") : r.decisionNote}</div>
              <button type="button" className="mt-1 text-xs font-semibold text-accent hover:underline" onClick={() => setOpen(open === r.id ? null : r.id)}>
                {open === r.id ? "Hide answers" : "Read answers"}
              </button>
              {open === r.id && detail(r)}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
