"use client";

import { addDays, format, isToday, isYesterday, parseISO } from "date-fns";
import { AlertTriangle, ChevronLeft, ChevronRight, MessageSquare, Plus, Settings2, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, Modal, Notice, PageHeader, Segmented } from "@/components/ui";
import { diaryOutbox } from "@/lib/diaryOutbox";
import { DAY_RE, dayAdd, daysBack, dietConflicts, DISCLAIMER, MEALS, sumMacros, weekSummary, type DietaryProfile, type FoodEntry, type MealType, type NutritionTargets } from "@/lib/nutrition";
import { dayString, deleteEntry, saveEntry, saveSettings, useDiary } from "@/lib/nutritionClient";
import { cn } from "@/lib/utils";
import { AddFood } from "./AddFood";
import { FoodEditor } from "./FoodEditor";
import { NutritionSettings } from "./NutritionSettings";

const dayLabel = (day: string) => {
  const d = parseISO(day);
  return isToday(d) ? "Today" : isYesterday(d) ? "Yesterday" : format(d, "EEE d MMM");
};

export function Bar({ label, value, target, unit, tone = "accent" }: { label: string; value: number; target?: number; unit: string; tone?: "accent" | "success" | "pr" }) {
  const pct = target && target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-semibold text-muted">{label}</span>
        <span className="tabular-nums">
          <span className="font-bold">{Math.round(value)}</span>
          {target ? <span className="text-muted"> / {Math.round(target)} {unit}</span> : <span className="text-muted"> {unit}</span>}
        </span>
      </div>
      {target ? (
        <div className="h-2 overflow-hidden rounded-full bg-field">
          <div className={cn("h-full rounded-full transition-all", tone === "success" ? "bg-success" : tone === "pr" ? "bg-pr" : "bg-accent")} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

/** The first time: are you 18 or older? Under 18s keep the diary but get no calorie targets. */
function AdultGate({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = async (adult: boolean) => {
    setBusy(true);
    const err = await saveSettings({ adult });
    setBusy(false);
    if (err) setError(err);
    else onDone();
  };
  return (
    <Card className="mx-auto max-w-lg space-y-4 p-6">
      <h2 className="text-lg font-bold">Before you start</h2>
      <p className="text-sm text-muted">Log what you eat by photo, words, search or barcode, and see your calories and macros. Your coach can see your diary and help you with it.</p>
      <p className="rounded-xl bg-field p-3 text-xs text-muted">{DISCLAIMER}</p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button className="flex-1" onClick={() => choose(true)} disabled={busy}>
          I’m 18 or older
        </Button>
        <Button variant="secondary" className="flex-1" onClick={() => choose(false)} disabled={busy}>
          I’m under 18
        </Button>
      </div>
      <p className="text-xs text-muted">Under 18s get the food diary but no calorie targets.</p>
    </Card>
  );
}

function EntryModal({ entry, profile, onClose, onChanged }: { entry: FoodEntry; profile: Pick<DietaryProfile, "diets" | "allergies">; onClose: () => void; onChanged: () => void }) {
  const [e, setE] = useState(entry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    const err = await fn();
    setBusy(false);
    if (err) return setError(err);
    onChanged();
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit food"
      footer={
        <>
          <Button variant="danger" onClick={() => run(() => deleteEntry(e.id))} disabled={busy}>
            <Trash2 size={16} /> Delete
          </Button>
          <Button onClick={() => run(() => saveEntry(e))} disabled={busy}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Notice tone="error">{error}</Notice>}
        <Segmented value={e.meal} onChange={(meal: MealType) => setE({ ...e, meal })} options={MEALS.map((m) => ({ value: m.id, label: m.label }))} className="w-full" />
        <FoodEditor item={e} profile={profile} onChange={setE} />
      </div>
    </Modal>
  );
}

/** A client's food diary: the day's calories and macros, meals, a week at a glance, and what their coach said. */
export function NutritionPage() {
  const [day, setDay] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("day");
      return q && DAY_RE.test(q) ? q : dayString();
    } catch {
      return dayString();
    }
  });
  const today = dayString();
  const to = day > today ? day : today;
  const from = dayAdd(to, -29);
  const { bundle, error, loading, reload, offline } = useDiary(undefined, from, to);
  const [adding, setAdding] = useState<MealType | null>(null);
  const [editing, setEditing] = useState<FoodEntry | null>(null);
  const [settings, setSettings] = useState(false);

  if (!bundle) return <div className="py-16 text-center text-sm text-muted">{error ?? "Loading your food diary…"}</div>;
  if (bundle.settings.adult === null) return (
    <>
      <PageHeader title="Nutrition" subtitle="Your food diary" />
      <AdultGate onDone={reload} />
    </>
  );

  const { entries, targets: rawTargets, settings: profile, comments } = bundle;
  const targets: NutritionTargets | null = profile.adult === false ? null : rawTargets;
  const dayEntries = entries.filter((e) => e.day === day);
  const total = sumMacros(dayEntries);
  const week = weekSummary(entries, daysBack(day, 7), targets);
  const maxKcal = Math.max(targets ? targets.kcal * 1.25 : 0, ...week.days.map((d) => d.kcal), 1);
  const dayComments = comments.filter((c) => c.day === day);
  const waiting = diaryOutbox.pendingIds();
  const left = targets ? targets.kcal - total.kcal : null;

  return (
    <div className={cn("space-y-5", loading && "opacity-70")}>
      <PageHeader
        title="Nutrition"
        subtitle="Your food diary"
        actions={
          <Button variant="secondary" onClick={() => setSettings(true)}>
            <Settings2 size={16} /> Diet & targets
          </Button>
        }
      />

      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-label="Previous day" onClick={() => setDay(dayAdd(day, -1))} className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface text-muted hover:text-ink">
          <ChevronLeft size={20} />
        </button>
        <div className="text-center">
          <div className="text-lg font-bold">{dayLabel(day)}</div>
          <div className="text-xs text-muted">{format(parseISO(day), "EEEE d MMMM yyyy")}</div>
        </div>
        <button type="button" aria-label="Next day" onClick={() => setDay(dayAdd(day, 1))} disabled={day >= format(addDays(new Date(), 1), "yyyy-MM-dd")} className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface text-muted hover:text-ink disabled:opacity-30">
          <ChevronRight size={20} />
        </button>
      </div>

      {offline && <p className="rounded-xl border border-line bg-field px-3 py-2 text-xs text-muted">No signal. This is the diary as you last saw it; foods you add are kept on this phone and sent when you are back online.</p>}

      <Card className="space-y-4 p-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted">Calories</div>
            <div className="text-3xl font-bold tabular-nums">
              {total.kcal}
              {targets && <span className="text-base font-semibold text-muted"> / {targets.kcal}</span>}
            </div>
          </div>
          {left !== null && <div className={cn("text-right text-sm font-semibold", left < 0 ? "text-pr" : "text-success")}>{left >= 0 ? `${left} left` : `${-left} over`}</div>}
        </div>
        {targets && (
          <div className="h-3 overflow-hidden rounded-full bg-field">
            <div className={cn("h-full rounded-full transition-all", total.kcal > targets.kcal * 1.1 ? "bg-pr" : "bg-success")} style={{ width: `${Math.min(100, (total.kcal / targets.kcal) * 100)}%` }} />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Bar label="Protein" value={total.protein} target={targets?.protein} unit="g" tone="success" />
          <Bar label="Carbs" value={total.carbs} target={targets?.carbs || undefined} unit="g" />
          <Bar label="Fat" value={total.fat} target={targets?.fat || undefined} unit="g" tone="pr" />
        </div>
        {!targets && profile.adult !== false && (
          <button type="button" onClick={() => setSettings(true)} className="text-xs font-semibold text-accent">
            Set daily targets to see how you’re doing →
          </button>
        )}
        {targets && <div className="text-xs text-muted">Targets set by {targets.setBy === "COACH" ? "your coach" : "you"}.</div>}
      </Card>

      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-bold uppercase tracking-wider text-muted">Last 7 days</span>
          <span className="text-muted">
            {week.loggedDays} logged{targets ? ` · ${week.onTargetDays} on target` : ""}
            {week.loggedDays > 0 ? ` · avg ${week.avgKcal} kcal` : ""}
          </span>
        </div>
        <div className="flex h-20 items-end gap-1.5">
          {week.days.map((d) => (
            <button key={d.day} type="button" onClick={() => setDay(d.day)} aria-label={`${format(parseISO(d.day), "EEE d MMM")}: ${d.kcal} kcal`} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <div className={cn("w-full rounded-t-md transition-all", d.day === day ? "ring-2 ring-accent" : "", d.onTarget ? "bg-success" : d.logged ? "bg-accent/60" : "bg-field")} style={{ height: `${Math.max(d.logged ? 6 : 3, (d.kcal / maxKcal) * 100)}%` }} />
              <span className={cn("text-[10px]", d.day === day ? "font-bold text-ink" : "text-muted")}>{format(parseISO(d.day), "EEEEE")}</span>
            </button>
          ))}
        </div>
      </Card>

      {dayComments.map((c) => (
        <div key={c.id} className="flex items-start gap-3 rounded-2xl border border-accent/30 bg-accent/10 p-3">
          <MessageSquare size={18} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0 text-sm">
            <div className="text-xs font-bold text-accent">{c.authorName} · your coach</div>
            <div className="whitespace-pre-wrap">{c.text}</div>
          </div>
        </div>
      ))}

      {MEALS.map((m) => {
        const list = dayEntries.filter((e) => e.meal === m.id);
        const sub = sumMacros(list);
        return (
          <section key={m.id}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
                {m.label} {list.length > 0 && <span className="ml-1 font-semibold normal-case tracking-normal">· {sub.kcal} kcal</span>}
              </h2>
              <Button size="sm" variant="secondary" onClick={() => setAdding(m.id)}>
                <Plus size={14} /> Add
              </Button>
            </div>
            {list.length === 0 ? (
              <button type="button" onClick={() => setAdding(m.id)} className="w-full rounded-xl border border-dashed border-line py-4 text-sm text-muted hover:border-accent hover:text-accent">
                Nothing logged
              </button>
            ) : (
              <div className="space-y-1.5">
                {list.map((e) => {
                  const warn = dietConflicts(profile, e.contains).length > 0;
                  return (
                    <button key={e.id} type="button" onClick={() => setEditing(e)} className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left transition-colors hover:border-accent/50">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-semibold">{e.name}</span>
                          {warn && <AlertTriangle size={14} className="shrink-0 text-danger" aria-label="Doesn’t fit your diet or allergies" />}
                          {e.approx && <Badge className="border-pr/30 bg-pr/10 text-pr">approx.</Badge>}
                          {waiting.has(e.id) && <Badge className="border-accent/30 bg-accent/10 text-accent">waiting to sync</Badge>}
                        </div>
                        <div className="truncate text-xs text-muted">
                          {e.amountText || "1 serving"} · P {Math.round(e.protein)} · C {Math.round(e.carbs)} · F {Math.round(e.fat)}
                        </div>
                      </div>
                      <div className="shrink-0 text-sm font-bold tabular-nums">
                        {e.kcal}
                        <span className="ml-0.5 text-[10px] font-semibold text-muted">kcal</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      <p className="pb-2 text-xs text-muted">{DISCLAIMER}</p>

      {adding && <AddFood day={day} initialMeal={adding} entries={entries} profile={profile} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); reload(); }} />}
      {editing && <EntryModal key={editing.id} entry={editing} profile={profile} onClose={() => setEditing(null)} onChanged={reload} />}
      {settings && <NutritionSettings settings={profile} targets={rawTargets} onClose={() => setSettings(false)} onChanged={reload} />}
    </div>
  );
}

