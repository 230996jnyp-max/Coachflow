"use client";

import { HeartPulse, LoaderCircle, Play, RefreshCw, ShieldAlert, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConsultCard } from "@/components/consult/ConsultCard";
import { FormFill } from "@/components/intake/FormParts";
import { Badge, Button, Card, Modal, Notice, PageHeader, SectionTitle, Segmented, Textarea } from "@/components/ui";
import { EQUIPMENT_LABEL, NOT_MEDICAL_ADVICE, TRAINER_EQUIPMENT, type PlanExercise, type TrainerEquipment } from "@/lib/aiTrainer";
import { CLEARANCE_MESSAGE, parqFlags, type GoalsData, type ParqData } from "@/lib/intakeForms";
import { useViewer } from "@/lib/hooks";
import type { TrainerView } from "@/lib/server/aiTrainer";
import { api, saveTemplate, startWorkout } from "@/lib/store";

type Step = "parq" | "goals" | "confirm" | null;

const PRIVATE = "Your health answers and plans are private. They are stored encrypted and only you can see them.";

function load(e: PlanExercise, name: string): string {
  if (e.durationSec) return `${name} · ${Math.round(e.durationSec / 60)} min`;
  return `${name} · ${e.sets} × ${e.repMin === e.repMax ? e.repMin : `${e.repMin}-${e.repMax}`}`;
}

/** The AI trainer for someone with no coach: a short health check and goals, then a plan for each week that follows how training went. */
export function AiTrainer() {
  const { user, exMap, db } = useViewer();
  const router = useRouter();
  const [view, setView] = useState<TrainerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(null);
  const [draft, setDraft] = useState<{ parq?: ParqData; goals?: GoalsData }>({});
  const [equipment, setEquipment] = useState<TrainerEquipment>("HOME");
  const [accepted, setAccepted] = useState(false);
  const [clearance, setClearance] = useState(false);
  const [hurting, setHurting] = useState(false);
  const [hurtNote, setHurtNote] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [restartOk, setRestartOk] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await api<{ trainer: TrainerView }>("/api/ai-trainer");
      if (!live) return;
      if (!r.ok || !r.data) return setError(r.error ?? "Couldn't load your AI trainer.");
      setView(r.data.trainer);
    })();
    return () => {
      live = false;
    };
  }, []);

  // The plan's workouts become the person's own routines, so "Start" opens the normal workout screen.
  const plan = view?.plan ?? null;
  useEffect(() => {
    if (!plan) return;
    for (const t of plan.templates) if (!db.templates.some((x) => x.id === t.id)) saveTemplate(t);
  }, [plan, db.templates]);

  if (!user) return null;

  const call = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    setError(null);
    const r = await api<{ trainer: TrainerView; urgent?: boolean }>("/api/ai-trainer", { body: { action, ...extra } });
    setBusy(null);
    if (!r.ok || !r.data) {
      setError(r.error ?? "That didn't work. Please try again.");
      return null;
    }
    setView(r.data.trainer);
    return r.data;
  };

  const start = (i: number) => {
    const t = plan?.templates[i];
    if (!t) return;
    if (!db.templates.some((x) => x.id === t.id)) saveTemplate(t);
    const id = startWorkout({ clientId: user.id, loggedBy: "CLIENT", loggedById: user.id, title: t.name, templateId: t.id });
    router.push(`/workout/${id}`);
  };

  const flagged = draft.parq ? parqFlags(draft.parq).length > 0 : false;

  /* ---------------- Not set up yet ---------------- */
  if (view && (!view.ready || step)) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <PageHeader title="Your AI trainer" subtitle="A plan made for you each week, from your goals and health." />
        {error && <Notice tone="error">{error}</Notice>}
        {step === null && (
          <Card className="space-y-4 p-5">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 shrink-0 text-accent" size={22} />
              <div className="space-y-2 text-sm">
                <p className="font-semibold">How it works</p>
                <ol className="list-decimal space-y-1 pl-5 text-muted">
                  <li>Answer a few health questions and tell us your goal (about 3 minutes).</li>
                  <li>Get this week&apos;s workouts, matched to your goal, your equipment and your health.</li>
                  <li>Train, log how it felt, and next week&apos;s plan adjusts to you.</li>
                </ol>
                <p className="text-muted">Real coaches review the AI&apos;s plans every month and tell it what is not safe for people like you.</p>
              </div>
            </div>
            <Notice tone="warn">{NOT_MEDICAL_ADVICE}</Notice>
            <p className="text-xs text-muted">{PRIVATE}</p>
            <Button onClick={() => setStep("parq")}>
              <HeartPulse size={16} /> Start with a health check
            </Button>
          </Card>
        )}
        {step === "parq" && (
          <Card className="space-y-3 p-5">
            <SectionTitle>1 of 3 · Health check</SectionTitle>
            <p className="text-xs text-muted">{PRIVATE}</p>
            <FormFill
              key="parq"
              kind="PARQ"
              minor={false}
              clientName={user.name}
              initial={draft.parq ?? null}
              onCancel={() => setStep(null)}
              onSubmit={async (data) => {
                setDraft((d) => ({ ...d, parq: data }));
                setStep("goals");
                return null;
              }}
            />
          </Card>
        )}
        {step === "goals" && (
          <Card className="space-y-3 p-5">
            <SectionTitle>2 of 3 · Your goals</SectionTitle>
            <FormFill
              key="goals"
              kind="GOALS"
              minor={false}
              clientName={user.name}
              initial={draft.goals ?? null}
              onCancel={() => setStep("parq")}
              onSubmit={async (data) => {
                setDraft((d) => ({ ...d, goals: data }));
                setStep("confirm");
                return null;
              }}
            />
          </Card>
        )}
        {step === "confirm" && (
          <Card className="space-y-4 p-5">
            <SectionTitle>3 of 3 · What you have, and a promise</SectionTitle>
            <div className="space-y-2">
              <div className="text-sm font-semibold">Where will you train?</div>
              <Segmented value={equipment} onChange={setEquipment} options={TRAINER_EQUIPMENT.map((e) => ({ value: e, label: EQUIPMENT_LABEL[e] }))} className="flex-wrap" />
            </div>
            {flagged && (
              <Notice tone="warn">
                {CLEARANCE_MESSAGE.replace(" This is a flag for you, not a block.", "")} Your plan will be gentle: lighter work with no jumping or heavy bar lifts.
              </Notice>
            )}
            {flagged && (
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg py-1 text-sm">
                <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-accent" checked={clearance} onChange={(e) => setClearance(e.target.checked)} />
                <span>
                  <span className="font-semibold">A doctor has said I can exercise.</span>
                  <span className="block text-xs text-muted">If you haven&apos;t asked yet, please do that first. We won&apos;t build your plan until you have.</span>
                </span>
              </label>
            )}
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg py-1 text-sm">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-accent" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              <span>
                <span className="font-semibold">I understand this is not medical advice.</span>
                <span className="block text-xs text-muted">{NOT_MEDICAL_ADVICE}</span>
              </span>
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setStep("goals")}>
                Back
              </Button>
              <Button
                disabled={busy !== null || !accepted || (flagged && !clearance)}
                onClick={async () => {
                  const saved = await call("setup", { parq: draft.parq, goals: draft.goals, equipment, accepted, clearance });
                  if (!saved) return;
                  setStep(null);
                  await call("plan");
                }}
              >
                {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />} {busy ? "Building your week…" : "Build my first week"}
              </Button>
            </div>
          </Card>
        )}
      </div>
    );
  }

  if (!view) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <PageHeader title="Your AI trainer" />
        {error ? <Notice tone="error">{error}</Notice> : <LoaderCircle className="animate-spin text-muted" size={20} />}
      </div>
    );
  }

  /* ---------------- Set up: this week ---------------- */
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title="Your AI trainer"
        subtitle={view.goal ? `Your goal: ${view.goal}` : "A plan made for you each week."}
        actions={
          <Button variant="secondary" size="sm" onClick={() => setStep("parq")}>
            Update my answers
          </Button>
        }
      />
      {error && <Notice tone="error">{error}</Notice>}
      <ConsultCard />

      {view.paused ? (
        <Card className="space-y-3 p-5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 shrink-0 text-danger" size={22} />
            <div className="space-y-1 text-sm">
              <p className="font-semibold">Your plan is paused</p>
              {view.pauseNote && <p className="text-muted">You told us: “{view.pauseNote}”.</p>}
              <p className="text-muted">{view.pauseAdvice}</p>
            </div>
          </div>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg py-1 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-accent" checked={restartOk} onChange={(e) => setRestartOk(e.target.checked)} />
            <span>It has been looked at, or it has settled, and I want to start again.</span>
          </label>
          <Button
            disabled={!restartOk || busy !== null}
            onClick={async () => {
              const ok = await call("resume", { confirmed: true });
              if (ok) {
                setRestartOk(false);
                setUrgent(false);
              }
            }}
          >
            Restart my plan
          </Button>
        </Card>
      ) : (
        <>
          <Link href="/ai-trainer/programs" className="block" data-ai-programs-link>
            <Card className="flex items-center justify-between gap-3 p-4 hover:border-accent/50">
              <div>
                <div className="text-sm font-bold">Want a longer plan?</div>
                <div className="text-xs text-muted">Build a 1 to 12 week program from your goal, with every week planned and an easier week now and then.</div>
              </div>
              <span className="shrink-0 text-sm font-semibold text-accent">Programs →</span>
            </Card>
          </Link>
          {view.gentle && <Notice tone="info">Gentle plan: lighter work, no jumping and no heavy bar lifts, because of your health answers.</Notice>}
          {(!plan || view.planIsOld) && (
            <Card className="space-y-3 p-5">
              <p className="text-sm font-semibold">{plan ? "A new week. Ready for this week's plan?" : "Ready for your first week?"}</p>
              {plan && <p className="text-xs text-muted">It looks at what you finished last week and how it felt, and adjusts.</p>}
              <Button disabled={busy !== null} onClick={() => void call("plan")}>
                {busy === "plan" ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />} {busy === "plan" ? "Building your week…" : "Build this week's plan"}
              </Button>
            </Card>
          )}
          {plan && !view.planIsOld && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                <span>{plan.summary}</span>
                <Badge className="border-line bg-field text-muted">{plan.source === "ai" ? "Written by the AI trainer" : "Built from our safety rules"}</Badge>
              </div>
              <div className="space-y-3">
                {plan.days.map((day, i) => {
                  const tpl = plan.templates[i];
                  const done = !!tpl && db.workouts.some((w) => w.templateId === tpl.id && w.status === "DONE");
                  return (
                    <Card key={i} className="space-y-3 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold">{day.name}</div>
                          <div className="text-xs text-muted">
                            {day.suggestedDay ? `${day.suggestedDay} · ` : ""}
                            {day.focus}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {done && <Badge className="border-success/30 bg-success/15 text-success">Done</Badge>}
                          <Button size="sm" variant={done ? "secondary" : "primary"} onClick={() => start(i)}>
                            <Play size={14} /> {done ? "Again" : "Start"}
                          </Button>
                        </div>
                      </div>
                      <ul className="space-y-1 text-sm">
                        {day.exercises.map((e, j) => (
                          <li key={j} className="flex items-baseline gap-2">
                            <span className="text-muted">{j + 1}.</span>
                            <span>
                              {load(e, exMap.get(e.exerciseId)?.name ?? "Exercise")}
                              {e.note && <span className="block text-xs text-muted">{e.note}</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => void call("rebuild")}>
                  {busy === "rebuild" ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />} Make a different plan
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="text-danger"
                  onClick={() => {
                    setUrgent(false);
                    setHurting(true);
                  }}
                >
                  <ShieldAlert size={14} /> Something hurts
                </Button>
              </div>
            </>
          )}
        </>
      )}

      <p className="text-xs text-muted">
        {NOT_MEDICAL_ADVICE} {PRIVATE}
      </p>

      {hurting && (
        <Modal open onClose={() => setHurting(false)} title="Something hurts">
          <div className="space-y-3">
            <p className="text-sm text-muted">Tell us what and where. We&apos;ll pause your plan until you say it has been looked at. Never train through sharp or growing pain.</p>
            <Textarea value={hurtNote} onChange={(e) => setHurtNote(e.target.value)} placeholder="e.g. my left knee hurts going down stairs" maxLength={300} />
            {urgent && <Notice tone="error">If it is sharp, getting worse, or comes with chest pain, dizziness, numbness or trouble breathing, stop and see a doctor now.</Notice>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setHurting(false)}>
                Cancel
              </Button>
              <Button
                disabled={busy !== null}
                onClick={async () => {
                  const r = await call("hurts", { note: hurtNote });
                  if (!r) return;
                  setUrgent(!!r.urgent);
                  setHurtNote("");
                  if (!r.urgent) setHurting(false);
                }}
              >
                Pause my plan
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
