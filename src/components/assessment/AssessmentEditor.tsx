"use client";

import { Camera, Check, ChevronLeft, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Card, Field, Input, Notice, SectionTitle, Segmented, Textarea } from "@/components/ui";
import {
  MOVEMENT_ITEMS,
  POSTURE_ITEMS,
  RATING_LABEL,
  SCORE_LABEL,
  TEST_FIELDS,
  VIEWS,
  hasContent,
  type AssessmentData,
  type MovementEntry,
  type PhotoView,
  type PostureEntry,
  type Rating,
} from "@/lib/assessment";
import type { AssessmentRec } from "@/lib/intakeApi";
import { api } from "@/lib/store";
import { cn } from "@/lib/utils";

/*
 * Filling in a posture and fitness assessment. The coach does it with the client (or for a repeat, 8 to 12 weeks later), and a client
 * can fill in one of their own before they meet. Anything under "Others" is listed again next time so it can be compared like the rest.
 */

type Role = "COACH" | "CLIENT";

export function AssessmentEditor({ id, role, minor, onClose, onSaved }: { id: string; role: Role; minor: boolean; onClose: () => void; onSaved: () => void }) {
  const [rec, setRec] = useState<AssessmentRec | null>(null);
  const [data, setData] = useState<AssessmentData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"" | "draft" | "finish">("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [stamp, setStamp] = useState(0);
  const latest = useRef<AssessmentData | null>(null);
  const mine = role === "CLIENT";

  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await api<{ assessment: AssessmentRec }>(`/api/assessments/${id}`);
      if (!live) return;
      if (!r.ok || !r.data) return setError(r.error ?? "Couldn't open that assessment.");
      setRec(r.data.assessment);
      setData(r.data.assessment.data);
      latest.current = r.data.assessment.data;
    })();
    return () => {
      live = false;
    };
  }, [id]);

  const change = (next: AssessmentData) => {
    setData(next);
    latest.current = next;
    setDirty(true);
  };

  const persist = async (finish: boolean): Promise<boolean> => {
    const d = latest.current;
    if (!d) return false;
    setSaving(finish ? "finish" : "draft");
    setError(null);
    const r = await api<{ assessment: AssessmentRec }>(`/api/assessments/${id}`, { method: "PUT", body: { data: d, finish } });
    setSaving("");
    if (!r.ok || !r.data) {
      setError(r.error ?? "Couldn't save.");
      return false;
    }
    setRec(r.data.assessment);
    setDirty(false);
    setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    onSaved();
    return true;
  };

  // A draft is kept safe automatically a few seconds after the last change.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      void persist(false);
    }, 5000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, dirty]);

  if (error && !data) {
    return (
      <div className="space-y-3">
        <Notice tone="error">{error}</Notice>
        <Button variant="secondary" onClick={onClose}>
          Back
        </Button>
      </div>
    );
  }
  if (!data || !rec) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted">
        <LoaderCircle size={16} className="animate-spin" /> Opening…
      </div>
    );
  }

  const setPosture = (pid: string, p: Partial<PostureEntry>) => {
    const cur = data.posture[pid] ?? { rating: "", note: "" };
    change({ ...data, posture: { ...data.posture, [pid]: { ...cur, ...p } } });
  };
  const setMove = (mid: string, p: Partial<MovementEntry>) => {
    const cur = data.movement[mid] ?? { score: null, left: null, right: null, note: "" };
    change({ ...data, movement: { ...data.movement, [mid]: { ...cur, ...p } } });
  };
  const setTest = (tid: string, v: string) => {
    const next = { ...data.tests } as Record<string, unknown>;
    if (v === "") delete next[tid];
    else next[tid] = Number(v);
    change({ ...data, tests: next as AssessmentData["tests"] });
  };

  const finish = async () => {
    if (!hasContent(data)) return setError("Fill in at least one thing first.");
    if (await persist(true)) onClose();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={async () => { if (dirty) await persist(false); onClose(); }}>
          <ChevronLeft size={16} /> Back
        </Button>
        <div className="min-w-0 flex-1 text-sm text-muted">
          {saving ? "Saving…" : dirty ? "Unsaved changes" : savedAt ? `Saved ${savedAt}` : "Draft"}
        </div>
        <Button variant="secondary" size="sm" disabled={!dirty || !!saving} onClick={() => void persist(false)}>
          <Save size={14} /> Save draft
        </Button>
      </div>

      <Notice tone="info">
        {mine
          ? "Fill in what you can. If you're not sure about something, skip it. Your coach will go through it with you. Nothing here is a diagnosis."
          : "Tick what you see. Skip anything you didn't check. Notes are optional. Findings turn into a short “what to work on” list at the end."}
      </Notice>

      <section>
        <SectionTitle>Date</SectionTitle>
        <Card className="p-4">
          <Field label="Date of this assessment">
            <Input type="date" value={data.takenAt} onChange={(e) => e.target.value && change({ ...data, takenAt: e.target.value })} className="max-w-xs" />
          </Field>
        </Card>
      </section>

      <section>
        <SectionTitle>Posture</SectionTitle>
        <Card className="divide-y divide-line">
          {POSTURE_ITEMS.map((p) => {
            const e = data.posture[p.id];
            return (
              <div key={p.id} className="space-y-2 p-4">
                <div>
                  <div className="font-medium">{p.label}</div>
                  <div className="text-xs text-muted">
                    {p.hint} · look from the {p.view.toLowerCase()}
                  </div>
                </div>
                <RatingPick value={e?.rating ?? ""} onChange={(v) => setPosture(p.id, { rating: v })} />
                {e?.rating && e.rating !== "normal" && <Input value={e.note} maxLength={400} placeholder="Note (optional)" onChange={(ev) => setPosture(p.id, { note: ev.target.value })} aria-label={`${p.label} note`} />}
              </div>
            );
          })}
        </Card>
      </section>

      <section>
        <SectionTitle>Others</SectionTitle>
        <Card className="space-y-3 p-4">
          <p className="text-sm text-muted">
            {mine ? "Anything else you've noticed about your posture or movement." : "Anything that isn't in the list above. Whatever you write here is listed again at the next assessment, so you can compare it 8 to 12 weeks later like the rest."}
          </p>
          {data.others.map((o, i) => (
            <div key={o.id} className="space-y-2 rounded-xl border border-line p-3">
              <div className="flex items-center gap-2">
                <Input value={o.name} maxLength={60} placeholder="What is it? (e.g. Left shoulder winging)" aria-label="Item name" onChange={(e) => change({ ...data, others: data.others.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <Button variant="ghost" size="sm" aria-label={`Remove ${o.name || "item"}`} onClick={() => change({ ...data, others: data.others.filter((_, j) => j !== i) })}>
                  <Trash2 size={14} />
                </Button>
              </div>
              <RatingPick value={o.rating} onChange={(v) => change({ ...data, others: data.others.map((x, j) => (j === i ? { ...x, rating: v } : x)) })} />
              {o.rating && o.rating !== "normal" && <Input value={o.note} maxLength={400} placeholder="Note (optional)" aria-label={`${o.name || "Item"} note`} onChange={(e) => change({ ...data, others: data.others.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) })} />}
            </div>
          ))}
          {data.others.length < 12 && (
            <Button variant="secondary" size="sm" onClick={() => change({ ...data, others: [...data.others, { id: `o_${Math.random().toString(36).slice(2, 10)}`, name: "", rating: "", note: "" }] })}>
              <Plus size={14} /> Add an item
            </Button>
          )}
        </Card>
      </section>

      <section>
        <SectionTitle>Movement</SectionTitle>
        <Card className="divide-y divide-line">
          {MOVEMENT_ITEMS.map((m) => {
            const e = data.movement[m.id];
            return (
              <div key={m.id} className="space-y-2 p-4">
                <div className="font-medium">{m.label}</div>
                {m.sided ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <ScorePick label="Left" value={e?.left ?? null} onChange={(v) => setMove(m.id, { left: v })} />
                    <ScorePick label="Right" value={e?.right ?? null} onChange={(v) => setMove(m.id, { right: v })} />
                  </div>
                ) : (
                  <ScorePick value={e?.score ?? null} onChange={(v) => setMove(m.id, { score: v })} />
                )}
                {e && (e.score !== null || e.left !== null || e.right !== null) && <Input value={e.note} maxLength={400} placeholder="Note (optional)" aria-label={`${m.label} note`} onChange={(ev) => setMove(m.id, { note: ev.target.value })} />}
              </div>
            );
          })}
        </Card>
      </section>

      <section>
        <SectionTitle>Fitness tests (optional)</SectionTitle>
        <Card className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {TEST_FIELDS.map((t) => (
              <Field key={t.id} label={`${t.label} (${t.unit})`}>
                <Input type="number" inputMode="decimal" min={t.min} max={t.max} value={data.tests[t.id] ?? ""} onChange={(e) => setTest(t.id, e.target.value)} />
              </Field>
            ))}
            <Field label="Cardio test (optional)">
              <Input value={data.tests.cardioName ?? ""} maxLength={60} placeholder="e.g. 1.6 km walk" onChange={(e) => change({ ...data, tests: { ...data.tests, cardioName: e.target.value } })} />
            </Field>
            <Field label="Cardio result">
              <Input value={data.tests.cardioResult ?? ""} maxLength={60} placeholder="e.g. 14:20" onChange={(e) => change({ ...data, tests: { ...data.tests, cardioResult: e.target.value } })} />
            </Field>
          </div>
        </Card>
      </section>

      <section>
        <SectionTitle>Pain or discomfort</SectionTitle>
        <Card className="p-4">
          <Textarea value={data.pain} maxLength={600} placeholder="Anything that hurt or felt wrong (leave blank if nothing)" onChange={(e) => change({ ...data, pain: e.target.value })} aria-label="Pain or discomfort" />
        </Card>
      </section>

      <section>
        <SectionTitle>Posture photos (optional)</SectionTitle>
        <Card className="space-y-3 p-4">
          {mine && minor ? (
            <p className="text-sm text-muted">Under 18: your coach adds posture photos with you, with a parent or guardian’s agreement.</p>
          ) : (
            <>
              <p className="text-sm text-muted">Front, side and back make comparing easy. Only add them if {mine ? "you're comfortable" : "the client agrees"}. Photos are stored encrypted, only {mine ? "you and your coach" : "you and the client"} can see them, and your gym never can.</p>
              <div className="grid grid-cols-3 gap-3">
                {VIEWS.map((v) => (
                  <PhotoTile
                    key={v}
                    id={id}
                    view={v}
                    has={rec.photos.includes(v)}
                    stamp={stamp}
                    onChanged={(a) => {
                      setRec((r) => (r ? { ...r, photos: a.photos } : r));
                      setStamp((s) => s + 1);
                    }}
                    onError={setError}
                  />
                ))}
              </div>
            </>
          )}
        </Card>
      </section>

      <section>
        <SectionTitle>{mine ? "Anything you'd like your coach to know" : "Your notes"}</SectionTitle>
        <Card className="space-y-3 p-4">
          <Textarea
            value={mine ? data.clientNotes : data.coachNotes}
            maxLength={2000}
            aria-label="Notes"
            onChange={(e) => change(mine ? { ...data, clientNotes: e.target.value } : { ...data, coachNotes: e.target.value })}
            placeholder={mine ? "For example: my left knee clicks when I squat" : "What you noticed, what to watch, what to retest"}
          />
        </Card>
      </section>

      {error && <Notice tone="error">{error}</Notice>}
      <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:mx-0 md:rounded-2xl md:border">
        <Button variant="secondary" disabled={!dirty || !!saving} onClick={() => void persist(false)}>
          <Save size={16} /> Save draft
        </Button>
        <Button disabled={!!saving} onClick={() => void finish()}>
          <Check size={16} /> {saving === "finish" ? "Finishing…" : mine ? "Hand in to my coach" : "Finish assessment"}
        </Button>
      </div>
    </div>
  );
}

function RatingPick({ value, onChange }: { value: Rating | ""; onChange: (v: Rating | "") => void }) {
  const opts: { value: Rating; label: string }[] = (["normal", "mild", "notable"] as Rating[]).map((r) => ({ value: r, label: RATING_LABEL[r] }));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented value={(value || "") as Rating} onChange={(v) => onChange(v === value ? "" : v)} options={opts} />
      {value && (
        <button type="button" className="min-h-9 px-2 text-xs text-muted underline" onClick={() => onChange("")}>
          Clear
        </button>
      )}
    </div>
  );
}

function ScorePick({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label?: string }) {
  return (
    <div>
      {label && <div className="mb-1 text-xs font-semibold text-muted">{label}</div>}
      <div className="flex flex-wrap gap-1.5">
        {SCORE_LABEL.map((s, i) => (
          <button
            key={s}
            type="button"
            aria-pressed={value === i}
            onClick={() => onChange(value === i ? null : i)}
            className={cn("min-h-9 rounded-lg border px-2.5 text-xs font-semibold transition-colors", value === i ? "border-accent bg-accent text-on-accent" : "border-line bg-field text-muted hover:text-ink")}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function PhotoTile({ id, view, has, stamp, onChanged, onError }: { id: string; view: PhotoView; has: boolean; stamp: number; onChanged: (a: AssessmentRec) => void; onError: (e: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    onError(null);
    setBusy(true);
    try {
      const data = await shrink(f);
      const r = await api<{ assessment: AssessmentRec }>(`/api/assessments/${id}/photos/${view}`, { method: "PUT", body: { mime: "image/jpeg", data } });
      if (!r.ok || !r.data) onError(r.error ?? "Couldn't add that picture.");
      else onChanged(r.data.assessment);
    } catch {
      onError("I couldn't open that picture. Try a JPG or PNG.");
    }
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true);
    const r = await api<{ assessment: AssessmentRec }>(`/api/assessments/${id}/photos/${view}`, { method: "DELETE" });
    setBusy(false);
    if (r.ok && r.data) onChanged(r.data.assessment);
    else onError(r.error ?? "Couldn't remove it.");
  };

  return (
    <div className="space-y-2">
      <div className="text-center text-xs font-semibold capitalize text-muted">{view}</div>
      <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-line bg-field">
        {has ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/assessments/${id}/photos/${view}?v=${stamp}`} alt={`${view} posture`} className="h-full w-full object-cover" />
        ) : (
          <button type="button" onClick={() => ref.current?.click()} disabled={busy} className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-muted hover:text-ink">
            {busy ? <LoaderCircle size={20} className="animate-spin" /> : <Camera size={20} />}
            Add
          </button>
        )}
      </div>
      <input ref={ref} type="file" hidden accept="image/*" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
      {has && (
        <div className="flex justify-center gap-1">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => ref.current?.click()}>
            Replace
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} aria-label={`Remove ${view} photo`} onClick={() => void remove()}>
            <Trash2 size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}

/** Shrinks a photo (max 1100 px, JPEG) and returns it as base64 without the prefix. Tries smaller if it is still big. */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  let max = 1100;
  let q = 0.72;
  for (let i = 0; i < 4; i++) {
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * scale));
    c.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/jpeg", q);
    const b64 = url.slice(url.indexOf(",") + 1);
    if (b64.length <= 650_000) {
      bmp.close();
      return b64;
    }
    max = Math.round(max * 0.8);
    q = Math.max(0.5, q - 0.08);
  }
  bmp.close();
  throw new Error("too big");
}
