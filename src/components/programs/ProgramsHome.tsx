"use client";

import { ClipboardPaste, FileUp, LayoutTemplate, Loader2, Plus, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Notice, Select, Textarea, Toggle } from "@/components/ui";
import { NumberInput } from "@/components/NumberInput";
import { useViewer } from "@/lib/hooks";
import { guessExercise } from "@/lib/exerciseMatch";
import type { ProgramSlot, ProgressionMode } from "@/lib/programs";
import { PROGRESSION_LABEL } from "@/lib/programs";
import { addExercise, api } from "@/lib/store";
import type { Equipment, MuscleGroup } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ProgramSummary {
  id: string;
  name: string;
  description: string;
  weeks: number;
  goal: string;
  level: string;
  source: "manual" | "ai" | "starter" | "import";
  gentle: boolean;
  summary: string;
  slotCount: number;
  activeClients: number;
  updatedAt: string;
}
interface Starter {
  id: string;
  name: string;
  blurb: string;
  goal: string;
  level: string;
  weeks: number;
  days: number;
  gentle: boolean;
}

export const SOURCE_LABEL: Record<ProgramSummary["source"], string> = { manual: "Made by hand", ai: "AI built", starter: "Starter", import: "Imported" };

/**
 * The programs list: yours, with ways to make one (by hand, from a goal with the AI, from a ready-made starter, or by reading text or a file).
 * `base` is where program pages live ("/programs" for coaches, "/ai-trainer/programs" for someone training on their own).
 */
export function ProgramsHome({ base, solo }: { base: string; solo: boolean }) {
  const router = useRouter();
  const [programs, setPrograms] = useState<ProgramSummary[] | null>(null);
  const [starters, setStarters] = useState<Starter[]>([]);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<"new" | "ai" | "starters" | "import" | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ programs: ProgramSummary[]; starters: Starter[]; aiAvailable: boolean }>("/api/programs");
    if (r.ok && r.data) {
      setPrograms(r.data.programs);
      setStarters(r.data.starters);
      setAiAvailable(r.data.aiAvailable);
    } else setError(r.error ?? "Couldn't load your programs.");
  }, []);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await api<{ programs: ProgramSummary[]; starters: Starter[]; aiAvailable: boolean }>("/api/programs");
      if (!alive) return;
      if (r.ok && r.data) {
        setPrograms(r.data.programs);
        setStarters(r.data.starters);
        setAiAvailable(r.data.aiAvailable);
      } else setError(r.error ?? "Couldn't load your programs.");
    })();
    return () => {
      alive = false;
    };
  }, []);

  const go = (id: string) => router.push(`${base}/${id}`);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setModal("ai")}>
          <Sparkles size={16} /> Build with AI
        </Button>
        <Button variant="secondary" onClick={() => setModal("new")}>
          <Plus size={16} /> New program
        </Button>
        <Button variant="secondary" onClick={() => setModal("starters")}>
          <LayoutTemplate size={16} /> Starter programs
        </Button>
        {!solo && (
          <Button variant="secondary" onClick={() => setModal("import")}>
            <ClipboardPaste size={16} /> Import from text or file
          </Button>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {programs === null && !error && <p className="text-sm text-muted">Loading…</p>}
      {programs && programs.length === 0 && (
        <EmptyState
          icon={<Wand2 size={28} />}
          title="No programs yet"
          hint={solo ? "Build one from your goal: the AI designs week 1 using your health answers and equipment, and the app grows it into the whole block." : "Build a multi-week program once, then give it to as many clients as you like. Start with the AI, a starter, or your own text."}
        />
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {programs?.map((p) => (
          <Link key={p.id} href={`${base}/${p.id}`} className="block" data-program={p.id}>
            <Card className="flex h-full flex-col gap-2 p-4 hover:border-accent/50">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 font-bold [overflow-wrap:anywhere]">{p.name}</div>
                <Badge className={cn(p.source === "ai" && "border-accent/30 bg-accent/15 text-accent")}>{SOURCE_LABEL[p.source]}</Badge>
              </div>
              <div className="text-xs text-muted">{p.summary}</div>
              {p.description && <p className="line-clamp-2 text-sm text-muted [overflow-wrap:anywhere]">{p.description}</p>}
              <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                {p.goal && <Badge>{p.goal}</Badge>}
                {p.level && <Badge>{p.level}</Badge>}
                {p.gentle && <Badge className="border-success/30 bg-success/15 text-success">Gentle</Badge>}
                {!solo && p.activeClients > 0 && (
                  <Badge className="border-accent/30 bg-accent/15 text-accent">
                    {p.activeClients} client{p.activeClients === 1 ? "" : "s"} on it
                  </Badge>
                )}
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {modal === "new" && <NewProgramModal onClose={() => setModal(null)} onDone={go} />}
      {modal === "starters" && <StartersModal starters={starters} onClose={() => setModal(null)} onDone={go} />}
      {modal === "ai" && <AiBuilderModal solo={solo} aiAvailable={aiAvailable} onClose={() => setModal(null)} onDone={(id) => { void load(); go(id); }} />}
      {modal === "import" && <ImportProgramModal onClose={() => setModal(null)} onDone={go} />}
    </div>
  );
}

/* ---------------- New, blank ---------------- */
function NewProgramModal({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const [name, setName] = useState("");
  const [weeks, setWeeks] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setError(null);
    const r = await api<{ program: { id: string } }>("/api/programs", { body: { name: name.trim(), weeks } });
    setBusy(false);
    if (r.ok && r.data) onDone(r.data.program.id);
    else setError(r.error ?? "Couldn't make the program.");
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="New program"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !name.trim()} onClick={() => void create()}>
            {busy ? "Making…" : "Make it"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. 8-week strength block" autoFocus />
        </Field>
        <Field label="How many weeks?" hint="1 to 12. You can change it later.">
          <NumberInput label="Weeks" min={1} max={12} value={weeks} onChange={(v) => setWeeks(v ?? weeks)} />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

/* ---------------- Starters ---------------- */
function StartersModal({ starters, onClose, onDone }: { starters: Starter[]; onClose: () => void; onDone: (id: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const use = async (id: string) => {
    setBusy(id);
    setError(null);
    const r = await api<{ program: { id: string } }>("/api/programs/starter", { body: { starterId: id } });
    setBusy(null);
    if (r.ok && r.data) onDone(r.data.program.id);
    else setError(r.error ?? "Couldn't make the program.");
  };
  return (
    <Modal open onClose={onClose} title="Starter programs" wide footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <p className="mb-3 text-sm text-muted">Ready-made and free to use. Each becomes your own copy that you can change, week by week.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <ul className="space-y-2">
        {starters.map((s) => (
          <li key={s.id} className="flex items-center gap-3 rounded-xl border border-line bg-field/50 p-3">
            <div className="min-w-0 flex-1">
              <div className="font-bold">{s.name}</div>
              <div className="text-xs text-muted">{s.blurb}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge>{s.goal}</Badge>
                <Badge>{s.level}</Badge>
                {s.gentle && <Badge className="border-success/30 bg-success/15 text-success">Gentle</Badge>}
              </div>
            </div>
            <Button size="sm" disabled={busy !== null} onClick={() => void use(s.id)}>
              {busy === s.id ? "Making…" : "Use this"}
            </Button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/* ---------------- The AI builder ---------------- */
const GOALS = ["Hypertrophy", "Fat Loss", "Strength", "Conditioning", "General Fitness"];
const LEVELS = ["Beginner", "Intermediate", "Advanced"];

function AiBuilderModal({ solo, aiAvailable, onClose, onDone }: { solo: boolean; aiAvailable: boolean; onClose: () => void; onDone: (id: string) => void }) {
  const { clients } = useViewer();
  const active = clients.filter((c) => !c.profile.archived);
  const [clientId, setClientId] = useState("");
  const [goal, setGoal] = useState("Hypertrophy");
  const [level, setLevel] = useState("Beginner");
  const [weeks, setWeeks] = useState(8);
  const [days, setDays] = useState(3);
  const [minutes, setMinutes] = useState(45);
  const [equipment, setEquipment] = useState("GYM");
  const [focus, setFocus] = useState("");
  const [injuries, setInjuries] = useState("");
  const [progression, setProgression] = useState<ProgressionMode>("reps_then_weight");
  const [gentle, setGentle] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const build = async () => {
    setBusy(true);
    setError(null);
    const r = await api<{ program: { id: string } }>("/api/programs/ai", {
      body: { goal, level, weeks, daysPerWeek: days, sessionMinutes: minutes, equipment, focus, injuries, progression, gentle, name: name.trim() || undefined, ...(clientId ? { clientId } : {}) },
    });
    setBusy(false);
    if (r.ok && r.data) onDone(r.data.program.id);
    else setError(r.error ?? "Couldn't build the program.");
  };

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title="Build a program"
      wide
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void build()}>
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Building… up to a minute
              </>
            ) : (
              <>
                <Sparkles size={16} /> Build it
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!aiAvailable && <Notice tone="warn">The AI is not available right now, so the program is built from the exercise library&apos;s own rules. You can still change every workout.</Notice>}
        <p className="text-sm text-muted">
          {solo
            ? "The AI designs week 1 from your goal, your equipment and your health answers. The app then fills in every week with a little more each time and an easier week every fourth."
            : "The AI designs week 1. The app then fills in every week with a little more each time and an easier week every fourth. Nothing reaches a client until you assign it."}
        </p>
        {!solo && (
          <Field label="For which client?" hint="Optional. Picking a client uses their health answers, injuries and last weights, and keeps unsafe exercises out.">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">No one in particular (a template)</option>
              {active.map((c) => (
                <option key={c.user.id} value={c.user.id}>
                  {c.user.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Goal">
            <Select value={goal} onChange={(e) => setGoal(e.target.value)}>
              {GOALS.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </Select>
          </Field>
          <Field label="Level">
            <Select value={level} onChange={(e) => setLevel(e.target.value)}>
              {LEVELS.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </Select>
          </Field>
          <Field label="Weeks" hint="1 to 12">
            <NumberInput label="Weeks" min={1} max={12} value={weeks} onChange={(v) => setWeeks(v ?? weeks)} />
          </Field>
          <Field label="Workouts a week" hint="2 to 6">
            <NumberInput label="Workouts a week" min={2} max={6} value={days} onChange={(v) => setDays(v ?? days)} />
          </Field>
          <Field label="Minutes per workout" hint="20 to 120">
            <NumberInput label="Minutes" min={20} max={120} step={5} value={minutes} onChange={(v) => setMinutes(v ?? minutes)} />
          </Field>
          {!solo && (
            <Field label="Equipment">
              <Select value={equipment} onChange={(e) => setEquipment(e.target.value)}>
                <option value="GYM">A full gym</option>
                <option value="HOME">At home: dumbbells, bands, a mat</option>
                <option value="BODYWEIGHT">Just their body</option>
              </Select>
            </Field>
          )}
        </div>
        <Field label="Focus" hint="Optional. For example “more back and glutes” or “get stronger at pull-ups”.">
          <Input value={focus} maxLength={120} onChange={(e) => setFocus(e.target.value)} placeholder="Anything to emphasise?" />
        </Field>
        <Field label="Injuries or things to avoid" hint="Optional. For example “sore left shoulder” or “bad knees”. Matching exercises are kept out.">
          <Textarea value={injuries} maxLength={300} rows={2} onChange={(e) => setInjuries(e.target.value)} placeholder="Nothing to avoid" />
        </Field>
        <Field label="How it progresses">
          <Select value={progression} onChange={(e) => setProgression(e.target.value as ProgressionMode)}>
            {(Object.keys(PROGRESSION_LABEL) as ProgressionMode[]).map((k) => (
              <option key={k} value={k}>
                {PROGRESSION_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        {!solo && !clientId && <Toggle checked={gentle} onChange={setGentle} label="Gentle program: modest sets and reps, no jumping or heavy bar lifts" />}
        <Field label="Name" hint="Optional. Otherwise it is named from the goal.">
          <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Summer strength block" />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

/* ---------------- Reading text or a file ---------------- */
interface ImportResult {
  slots: ProgramSlot[];
  weeks: number;
  unmatched: { name: string; timed: boolean; hasWeight: boolean; hasDistance: boolean }[];
  notes: string[];
}

function ImportProgramModal({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const { db } = useViewer();
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<"read" | "file" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const read = async () => {
    setBusy("read");
    setError(null);
    const r = await api<ImportResult>("/api/programs/import", { body: { text } });
    setBusy(null);
    if (r.ok && r.data) setResult(r.data);
    else setError(r.error ?? "Couldn't read that.");
  };

  const pickFile = async (f: File) => {
    setBusy("file");
    setError(null);
    try {
      const res = await fetch(`/api/import/extract?brand=${encodeURIComponent(db.settings.brandName || "CoachFlow")}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(f.name) },
        body: await f.arrayBuffer(),
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => null)) as { text?: string; kind?: string; error?: string } | null;
      if (!res.ok || !data?.text) setError(data?.error ?? "I couldn't read that file. Try a PDF, Word, Excel or text file, or paste the text.");
      else {
        setText(data.text);
        setResult(null);
        setFileNote(`Read ${f.name}. Check the text below, then press Read the program.`);
      }
    } catch {
      setError("Couldn't reach the server to read that file.");
    }
    setBusy(null);
  };

  /** A name that matched nothing becomes a custom exercise (with sensible defaults the coach can change later), then the text is read again. */
  const createCustom = async (u: ImportResult["unmatched"][number]) => {
    const g = guessExercise(u.name, u.timed, u.hasDistance, u.hasWeight);
    const ex = addExercise({ name: u.name.trim().slice(0, 80), primary: g.primary as MuscleGroup, secondary: [], equipment: g.equipment as Equipment, type: g.type });
    // Saved to the server at once, so the program can refer to it straight away.
    await api(`/api/training/exercises/${ex.id}`, { method: "PUT", body: { exercise: ex } });
    await read();
  };

  const save = async () => {
    if (!result) return;
    setBusy("save");
    setError(null);
    const r = await api<{ program: { id: string } }>("/api/programs", { body: { name: name.trim() || "Imported program", weeks: result.weeks, slots: result.slots, source: "import" } });
    setBusy(null);
    if (r.ok && r.data) onDone(r.data.program.id);
    else setError(r.error ?? "Couldn't save the program.");
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Import a program"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {result ? (
            <Button disabled={busy !== null || result.slots.length === 0} onClick={() => void save()}>
              {busy === "save" ? "Saving…" : "Save as a program"}
            </Button>
          ) : (
            <Button disabled={busy !== null || text.trim().length < 10} onClick={() => void read()}>
              {busy === "read" ? "Reading…" : "Read the program"}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {!result ? (
          <>
            <p className="text-sm text-muted">
              Paste a program written as text, or upload a PDF, Word, Excel or text file. Write it as “Week 1”, then “Day 1 Upper body”, then one exercise per line (for example “Bench press 4x8 60kg”). “Weeks 2-4” repeats the block for those weeks.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.rtf,.html,.htm" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pickFile(f); }} />
              <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
                <FileUp size={14} /> {busy === "file" ? "Reading file…" : "Upload a file"}
              </Button>
              {fileNote && <span className="text-xs text-muted">{fileNote}</span>}
            </div>
            <Textarea value={text} rows={12} maxLength={60000} onChange={(e) => setText(e.target.value)} placeholder={"Week 1\nDay 1 Upper body\nBench press 4x8 60kg\nPull up 3x6\nDay 2 Lower body\nSquat 5x5 80kg\nPlank 3 x 45 sec"} aria-label="Program text" />
          </>
        ) : (
          <>
            <Field label="Program name">
              <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Imported program" />
            </Field>
            <Notice tone={result.slots.length ? "success" : "warn"}>
              Read {result.slots.length} workout{result.slots.length === 1 ? "" : "s"} over {result.weeks} week{result.weeks === 1 ? "" : "s"}.
              {result.slots.length === 0 && " Nothing could be read: check the layout and try again."}
            </Notice>
            {result.notes.map((n) => (
              <p key={n} className="text-xs text-muted">
                {n}
              </p>
            ))}
            {result.unmatched.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-bold">These exercises are not in your library</div>
                <p className="text-xs text-muted">Create each as a custom exercise (you can fill in its details later), or leave it out. The program is read again after each one.</p>
                <ul className="space-y-1.5">
                  {result.unmatched.map((u) => (
                    <li key={u.name} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-field/50 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate font-semibold">{u.name}</span>
                      <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void createCustom(u)}>
                        Create it
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={() => setResult(null)}>
              ← Change the text
            </Button>
          </>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
