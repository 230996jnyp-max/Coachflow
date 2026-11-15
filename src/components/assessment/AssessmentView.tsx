"use client";

import { Check, ChevronLeft, Gift, LoaderCircle, Printer, Sparkles, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Badge, Button, Card, ConfirmDialog, Notice, SectionTitle } from "@/components/ui";
import { MOVEMENT_ITEMS, POSTURE_ITEMS, RATING_LABEL, SCORE_LABEL, TEST_FIELDS, focusAreas, type FocusArea } from "@/lib/assessment";
import { assessmentHtml, openPrint } from "@/lib/assessmentPrint";
import { useViewer } from "@/lib/hooks";
import type { AssessmentRec } from "@/lib/intakeApi";
import { api, saveTemplate } from "@/lib/store";
import type { Exercise } from "@/lib/types";
import { cn, uid } from "@/lib/utils";

/*
 * One finished (or handed-in) assessment: what was found, what to work on besides muscle, suggested corrective exercises (and a
 * one-tap routine), a printable copy, and, for the coach, giving the client a copy they read and acknowledge.
 */

type Role = "COACH" | "CLIENT";

/** The library exercises that best match the names a focus area suggests. */
function matchExercises(area: FocusArea, library: Exercise[]): Exercise[] {
  const out: Exercise[] = [];
  for (const name of area.exercises) {
    const n = name.toLowerCase();
    const hit = library.find((e) => e.name.toLowerCase() === n) ?? library.find((e) => e.name.toLowerCase().startsWith(n)) ?? library.find((e) => e.name.toLowerCase().includes(n));
    if (hit && !out.some((x) => x.id === hit.id)) out.push(hit);
    if (out.length >= 4) break;
  }
  return out;
}

export function AssessmentView({
  rec,
  role,
  clientName,
  minor,
  onBack,
  onChanged,
}: {
  rec: AssessmentRec;
  role: Role;
  clientName: string;
  minor: boolean;
  onBack: () => void;
  onChanged: () => void;
}) {
  const { db, user, exercises } = useViewer();
  const coach = role === "COACH";
  const d = rec.data;
  const focus = useMemo(() => focusAreas(d), [d]);
  const [busy, setBusy] = useState<"" | "share" | "ack" | "ai" | "delete">("");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [routineName, setRoutineName] = useState<string | null>(null);
  const [withPhotos, setWithPhotos] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const suggestions = useMemo(() => focus.map((f) => ({ f, ex: matchExercises(f, exercises) })), [focus, exercises]);
  const routineExercises = useMemo(() => {
    const seen = new Set<string>();
    const out: { ex: Exercise; area: string }[] = [];
    for (const s of suggestions) for (const ex of s.ex.slice(0, 2)) if (!seen.has(ex.id) && out.length < 10) {
        seen.add(ex.id);
        out.push({ ex, area: s.f.area });
      }
    return out;
  }, [suggestions]);

  const act = async (kind: "share" | "ack", body: Record<string, unknown>) => {
    setBusy(kind);
    setError(null);
    const r = await api(`/api/assessments/${rec.id}`, { method: "PATCH", body });
    setBusy("");
    if (!r.ok) return setError(r.error ?? "That didn't work.");
    onChanged();
  };

  const askAi = async () => {
    setBusy("ai");
    setError(null);
    const r = await api<{ text: string | null }>(`/api/assessments/${rec.id}/summary`, { body: {} });
    setBusy("");
    if (!r.ok) return setError(r.error ?? "Couldn't write that.");
    if (!r.data?.text) setError("AI isn't set up on this server, so there's no written summary. The list above is still complete.");
    else setSummary(r.data.text);
  };

  const makeRoutine = () => {
    if (!user || routineExercises.length === 0) return;
    const name = `Posture and movement: ${clientName}`.slice(0, 120);
    saveTemplate({
      id: uid("t"),
      ownerId: user.id,
      name,
      shared: false,
      exercises: routineExercises.map(({ ex, area }) => {
        const timed = ex.type === "DURATION_ONLY" || ex.type === "DURATION_DISTANCE";
        return timed ? { exerciseId: ex.id, sets: 3, repMin: 0, repMax: 0, durationSec: 30, notes: `For: ${area}` } : { exerciseId: ex.id, sets: 2, repMin: 10, repMax: 12, notes: `For: ${area}` };
      }),
    });
    setRoutineName(name);
  };

  const print = () => {
    const html = assessmentHtml({
      brand: db.settings.brandName || "CoachFlow",
      clientName,
      coachName: coach ? (user?.name ?? "Your coach") : "your coach",
      assessmentId: rec.id,
      data: d,
      focus,
      photos: rec.photos,
      includePhotos: withPhotos,
      summary,
      filledBy: rec.filledBy,
    });
    if (!openPrint(html)) setError("Your browser blocked the print window. Allow pop-ups for this site and try again.");
  };

  const remove = async () => {
    setBusy("delete");
    const r = await api(`/api/assessments/${rec.id}`, { method: "DELETE" });
    setBusy("");
    if (!r.ok) return setError(r.error ?? "Couldn't delete it.");
    onChanged();
    onBack();
  };

  const canShare = coach && rec.filledBy === "COACH" && rec.status === "DONE";
  const canDelete = coach ? rec.filledBy === "COACH" : rec.filledBy === "CLIENT" && rec.status === "DRAFT";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft size={16} /> Back
        </Button>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Assessment · {rec.data.takenAt}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge>{rec.filledBy === "CLIENT" ? "Filled in by the client" : "With the coach"}</Badge>
            {rec.status === "DRAFT" && <Badge className="border-pr/30 bg-pr/15 text-pr">Draft</Badge>}
            {rec.filledBy === "COACH" && rec.sharedAt && !rec.ackAt && <Badge className="border-accent/30 bg-accent/15 text-accent">Copy given · waiting for acknowledgement</Badge>}
            {rec.ackAt && <Badge className="border-success/30 bg-success/15 text-success">Acknowledged</Badge>}
          </div>
        </div>
      </div>

      {!coach && rec.filledBy === "COACH" && rec.sharedAt && !rec.ackAt && (
        <Notice
          tone="info"
          action={
            <Button size="sm" disabled={busy === "ack"} onClick={() => void act("ack", { acknowledge: true })}>
              <Check size={14} /> I have read this
            </Button>
          }
        >
          Your coach gave you this copy of what was recorded. Please read it and tap to acknowledge.
        </Notice>
      )}
      {!coach && rec.ackAt && <Notice tone="success">You acknowledged this copy.</Notice>}

      {focus.length > 0 ? (
        <section>
          <SectionTitle>What to work on besides building muscle</SectionTitle>
          <div className="space-y-3">
            {suggestions.map(({ f, ex }) => (
              <Card key={f.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-semibold">{f.area}</div>
                  <Badge className={f.level === "high" ? "border-danger/30 bg-danger/15 text-danger" : "border-pr/30 bg-pr/15 text-pr"}>{f.level === "high" ? "Priority" : "Worth working on"}</Badge>
                </div>
                <p className="text-sm text-muted">{f.why}</p>
                {ex.length > 0 && (
                  <p className="text-sm">
                    <span className="font-medium">Exercises: </span>
                    {ex.map((e) => e.name).join(", ")}
                  </p>
                )}
                {f.cues.length > 0 && (
                  <p className="text-sm">
                    <span className="font-medium">Also: </span>
                    {f.cues.join(" · ")}
                  </p>
                )}
              </Card>
            ))}
          </div>
          {coach && routineExercises.length > 0 && (
            <div className="mt-3 space-y-2">
              <Button variant="outline" onClick={makeRoutine} disabled={!!routineName}>
                <Gift size={16} /> Save these as a routine ({routineExercises.length} exercises)
              </Button>
              {routineName && (
                <Notice tone="success">
                  Saved “{routineName}” in your workout routines. It’s yours only, not shared with other clients. Assign it to {clientName.split(" ")[0]} from their{" "}
                  <Link href={`/clients/${rec.clientId}`} className="underline">
                    Plan or Workouts tab
                  </Link>
                  .
                </Notice>
              )}
            </div>
          )}
        </section>
      ) : (
        rec.status === "DONE" && <Notice tone="success">Nothing stood out. No areas to work on from what was recorded.</Notice>
      )}

      {summary && (
        <section>
          <SectionTitle>In plain words</SectionTitle>
          <Card className="whitespace-pre-wrap p-4 text-sm">{summary}</Card>
        </section>
      )}

      <Findings rec={rec} />

      {rec.photos.length > 0 && (
        <section>
          <SectionTitle>Posture photos</SectionTitle>
          <div className="grid grid-cols-3 gap-3">
            {rec.photos.map((v) => (
              <figure key={v}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/assessments/${rec.id}/photos/${v}`} alt={`${v} posture`} className="aspect-[3/4] w-full rounded-xl border border-line object-cover" />
                <figcaption className="mt-1 text-center text-xs capitalize text-muted">{v}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={print}>
          <Printer size={16} /> Print or save as PDF
        </Button>
        {rec.photos.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" className="h-4 w-4 accent-accent" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} /> Include photos
          </label>
        )}
        {coach && !minor && focus.length > 0 && !summary && (
          <Button variant="secondary" onClick={() => void askAi()} disabled={busy === "ai"}>
            {busy === "ai" ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />} Write it in plain words (AI)
          </Button>
        )}
        {canShare &&
          (rec.sharedAt ? (
            <Button variant="secondary" disabled={busy === "share"} onClick={() => void act("share", { share: false })}>
              <Undo2 size={16} /> Take the copy back
            </Button>
          ) : (
            <Button disabled={busy === "share"} onClick={() => void act("share", { share: true })}>
              <Gift size={16} /> Give {clientName.split(" ")[0]} a copy
            </Button>
          ))}
        {canDelete && (
          <Button variant="danger" className="ml-auto" onClick={() => setConfirmDel(true)}>
            <Trash2 size={16} /> Delete
          </Button>
        )}
      </div>
      {coach && !minor && focus.length > 0 && <p className="text-xs text-muted">The plain-words summary sends only the findings, never a name, and counts in your AI usage.</p>}
      {coach && minor && <p className="text-xs text-muted">For clients under 18 the AI summary is switched off. The list above is worked out by fixed rules.</p>}

      <ConfirmDialog
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        danger
        title="Delete this assessment?"
        message="This removes the assessment and its photos for good. Other assessments are kept."
        confirmLabel="Delete"
        onConfirm={() => void remove()}
      />
    </div>
  );
}

/* ---------------- The findings, as tables ---------------- */
const tone = (r: string) => (r === "notable" ? "text-danger" : r === "mild" ? "text-pr" : "text-success");

function FindGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <Card className="divide-y divide-line">{children}</Card>
    </section>
  );
}

function FindLine({ label, value, note, cls }: { label: string; value: string; note?: string; cls?: string }) {
  return (
    <div className="flex flex-col gap-0.5 p-3 sm:flex-row sm:items-baseline sm:gap-4">
      <div className="w-56 shrink-0 text-sm font-medium">{label}</div>
      <div className={cn("shrink-0 text-sm font-semibold", cls)}>{value}</div>
      {note && <div className="min-w-0 flex-1 text-sm text-muted">{note}</div>}
    </div>
  );
}

function Findings({ rec }: { rec: AssessmentRec }) {
  const d = rec.data;
  const posture = POSTURE_ITEMS.filter((p) => d.posture[p.id]?.rating);
  const others = d.others.filter((o) => o.rating);
  const moves = MOVEMENT_ITEMS.filter((m) => d.movement[m.id]);
  const tests = TEST_FIELDS.filter((t) => d.tests[t.id] !== undefined);
  return (
    <>
      {posture.length > 0 && (
        <FindGroup title="Posture">
          {posture.map((p) => (
            <FindLine key={p.id} label={p.label} value={RATING_LABEL[d.posture[p.id].rating as "normal"]} cls={tone(d.posture[p.id].rating)} note={d.posture[p.id].note} />
          ))}
        </FindGroup>
      )}
      {others.length > 0 && (
        <FindGroup title="Others">
          {others.map((o) => (
            <FindLine key={o.id} label={o.name} value={RATING_LABEL[o.rating as "normal"]} cls={tone(o.rating)} note={o.note} />
          ))}
        </FindGroup>
      )}
      {moves.length > 0 && (
        <FindGroup title="Movement">
          {moves.map((m) => {
            const e = d.movement[m.id];
            const v = m.sided ? `Left ${e.left ?? "-"} · Right ${e.right ?? "-"}` : e.score === null ? "-" : SCORE_LABEL[e.score];
            return <FindLine key={m.id} label={m.label} value={v} note={e.note} />;
          })}
        </FindGroup>
      )}
      {(tests.length > 0 || d.tests.cardioName || d.tests.cardioResult) && (
        <FindGroup title="Fitness tests">
          {tests.map((t) => (
            <FindLine key={t.id} label={t.label} value={`${d.tests[t.id]} ${t.unit}`} />
          ))}
          {(d.tests.cardioName || d.tests.cardioResult) && <FindLine label={d.tests.cardioName || "Cardio test"} value={d.tests.cardioResult ?? ""} />}
        </FindGroup>
      )}
      {d.pain && (
        <FindGroup title="Pain or discomfort">
          <div className="p-3 text-sm">{d.pain}</div>
        </FindGroup>
      )}
      {d.coachNotes && (
        <FindGroup title="Coach's notes">
          <div className="whitespace-pre-wrap p-3 text-sm">{d.coachNotes}</div>
        </FindGroup>
      )}
      {d.clientNotes && (
        <FindGroup title="Client's notes">
          <div className="whitespace-pre-wrap p-3 text-sm">{d.clientNotes}</div>
        </FindGroup>
      )}
    </>
  );
}
