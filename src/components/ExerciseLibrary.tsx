"use client";

import { Check, Plus, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EQUIPMENT, MEASURE_LABELS, MUSCLES } from "@/data/exercises";
import { useViewer } from "@/lib/hooks";
import { CORE_SPORTS, disciplineOf, JOINTS, SUB_CATEGORIES, sportLabel, STRENGTH, TISSUES } from "@/lib/sports";
import { addExercise, loadAllNicheExercises } from "@/lib/store";
import { fallbackType, PRESET_LABELS, TRACKING_PRESETS } from "@/lib/tracking";
import type { Equipment, Exercise, MeasureType, MuscleGroup } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge, Button, Field, Input, Modal, Select } from "./ui";

function subsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

export function searchExercises(list: Exercise[], query: string): Exercise[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const aliases: Record<string, string> = { rdl: "romanian deadlift", rdls: "romanian deadlift", ohp: "overhead press", db: "dumbbell", bb: "barbell" };
  const tokens = q.split(/\s+/).map((t) => aliases[t] ?? t);
  const scored: { ex: Exercise; score: number }[] = [];
  for (const ex of list) {
    const hay = `${ex.name} ${ex.primary} ${ex.equipment} ${ex.secondary.join(" ")} ${ex.discipline ?? ""} ${ex.subCategory ?? ""} ${(ex.joints ?? []).join(" ")} ${(ex.tissues ?? []).join(" ")}`.toLowerCase();
    const name = ex.name.toLowerCase();
    let score = 0;
    let ok = true;
    for (const t of tokens) {
      if (name.includes(t)) score += name.startsWith(t) ? 4 : 3;
      else if (hay.includes(t)) score += 2;
      else if (t.length >= 3 && subsequence(t, name.replace(/[^a-z]/g, ""))) score += 1;
      else {
        ok = false;
        break;
      }
    }
    if (ok) scored.push({ ex, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.ex.name.localeCompare(b.ex.name)).map((s) => s.ex);
}

/**
 * Hides a sticky bar while the user scrolls down and brings it back only after a deliberate
 * upward scroll (or when back at the top). Works for a modal's scroll container or the window.
 */
function useHideOnScroll(ref: React.RefObject<HTMLElement | null>): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let scroller: HTMLElement | null = el.parentElement;
    while (scroller) {
      const oy = getComputedStyle(scroller).overflowY;
      if (oy === "auto" || oy === "scroll") break;
      scroller = scroller.parentElement;
    }
    const target: HTMLElement | Window = scroller ?? window;
    const top = () => (scroller ? scroller.scrollTop : window.scrollY);
    let last = top();
    let upTravel = 0;
    const onScroll = () => {
      const cur = top();
      const delta = cur - last;
      last = cur;
      if (cur <= 8) {
        upTravel = 0;
        setHidden(false);
      } else if (delta > 0) {
        upTravel = 0;
        if (cur > 60) setHidden(true);
      } else if (delta < 0) {
        upTravel += -delta;
        if (upTravel > 48) setHidden(false);
      }
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [ref]);
  return hidden;
}

interface BrowserProps {
  exercises: Exercise[];
  selectable?: boolean;
  selected?: string[];
  onToggle?: (ex: Exercise) => void;
  onOpen?: (ex: Exercise) => void;
  restrictTypes?: MeasureType[];
  /** Tailwind `top-*` classes for the sticky bar (page mode sits below the mobile header). */
  stickyOffset?: string;
  /** A coach choosing exercises for this client: the client's assigned focuses decide what is shown first. */
  clientId?: string;
  /** Coach: open the "add a sport with AI" flow (optionally for the sport being viewed). */
  onAiSport?: (sport?: string) => void;
}

/** Sports in a sensible order: the given ones first, then the built-in ones, then any others by name. */
function orderSports(present: string[], first: string[]): string[] {
  const rest = [...CORE_SPORTS, ...present.filter((d) => !(CORE_SPORTS as readonly string[]).includes(d)).sort()].filter((d, i, a) => a.indexOf(d) === i && present.includes(d));
  return [...first.filter((d) => present.includes(d)), ...rest.filter((d) => !first.includes(d))];
}

export function ExerciseBrowser({ exercises, selectable, selected = [], onToggle, onOpen, restrictTypes, stickyOffset, clientId, onAiSport }: BrowserProps) {
  const { db, user, isTrainer } = useViewer();
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<MuscleGroup | "All">("All");
  const [equipment, setEquipment] = useState<Equipment | "All">("All");
  const [target, setTarget] = useState("All");
  const [sub, setSub] = useState("All");
  const [pill, setPill] = useState("base");
  const [browseAll, setBrowseAll] = useState(false);

  // What to show first. A client sticks strictly to the focus(es) their coach assigned; a coach picking for a client follows
  // that client's focus (with a way to browse everything); a coach on their own starts from their specialties.
  const own = user ? db.clients.find((c) => c.id === user.id) : undefined;
  const forClient = isTrainer ? (clientId ? db.clients.find((c) => c.id === clientId) : undefined) : own;
  const focuses = forClient?.focuses ?? [];
  const strict = !isTrainer && !user?.personal && focuses.length > 0;
  const baseSports = focuses.length ? focuses : isTrainer || user?.personal ? (db.settings.specialties ?? []) : [];
  const baseLabel = strict ? "All my focuses" : focuses.length ? "All assigned focuses" : "★ My niches";

  const present = useMemo(() => [...new Set(exercises.map((e) => disciplineOf(e)))], [exercises]);
  const showEverything = !strict && (baseSports.length === 0 || browseAll);
  const eff = pill === "base" && baseSports.length === 1 ? baseSports[0] : pill;
  const sports = showEverything ? orderSports(present, baseSports) : baseSports;

  const inScope = (e: Exercise) => {
    const d = disciplineOf(e);
    if (strict && !baseSports.includes(d)) return false;
    if (eff === "all") return true;
    if (eff === "base") return baseSports.length ? baseSports.includes(d) : true;
    return d === eff;
  };
  const single = eff !== "all" && eff !== "base" ? eff : null;

  const scoped = exercises.filter(inScope);
  const subs = single ? [...new Set(scoped.map((e) => e.subCategory).filter((x): x is string => !!x))].sort((a, b) => SUB_CATEGORIES.indexOf(a as (typeof SUB_CATEGORIES)[number]) - SUB_CATEGORIES.indexOf(b as (typeof SUB_CATEGORIES)[number])) : [];

  let list = scoped;
  if (restrictTypes) list = list.filter((e) => restrictTypes.includes(e.type));
  if (sub !== "All") list = list.filter((e) => e.subCategory === sub);
  if (muscle !== "All") list = list.filter((e) => e.primary === muscle);
  if (equipment !== "All") list = list.filter((e) => e.equipment === equipment);
  if (target !== "All") list = list.filter((e) => e.joints?.includes(target) || e.tissues?.includes(target));
  const results = searchExercises(list, query);

  const barRef = useRef<HTMLDivElement>(null);
  const hidden = useHideOnScroll(barRef);
  const choose = (key: string) => {
    setPill(key);
    setSub("All");
    if (key === "all") void loadAllNicheExercises(); // other niches' shared drills load on demand
  };
  const pillClass = (on: boolean) => cn("min-h-9 shrink-0 rounded-full border px-3 text-xs font-semibold transition-colors", on ? "border-accent bg-accent text-on-accent" : "border-line bg-field text-muted hover:text-ink");

  return (
    <div>
      <div
        ref={barRef}
        className={cn(
          "sticky z-10 -mx-1 space-y-3 bg-surface px-1 pb-3 transition-transform duration-200",
          stickyOffset ?? "top-0",
          hidden && "pointer-events-none -translate-y-[calc(100%+4rem)]",
        )}
      >
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search e.g. incline bench, knee, jab, mobility…" className="pl-9" />
        </div>

        {/* Sport / focus */}
        {(baseSports.length > 0 || sports.length > 1) && (
          <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1" aria-label="Sport">
            {baseSports.length > 1 && (
              <button onClick={() => choose("base")} className={pillClass(eff === "base")}>
                {baseLabel}
              </button>
            )}
            {baseSports.length === 0 && (
              <button onClick={() => choose("all")} className={pillClass(eff === "all" || eff === "base")}>
                All sports
              </button>
            )}
            {sports.map((s) => (
              <button key={s} onClick={() => choose(s)} className={pillClass(eff === s)}>
                {isTrainer && !focuses.length && s === baseSports[0] ? "★ " : ""}
                {sportLabel(s)}
              </button>
            ))}
            {baseSports.length > 0 && showEverything && (
              <button onClick={() => choose("all")} className={pillClass(eff === "all")}>
                All sports
              </button>
            )}
            {baseSports.length > 0 && !strict && !browseAll && (
              <button
                onClick={() => {
                  setBrowseAll(true);
                  void loadAllNicheExercises();
                }}
                className="min-h-9 shrink-0 rounded-full border border-dashed border-accent/50 px-3 text-xs font-semibold text-accent hover:bg-accent/10">
                {isTrainer && !focuses.length ? "+ Show all sports" : "+ Browse all other sports"}
              </button>
            )}
          </div>
        )}

        {subs.length > 1 && (
          <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1" aria-label="Type of exercise">
            {["All", ...subs].map((x) => (
              <button key={x} onClick={() => setSub(x)} className={cn("min-h-8 shrink-0 rounded-full px-3 text-[11px] font-semibold transition-colors", sub === x ? "bg-accent/20 text-accent" : "bg-field text-muted hover:text-ink")}>
                {x === "All" ? "All types" : x}
              </button>
            ))}
          </div>
        )}

        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {(["All", ...MUSCLES] as const).map((m) => (
            <button key={m} onClick={() => setMuscle(m)} className={pillClass(muscle === m)}>
              {m}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select value={equipment} onChange={(e) => setEquipment(e.target.value as Equipment | "All")} className="h-10" aria-label="Filter by equipment">
            <option value="All">All equipment</option>
            {EQUIPMENT.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </Select>
          <Select value={target} onChange={(e) => setTarget(e.target.value)} className="h-10" aria-label="Filter by joint, tendon or ligament">
            <option value="All">All joints &amp; tissues</option>
            <optgroup label="Joints">
              {JOINTS.map((j) => (
                <option key={j}>{j}</option>
              ))}
            </optgroup>
            <optgroup label="Tendons & ligaments">
              {TISSUES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </optgroup>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-muted">
          <span>{results.length} exercises</span>
          {isTrainer && onAiSport && (
            <button type="button" onClick={() => onAiSport(single ?? undefined)} className="inline-flex items-center gap-1 font-semibold text-accent">
              <Sparkles size={12} /> {single ? `More ${sportLabel(single)} drills with AI` : "Add a sport with AI"}
            </button>
          )}
        </div>
      </div>

      <ul className="divide-y divide-line">
        {results.map((ex) => {
          const isSel = selected.includes(ex.id);
          const d = disciplineOf(ex);
          const tags = [...(ex.joints ?? []), ...(ex.tissues ?? [])];
          return (
            <li key={ex.id}>
              <button
                onClick={() => (selectable ? onToggle?.(ex) : onOpen?.(ex))}
                className={cn(
                  "flex min-h-14 w-full items-center gap-3 px-1 py-2 text-left transition-colors hover:bg-field/60",
                  isSel && "bg-accent/10",
                )}
              >
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    isSel ? "bg-accent text-on-accent" : "bg-field text-muted",
                  )}
                >
                  {isSel ? <Check size={18} /> : ex.name[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{ex.name}</div>
                  <div className="truncate text-xs text-muted">
                    {ex.primary} · {ex.equipment}
                    {d !== STRENGTH && ` · ${sportLabel(d)}`}
                    {ex.subCategory && ` · ${ex.subCategory}`}
                  </div>
                  {tags.length > 0 && <div className="truncate text-[11px] text-accent/80">{tags.join(" · ")}</div>}
                </div>
                {ex.custom && <Badge className="border-accent/30 bg-accent/15 text-accent">Custom</Badge>}
              </button>
            </li>
          );
        })}
        {results.length === 0 && (
          <li className="py-10 text-center text-sm text-muted">
            No exercises match. Try a different search or create a custom one.
            {isTrainer && onAiSport && (
              <div className="mt-2">
                <button type="button" onClick={() => onAiSport(single ?? (query.trim().length > 2 ? query.trim() : undefined))} className="font-semibold text-accent">
                  Search any sport with AI →
                </button>
              </div>
            )}
          </li>
        )}
      </ul>
    </div>
  );
}

/* ---------- Picker modal for workouts / templates ---------- */
export function ExercisePicker({
  open,
  onClose,
  onConfirm,
  confirmLabel = "Add",
  clientId,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (exerciseIds: string[]) => void;
  confirmLabel?: string;
  /** The client the workout is for (their assigned focus decides what is shown first). */
  clientId?: string;
}) {
  const { exercises } = useViewer();
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const close = () => {
    setSelected([]);
    onClose();
  };

  return (
    <>
      <Modal
        open={open}
        onClose={close}
        title="Choose exercises"
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(true)} className="mr-auto">
              <Plus size={16} /> Custom
            </Button>
            <Button
              disabled={selected.length === 0}
              onClick={() => {
                onConfirm(selected);
                setSelected([]);
                onClose();
              }}
            >
              {confirmLabel} {selected.length > 0 ? `${selected.length} exercise${selected.length > 1 ? "s" : ""}` : ""}
            </Button>
          </>
        }
      >
        <ExerciseBrowser
          exercises={exercises}
          clientId={clientId}
          selectable
          selected={selected}
          onToggle={(ex) => setSelected((s) => (s.includes(ex.id) ? s.filter((x) => x !== ex.id) : [...s, ex.id]))}
        />
      </Modal>
      <CreateExerciseModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(ex) => setSelected((s) => [...s, ex.id])}
      />
    </>
  );
}

/* ---------- Create custom exercise ---------- */
export function CreateExerciseModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (ex: Exercise) => void;
}) {
  const [name, setName] = useState("");
  const [primary, setPrimary] = useState<MuscleGroup>("Chest");
  const [secondary, setSecondary] = useState<MuscleGroup[]>([]);
  const [equipment, setEquipment] = useState<Equipment>("Barbell");
  const [type, setType] = useState<MeasureType>("WEIGHT_REPS");
  const { db, user, isTrainer } = useViewer();
  const own = user ? db.clients.find((c) => c.id === user.id) : undefined;
  const sportChoices = !isTrainer && own?.focuses?.length ? own.focuses : [...CORE_SPORTS, ...(db.settings.sports ?? [])];
  const [discipline, setDiscipline] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [preset, setPreset] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const sport = discipline && sportChoices.includes(discipline) ? discipline : sportChoices[0];

  const reset = () => {
    setName("");
    setSecondary([]);
    setPrimary("Chest");
    setEquipment("Barbell");
    setType("WEIGHT_REPS");
    setDiscipline("");
    setSubCategory("");
    setPreset("");
    setTags([]);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create custom exercise"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={() => {
              const tracking = preset ? structuredClone(TRACKING_PRESETS[preset]) : undefined;
              const ex = addExercise({
                name: name.trim(),
                primary,
                secondary,
                equipment,
                type: tracking ? fallbackType(tracking) : type,
                ...(sport && sport !== STRENGTH ? { discipline: sport } : {}),
                ...(subCategory ? { subCategory } : {}),
                ...(tags.some((t) => (JOINTS as readonly string[]).includes(t)) ? { joints: tags.filter((t) => (JOINTS as readonly string[]).includes(t)) } : {}),
                ...(tags.some((t) => (TISSUES as readonly string[]).includes(t)) ? { tissues: tags.filter((t) => (TISSUES as readonly string[]).includes(t)) } : {}),
                ...(tracking ? { tracking } : {}),
              });
              onCreated?.(ex);
              reset();
              onClose();
            }}
          >
            Save exercise
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Exercise name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tempo Back Squat" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Primary muscle">
            <Select value={primary} onChange={(e) => setPrimary(e.target.value as MuscleGroup)}>
              {MUSCLES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field label="Equipment">
            <Select value={equipment} onChange={(e) => setEquipment(e.target.value as Equipment)}>
              {EQUIPMENT.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sport">
            <Select value={sport} onChange={(e) => setDiscipline(e.target.value)}>
              {sportChoices.map((s) => (
                <option key={s} value={s}>
                  {sportLabel(s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type of exercise">
            <Select value={subCategory} onChange={(e) => setSubCategory(e.target.value)}>
              <option value="">Not set</option>
              {SUB_CATEGORIES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Measurement type">
            <Select value={type} onChange={(e) => setType(e.target.value as MeasureType)} disabled={!!preset}>
              {(Object.keys(MEASURE_LABELS) as MeasureType[]).map((t) => (
                <option key={t} value={t}>
                  {MEASURE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Or a sport format">
            <Select value={preset} onChange={(e) => setPreset(e.target.value)}>
              <option value="">Use the measurement type</option>
              {Object.keys(PRESET_LABELS).map((k) => (
                <option key={k} value={k}>
                  {PRESET_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Joints &amp; connective tissue</div>
          <div className="flex flex-wrap gap-1.5">
            {[...JOINTS, ...TISSUES].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))}
                className={cn("min-h-9 rounded-full border px-3 text-xs font-semibold", tags.includes(t) ? "border-accent bg-accent/20 text-accent" : "border-line bg-field text-muted")}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Secondary muscles</div>
          <div className="flex flex-wrap gap-1.5">
            {MUSCLES.filter((m) => m !== primary).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setSecondary((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]))}
                className={cn(
                  "min-h-9 rounded-full border px-3 text-xs font-semibold",
                  secondary.includes(m) ? "border-accent bg-accent/20 text-accent" : "border-line bg-field text-muted",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
