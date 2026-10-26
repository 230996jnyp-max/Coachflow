"use client";

import { Check, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, Field, Input, Modal, Notice, Select, Toggle } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { CORE_SPORTS, SUB_CATEGORIES, sportLabel } from "@/lib/sports";
import { addExercise, api, updateSettings } from "@/lib/store";
import { describeSchema, fallbackType } from "@/lib/tracking";
import type { Equipment, MuscleGroup, TrackingSchema } from "@/lib/types";

interface Generated {
  name: string;
  subCategory: string;
  primary: MuscleGroup;
  secondary: MuscleGroup[];
  equipment: Equipment;
  tracking: TrackingSchema;
  joints: string[];
  tissues: string[];
}

const IDEAS = ["Tennis", "Muay Thai", "Badminton", "Pilates", "Golf", "Soccer", "Climbing", "Volleyball"];

/** The built-in or already-added sport this name refers to ("boxing" -> "Boxing & Combat Conditioning"), else the name as typed. */
export function canonicalSport(name: string, added: string[]): string {
  const n = name.trim().toLowerCase();
  const all = [...CORE_SPORTS, ...added];
  return all.find((s) => s.toLowerCase() === n || sportLabel(s).toLowerCase() === n) ?? name.trim();
}

/**
 * "Search / add any sport with AI": the coach types a sport (or an existing one, for more drills) and the AI designs
 * sport-specific drills with a sensible tracking format. The coach ticks (and can rename) the ones to keep, then saves them
 * and the sport in one tap. Nothing is saved before that.
 */
export function AiSportModal({ open, onClose, initialSport = "" }: { open: boolean; onClose: () => void; initialSport?: string }) {
  return open ? <Flow key={initialSport} onClose={onClose} initialSport={initialSport} /> : null;
}

function Flow({ onClose, initialSport }: { onClose: () => void; initialSport: string }) {
  const { db } = useViewer();
  const added = db.settings.sports ?? [];
  const [sport, setSport] = useState(initialSport);
  const [count, setCount] = useState(20);
  const [sub, setSub] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ sport: string; list: Generated[] } | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [names, setNames] = useState<Record<number, string>>({});
  const [special, setSpecial] = useState(true);
  const [done, setDone] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    const existing = db.exercises.filter((e) => (e.discipline ?? "").toLowerCase().includes(sport.trim().toLowerCase())).map((e) => e.name);
    const r = await api<{ sport: string; exercises: Generated[] }>("/api/ai/sport-exercises", { body: { sport: sport.trim(), count, subCategory: sub || undefined, existing: existing.slice(0, 60) } });
    setBusy(false);
    if (!r.ok || !r.data) return setError(r.error ?? "The AI couldn't do that right now. Try again in a moment.");
    setResult({ sport: canonicalSport(r.data.sport || sport, added), list: r.data.exercises });
    setPicked(new Set(r.data.exercises.map((_, i) => i)));
    setNames({});
  };

  const groups = useMemo(() => {
    const map = new Map<string, { i: number; ex: Generated }[]>();
    (result?.list ?? []).forEach((ex, i) => {
      const k = (SUB_CATEGORIES as readonly string[]).includes(ex.subCategory) ? ex.subCategory : "Skill & Technique";
      map.set(k, [...(map.get(k) ?? []), { i, ex }]);
    });
    return [...map.entries()].sort((a, b) => SUB_CATEGORIES.indexOf(a[0] as (typeof SUB_CATEGORIES)[number]) - SUB_CATEGORIES.indexOf(b[0] as (typeof SUB_CATEGORIES)[number]));
  }, [result]);

  const save = () => {
    if (!result) return;
    const discipline = result.sport;
    let n = 0;
    result.list.forEach((ex, i) => {
      if (!picked.has(i)) return;
      const name = (names[i] ?? ex.name).trim();
      if (!name) return;
      addExercise({
        name,
        primary: ex.primary,
        secondary: ex.secondary,
        equipment: ex.equipment,
        type: fallbackType(ex.tracking),
        discipline,
        subCategory: ex.subCategory,
        ...(ex.joints.length ? { joints: ex.joints } : {}),
        ...(ex.tissues.length ? { tissues: ex.tissues } : {}),
        tracking: ex.tracking,
      });
      n++;
    });
    const isCore = (CORE_SPORTS as readonly string[]).includes(discipline);
    const sports = isCore || added.includes(discipline) ? added : [...added, discipline];
    const specialties = db.settings.specialties ?? [];
    updateSettings({ sports, ...(special && !specialties.includes(discipline) ? { specialties: [...specialties, discipline] } : {}) });
    setDone(`${n} exercise${n === 1 ? "" : "s"} added to ${sportLabel(discipline)}.`);
  };

  if (done) {
    return (
      <Modal open onClose={onClose} title="Sport saved" footer={<Button onClick={onClose}>Done</Button>}>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Check size={44} className="rounded-full bg-success/15 p-2.5 text-success" />
          <div className="text-lg font-bold">{done}</div>
          <p className="text-sm text-muted">They are in your Exercise Library under this sport, and your clients can use them when you assign the focus.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={result ? `${sportLabel(result.sport)} — review drills` : "Add a sport with AI"}
      wide
      footer={
        result ? (
          <>
            <Button variant="secondary" onClick={() => setResult(null)}>
              ← Back
            </Button>
            <Button onClick={save} disabled={picked.size === 0}>
              Save {picked.size} exercise{picked.size === 1 ? "" : "s"} & sport
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={generate} disabled={busy || sport.trim().length < 2}>
              <Sparkles size={15} /> {busy ? "Designing drills… (up to 40 s)" : "Generate drills"}
            </Button>
          </>
        )
      }
    >
      {!result ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">Type any sport or training discipline. The AI designs drills that make athletes better at it — technique, footwork, sport conditioning and mobility — and picks how each one is tracked.</p>
          <Field label="Sport or discipline">
            <Input value={sport} onChange={(e) => setSport(e.target.value)} maxLength={60} placeholder="e.g. Tennis, Muay Thai, Pilates…" autoFocus />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {IDEAS.map((i) => (
              <button key={i} type="button" onClick={() => setSport(i)} className="min-h-9 rounded-full border border-line bg-field px-3 text-xs font-semibold text-muted hover:text-ink">
                {i}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="How many drills">
              <Select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[10, 15, 20, 24].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Emphasis (optional)">
              <Select value={sub} onChange={(e) => setSub(e.target.value)}>
                <option value="">A mix of everything</option>
                {SUB_CATEGORIES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="text-xs text-muted">Already have the sport? Type its name to get more drills — ones you already have are skipped.</p>
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-semibold">{result.list.length} drills for {result.sport}</span>
            <span className="flex gap-2">
              <button type="button" className="text-xs font-semibold text-accent" onClick={() => setPicked(new Set(result.list.map((_, i) => i)))}>
                Select all
              </button>
              <button type="button" className="text-xs font-semibold text-muted" onClick={() => setPicked(new Set())}>
                None
              </button>
            </span>
          </div>
          {groups.map(([group, items]) => (
            <section key={group}>
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">{group}</div>
              <ul className="space-y-2">
                {items.map(({ i, ex }) => {
                  const on = picked.has(i);
                  return (
                    <li key={i} className={`rounded-xl border p-3 transition-colors ${on ? "border-accent/40 bg-accent/5" : "border-line"}`}>
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          aria-label={`Keep ${ex.name}`}
                          onClick={() => setPicked((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
                          className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${on ? "border-accent bg-accent text-on-accent" : "border-line bg-field"}`}
                        >
                          {on && <Check size={14} strokeWidth={3} />}
                        </button>
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <Input value={names[i] ?? ex.name} onChange={(e) => setNames((m) => ({ ...m, [i]: e.target.value }))} maxLength={100} aria-label="Drill name" className="h-10 font-semibold" />
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge>{ex.primary}</Badge>
                            <Badge>{ex.equipment}</Badge>
                            {[...ex.joints, ...ex.tissues].map((j) => (
                              <Badge key={j} className="border-accent/30 bg-accent/10 text-accent">
                                {j}
                              </Badge>
                            ))}
                          </div>
                          <div className="text-xs text-muted">Tracks: {describeSchema(ex.tracking)}</div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <Toggle checked={special} onChange={setSpecial} label={`Add ${sportLabel(result.sport)} to my specialties`} />
        </div>
      )}
    </Modal>
  );
}
