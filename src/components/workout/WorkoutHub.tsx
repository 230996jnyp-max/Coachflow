"use client";

import { format, parseISO } from "date-fns";
import { ChevronRight, ClipboardList, ClipboardPaste, Download, History, Pencil, Play, Plus, Trash2, Trophy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { FeelingBadge } from "@/components/workout/FeelingCard";
import { Badge, Button, Card, ConfirmDialog, EmptyState, SectionTitle } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { doneWorkouts, workoutSetCount, workoutVolume } from "@/lib/stats";
import { deleteTemplate, startWorkout } from "@/lib/store";
import type { RoutineTemplate } from "@/lib/types";
import { sportLabel } from "@/lib/sports";
import { cn, fmtDurationShort, fmtVolume } from "@/lib/utils";
import { ExportWorkoutModal, type ExportPreset } from "./ExportWorkoutModal";
import { ImportWorkoutModal } from "./ImportWorkoutModal";
import { TemplateEditor } from "./TemplateEditor";

export function WorkoutHub({ clientId }: { clientId: string }) {
  const { db, user, unit, exMap, isTrainer } = useViewer();
  const router = useRouter();
  const [editing, setEditing] = useState<Partial<RoutineTemplate> | null>(null);
  const [del, setDel] = useState<RoutineTemplate | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [allNiches, setAllNiches] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState<ExportPreset | null>(null);

  const history = useMemo(() => doneWorkouts(db.workouts, clientId).reverse(), [db.workouts, clientId]);
  // A coach sees the routines for their own niches first; the rest are one tap away.
  const myNiches = isTrainer || user?.personal ? (db.settings.specialties ?? []) : [];
  const visible = db.templates.filter((t) => (isTrainer ? true : t.shared || t.ownerId === user?.id));
  const inMyNiche = (t: RoutineTemplate) => myNiches.length === 0 || !t.niche || myNiches.includes(t.niche);
  const otherNiche = visible.filter((t) => !inMyNiche(t)).length;
  const templates = visible.filter((t) => allNiches || inMyNiche(t)).sort((a, b) => a.name.localeCompare(b.name));
  const active = db.workouts.find((w) => w.status === "ACTIVE" && w.clientId === clientId);

  if (!user) return null;

  const begin = (opts: { templateId?: string; backfill?: boolean; title?: string }) => {
    const id = startWorkout({ clientId, loggedBy: user.role, loggedById: user.id, ...opts });
    router.push(`/workout/${id}`);
  };

  const shown = showAll ? history : history.slice(0, 8);

  return (
    <div className="space-y-8">
      {active && (
        <Link href={`/workout/${active.id}`}>
          <Card className="flex items-center justify-between gap-3 border-accent/40 bg-accent-dim p-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-accent">In progress</div>
              <div className="font-bold">{active.title}</div>
            </div>
            <span className="flex items-center gap-1 text-sm font-semibold text-accent">
              Resume <ChevronRight size={16} />
            </span>
          </Card>
        </Link>
      )}

      <section data-tour="workout-start">
        <SectionTitle>Start a workout</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button size="lg" onClick={() => begin({ title: "Workout " + format(new Date(), "d MMM") })}>
            <Play size={18} /> Start Empty Workout
          </Button>
          <Button size="lg" variant="secondary" onClick={() => begin({ backfill: true, title: "Past Workout" })}>
            <History size={18} /> Log a Past Workout
          </Button>
        </div>
      </section>

      <section>
        <SectionTitle>{isTrainer ? "Import & export" : "Import"}</SectionTitle>
        <div className={isTrainer ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"}>
          <Button size="lg" variant="outline" data-tour="workout-import" onClick={() => setImporting(true)}>
            <ClipboardPaste size={18} /> {isTrainer ? "Import from Notepad / text" : "Import Workout with AI"}
          </Button>
          {isTrainer && (
            <Button size="lg" variant="outline" onClick={() => setExporting({ scope: "HISTORY", clientId })}>
              <Download size={18} /> Export workouts (PDF / text)
            </Button>
          )}
        </div>
        {!isTrainer && <p className="mt-2 text-xs text-muted">Paste your notes from Apple Notes, Notepad or WhatsApp. Log them as a finished workout, or save them as a routine you can start any time.</p>}
      </section>

      <section>
        <SectionTitle
          action={
            <Button size="sm" variant="secondary" onClick={() => setEditing({})}>
              <Plus size={14} /> New template
            </Button>
          }
        >
          Routine templates
        </SectionTitle>
        {isTrainer && otherNiche > 0 && (
          <div className="mb-3 flex gap-1.5">
            <button type="button" onClick={() => setAllNiches(false)} className={cn("min-h-9 rounded-full border px-3 text-xs font-semibold", !allNiches ? "border-accent bg-accent text-on-accent" : "border-line bg-field text-muted hover:text-ink")}>
              ★ My niches
            </button>
            <button type="button" onClick={() => setAllNiches(true)} className={cn("min-h-9 rounded-full border px-3 text-xs font-semibold", allNiches ? "border-accent bg-accent text-on-accent" : "border-line bg-field text-muted hover:text-ink")}>
              All niche templates ({visible.length})
            </button>
          </div>
        )}
        {templates.length === 0 ? (
          <EmptyState icon={<ClipboardList size={28} />} title="No templates yet" hint="Save a routine to start future workouts in one tap." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((t) => {
              const canEdit = isTrainer || t.ownerId === user.id;
              return (
                <Card key={t.id} className="flex flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-bold">{t.name}</div>
                      {t.niche && isTrainer && <div className="truncate text-[11px] font-semibold text-accent">{sportLabel(t.niche)}</div>}
                      <div className="mt-0.5 text-xs text-muted">
                        {t.exercises.length} exercises · {t.exercises.reduce((n, e) => n + e.sets, 0)} sets
                      </div>
                    </div>
                    {t.shared && <Badge className="border-accent/30 bg-accent/15 text-accent">Trainer</Badge>}
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-muted">
                    {t.exercises.map((e) => exMap.get(e.exerciseId)?.name.replace(/ \(.*\)/, "")).filter(Boolean).join(" · ")}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <Button className="flex-1" onClick={() => begin({ templateId: t.id })}>
                      <Play size={16} /> Start
                    </Button>
                    {isTrainer && (
                      <Button variant="secondary" aria-label="Export template" onClick={() => setExporting({ scope: "SINGLE", kind: "ROUTINE", templateId: t.id })}>
                        <Download size={16} />
                      </Button>
                    )}
                    {canEdit && (
                      <>
                        <Button variant="secondary" aria-label="Edit template" onClick={() => setEditing(t)}>
                          <Pencil size={16} />
                        </Button>
                        <Button variant="secondary" aria-label="Delete template" onClick={() => setDel(t)}>
                          <Trash2 size={16} />
                        </Button>
                      </>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>History</SectionTitle>
        {history.length === 0 ? (
          <EmptyState icon={<History size={28} />} title="No workouts logged yet" hint="Finish your first workout and it will show up here." />
        ) : (
          <div className="space-y-2">
            {shown.map((w) => {
              const prs = w.exercises.reduce((n, we) => n + we.sets.filter((s) => s.pr?.length).length, 0);
              return (
                <Link key={w.id} href={`/workout/${w.id}`}>
                  <Card className="flex items-center gap-3 p-3 transition-colors hover:border-accent/50">
                    <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-field">
                      <div className="text-[10px] font-bold uppercase text-muted">{format(parseISO(w.startedAt), "MMM")}</div>
                      <div className="text-lg font-bold leading-none">{format(parseISO(w.startedAt), "d")}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{w.title}</div>
                      <div className="mt-0.5 text-xs text-muted">
                        {fmtDurationShort(w.durationSec)} · {fmtVolume(workoutVolume(w, exMap), unit)} · {workoutSetCount(w)} sets
                        {w.loggedBy === "TRAINER" && " · by trainer"}
                      </div>
                    </div>
                    <FeelingBadge feedback={w.feedback} />
                    {prs > 0 && (
                      <Badge className="border-pr/30 bg-pr/15 text-pr">
                        <Trophy size={11} /> {prs}
                      </Badge>
                    )}
                    <ChevronRight size={16} className="shrink-0 text-muted" />
                  </Card>
                </Link>
              );
            })}
            {history.length > 8 && (
              <Button variant="ghost" className="w-full" onClick={() => setShowAll((s) => !s)}>
                {showAll ? "Show fewer" : `Show all ${history.length} workouts`}
              </Button>
            )}
          </div>
        )}
      </section>

      <TemplateEditor template={editing} onClose={() => setEditing(null)} />
      <ImportWorkoutModal open={importing} onClose={() => setImporting(false)} defaultClientId={clientId} />
      <ExportWorkoutModal open={!!exporting} onClose={() => setExporting(null)} preset={exporting ?? undefined} />
      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        danger
        title="Delete template?"
        message={`“${del?.name}” will be removed. Past workouts logged from it are not affected.`}
        confirmLabel="Delete"
        onConfirm={() => del && deleteTemplate(del.id)}
      />
    </div>
  );
}
