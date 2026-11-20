"use client";

import { format, parseISO } from "date-fns";
import { Bot, Check, Clock, Pencil, Send, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Notice, Select, Tabs, Textarea, Toggle } from "@/components/ui";
import { hasPortalAccess } from "@/lib/gymPerms";
import { useViewer } from "@/lib/hooks";
import { TONE_LABEL, TONES, TRIGGERS, type Action, type Mode, type Tone, type TriggerId } from "@/lib/autopilot";
import { api } from "@/lib/store";
import { cn } from "@/lib/utils";

export interface RuleView {
  trigger: TriggerId;
  label: string;
  blurb: string;
  kind: "welcome" | "nudge";
  enabled: boolean;
  mode: Mode;
  actions: Action[];
  allowed: string[];
  vars: string[];
  saved: boolean;
}
export interface EventView {
  id: string;
  clientId: string;
  clientName: string;
  trigger: TriggerId;
  label: string;
  status: "DRAFT" | "HELD" | "SENT" | "APPROVED" | "DISMISSED" | "FAILED";
  why: string;
  text: string;
  extras: string[];
  note: string;
  error: string;
  dueAt: string | null;
  createdAt: string;
  decidedAt: string | null;
}
interface Overview {
  rules: RuleView[];
  waiting: EventView[];
  log: EventView[];
  smart: { enabled: boolean; tone: Tone; aiAvailable: boolean; perDay: number };
  packages: { id: string; name: string; sessions: number }[];
  programs: { id: string; name: string }[];
}

const STATE_BASED: TriggerId[] = ["missed_two_workouts", "no_workout_7d", "one_credit_left", "package_ending"];
export const STATUS_STYLE: Record<EventView["status"], string> = {
  DRAFT: "border-pr/40 bg-pr/10 text-pr",
  HELD: "border-accent/40 bg-accent/10 text-accent",
  SENT: "border-success/40 bg-success/15 text-success",
  APPROVED: "border-success/40 bg-success/15 text-success",
  DISMISSED: "border-line bg-field text-muted",
  FAILED: "border-danger/40 bg-danger/10 text-danger",
};
export const STATUS_LABEL: Record<EventView["status"], string> = { DRAFT: "Draft", HELD: "Held for 8 am", SENT: "Sent automatically", APPROVED: "Sent by you", DISMISSED: "Dismissed", FAILED: "Failed" };

type Tab = "rules" | "waiting" | "activity" | "smart" | "team";

/** Autopilot: the rules, the drafts waiting for you, what it has done, and smart replies. */
export function AutopilotPage() {
  const { user } = useViewer();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("rules");
  const [editing, setEditing] = useState<RuleView | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api<Overview>("/api/autopilot");
    if (r.ok && r.data) setData(r.data);
    else setError(r.error ?? "Couldn't load Autopilot.");
  }, []);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await api<Overview>("/api/autopilot");
      if (!alive) return;
      if (r.ok && r.data) setData(r.data);
      else setError(r.error ?? "Couldn't load Autopilot.");
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  const team = !!user && hasPortalAccess(user.gym);

  const setRules = (rules: RuleView[]) => setData({ ...data, rules });
  /** Saves a change to a rule. Returns null when it worked, or the reason it did not. */
  const patch = async (t: TriggerId, body: Record<string, unknown>): Promise<string | null> => {
    const r = await api<{ rules: RuleView[] }>(`/api/autopilot/rules/${t}`, { method: "PUT", body });
    if (r.ok && r.data) {
      setRules(r.data.rules);
      return null;
    }
    const why = r.error ?? "Couldn't save that.";
    setMsg(why);
    return why;
  };
  const starter = async () => {
    setBusy(true);
    const r = await api<{ rules: RuleView[] }>("/api/autopilot/starter", { body: {} });
    setBusy(false);
    if (r.ok && r.data) {
      setRules(r.data.rules);
      setMsg("Starter rules added. Every one is switched off until you turn it on.");
    }
  };
  const runNow = async () => {
    setBusy(true);
    const r = await api<{ result: { created: number; sent: number; held: number; drafts: number; released: number } | null }>("/api/autopilot/run", { body: {} });
    setBusy(false);
    if (!r.ok || !r.data?.result) return setMsg(r.error ?? "Couldn't check.");
    const x = r.data.result;
    setMsg(x.created + x.released === 0 ? "Nothing new to do right now." : `Found ${x.created} new: ${x.sent} sent, ${x.drafts} drafts for you, ${x.held} held for the morning${x.released ? `; ${x.released} held ones were sent` : ""}.`);
    await load();
  };

  const nOn = data.rules.filter((r) => r.enabled).length;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {!data.rules.some((r) => r.saved) && (
          <Button onClick={() => void starter()} disabled={busy}>
            <Bot size={16} /> Add the starter rules
          </Button>
        )}
        <Button variant="secondary" onClick={() => void runNow()} disabled={busy || nOn === 0}>
          Check for new things now
        </Button>
        <span className="text-xs text-muted">{nOn === 0 ? "Every rule is off." : `${nOn} rule${nOn === 1 ? " is" : "s are"} on.`} Nothing goes out between 9 pm and 8 am, or more than 2 automatic messages a day to one client.</span>
      </div>
      {msg && <Notice tone="info">{msg}</Notice>}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "rules", label: "Rules" },
          { value: "waiting", label: data.waiting.length ? `Waiting (${data.waiting.length})` : "Waiting" },
          { value: "activity", label: "Activity" },
          { value: "smart", label: "Smart replies" },
          ...(team ? [{ value: "team" as const, label: "Team" }] : []),
        ]}
      />
      {tab === "rules" && (
        <div className="space-y-3" data-autopilot="rules">
          {data.rules.map((r) => (
            <Card key={r.trigger} className={cn("space-y-2 p-4", r.enabled && "border-accent/40")} data-rule={r.trigger}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{r.label}</div>
                  <div className="text-xs text-muted">{r.blurb}</div>
                </div>
                <Toggle checked={r.enabled} onChange={(v) => void patch(r.trigger, { enabled: v })} label={r.enabled ? "On" : "Off"} />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge className={r.mode === "auto" ? "border-accent/40 bg-accent/10 text-accent" : undefined}>{r.mode === "auto" ? "Sends by itself" : "Drafts for you"}</Badge>
                {r.actions.map((a, i) => (
                  <Badge key={i}>{a.type === "message" ? "Message" : a.type === "form" ? "Forms" : a.type === "program" ? "Program" : a.type === "paylink" ? "Pay link" : "Alert"}</Badge>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                  <Pencil size={14} /> Edit
                </Button>
              </div>
              {r.actions.find((a) => a.type === "message") && <p className="rounded-lg bg-field px-3 py-2 text-sm text-muted [overflow-wrap:anywhere]">{(r.actions.find((a) => a.type === "message") as { text: string }).text}</p>}
              {r.enabled && r.mode === "auto" && STATE_BASED.includes(r.trigger) && <p className="text-xs text-pr">This also messages clients who are already in this situation, so check the words first.</p>}
            </Card>
          ))}
        </div>
      )}
      {tab === "waiting" && <Waiting events={data.waiting} onChange={(waiting) => setData({ ...data, waiting })} reload={load} />}
      {tab === "activity" && <Activity events={data.log} />}
      {tab === "smart" && <Smart smart={data.smart} onChange={(smart) => setData({ ...data, smart })} />}
      {tab === "team" && <Team />}
      {editing && (
        <RuleEditor
          rule={editing}
          packages={data.packages}
          programs={data.programs}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            const why = await patch(editing.trigger, body);
            if (!why) setEditing(null);
            return why;
          }}
        />
      )}
    </div>
  );
}

/* ---------------- Drafts ---------------- */
export function Waiting({ events, onChange, reload }: { events: EventView[]; onChange: (e: EventView[]) => void; reload?: () => void | Promise<void> }) {
  const [text, setText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const decide = async (e: EventView, action: "send" | "dismiss") => {
    setBusy(e.id);
    setErr(null);
    const r = await api<{ waiting: EventView[]; status: string; error?: string }>(`/api/autopilot/events/${e.id}`, { body: { action, ...(action === "send" && text[e.id] !== undefined ? { text: text[e.id] } : {}) } });
    setBusy(null);
    if (!r.ok || !r.data) return setErr(r.error ?? "That didn't work.");
    onChange(r.data.waiting);
    if (r.data.status === "FAILED") setErr(r.data.error ?? "It could not be sent.");
    void reload?.();
  };
  if (events.length === 0) return <EmptyState icon={<Clock size={26} />} title="Nothing waiting" hint="Drafts you need to approve, and messages held for the morning, show up here." />;
  return (
    <div className="space-y-3" data-autopilot="waiting">
      {err && <Notice tone="error">{err}</Notice>}
      {events.map((e) => (
        <Card key={e.id} className="space-y-2 p-4" data-event={e.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <Link href={`/clients/${e.clientId}`} className="font-bold hover:underline">
                {e.clientName}
              </Link>
              <span className="text-xs text-muted"> · {e.label}</span>
            </div>
            <Badge className={STATUS_STYLE[e.status]}>{e.status === "HELD" && e.dueAt ? `Held until ${format(parseISO(e.dueAt), "EEE h:mm a")}` : STATUS_LABEL[e.status]}</Badge>
          </div>
          <p className="text-xs text-muted">{e.why}</p>
          {e.text ? (
            <Textarea rows={3} maxLength={600} value={text[e.id] ?? e.text} onChange={(ev) => setText({ ...text, [e.id]: ev.target.value })} aria-label="Message" className="text-sm" />
          ) : (
            <p className="text-sm text-muted">{e.extras.join(", ") || "No message."}</p>
          )}
          {e.text && e.extras.length > 0 && <p className="text-xs text-muted">Also: {e.extras.join(", ")}.</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy !== null} onClick={() => void decide(e, "send")}>
              <Send size={14} /> {e.status === "HELD" ? "Send now" : "Send"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void decide(e, "dismiss")}>
              <X size={14} /> Dismiss
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ---------------- Activity ---------------- */
export function Activity({ events }: { events: EventView[] }) {
  if (events.length === 0) return <EmptyState icon={<Bot size={26} />} title="Nothing yet" hint="When a rule sends something, drafts something or is stopped by a limit, it shows here with the reason." />;
  return (
    <ul className="space-y-2" data-autopilot="activity">
      {events.map((e) => (
        <li key={e.id} className="rounded-xl border border-line bg-surface px-3 py-2.5 text-sm" data-event={e.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <b>{e.clientName}</b> <span className="text-muted">· {e.label}</span>
            </span>
            <span className="flex items-center gap-2 text-xs text-muted">
              {format(parseISO(e.decidedAt ?? e.createdAt), "d MMM, h:mm a")}
              <Badge className={STATUS_STYLE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
            </span>
          </div>
          <div className="text-xs text-muted">{e.why}</div>
          {e.text && <div className="mt-1 line-clamp-2 text-xs [overflow-wrap:anywhere]">“{e.text}”</div>}
          {e.extras.length > 0 && <div className="text-xs text-muted">Also: {e.extras.join(", ")}.</div>}
          {e.note && <div className="text-xs text-pr">{e.note}</div>}
          {e.error && <div className="text-xs text-danger">{e.error}</div>}
        </li>
      ))}
    </ul>
  );
}

/* ---------------- Editing a rule ---------------- */
function RuleEditor({
  rule,
  packages,
  programs,
  onClose,
  onSave,
}: {
  rule: RuleView;
  packages: { id: string; name: string; sessions: number }[];
  programs: { id: string; name: string }[];
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<string | null>;
}) {
  const info = TRIGGERS[rule.trigger];
  const find = <T extends Action["type"]>(t: T) => rule.actions.find((a) => a.type === t) as Extract<Action, { type: T }> | undefined;
  const [mode, setMode] = useState<Mode>(rule.mode);
  const [text, setText] = useState(find("message")?.text ?? "");
  const [forms, setForms] = useState<string[]>(find("form")?.kinds ?? []);
  const [program, setProgram] = useState(find("program")?.programId ?? "");
  const [startIn, setStartIn] = useState(String(find("program")?.startInDays ?? 1));
  const [pk, setPk] = useState(find("paylink")?.packageId ?? "");
  const [alert, setAlert] = useState(find("alert")?.text ?? "");
  const [useMsg, setUseMsg] = useState(!!find("message") || rule.actions.length === 0);
  const [useForm, setUseForm] = useState(!!find("form"));
  const [useProgram, setUseProgram] = useState(!!find("program"));
  const [usePk, setUsePk] = useState(!!find("paylink"));
  const [useAlert, setUseAlert] = useState(!!find("alert"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const can = (t: string) => rule.allowed.includes(t);

  const save = async () => {
    const actions: Action[] = [];
    if (can("message") && useMsg) actions.push({ type: "message", text });
    if (can("form") && useForm) actions.push({ type: "form", kinds: forms as ("PARQ" | "DECLARATION" | "GOALS")[] });
    if (can("program") && useProgram) actions.push({ type: "program", programId: program, startInDays: Number(startIn) || 1 });
    if (can("paylink") && usePk) actions.push({ type: "paylink", packageId: pk });
    if (can("alert") && useAlert) actions.push({ type: "alert", text: alert });
    setBusy(true);
    setError(null);
    const why = await onSave({ mode, actions });
    setBusy(false);
    if (why) setError(why);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={info.label}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">{info.blurb}</p>
        <Field label="When it happens">
          <Select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="auto">Send by itself</option>
            <option value="draft">Make a draft for me to approve</option>
          </Select>
        </Field>
        {can("message") && (
          <div className="space-y-2">
            <Toggle checked={useMsg} onChange={setUseMsg} label="Send a chat message" />
            {useMsg && (
              <>
                <Textarea rows={4} maxLength={600} value={text} onChange={(e) => setText(e.target.value)} aria-label="Message" />
                <p className="text-xs text-muted">
                  Words you can use: <code>{"{first_name}"}</code> <code>{"{coach_name}"}</code>
                  {info.vars.map((v) => (
                    <span key={v}>
                      {" "}
                      <code>{`{${v}}`}</code>
                    </span>
                  ))}
                </p>
              </>
            )}
          </div>
        )}
        {can("form") && (
          <div className="space-y-2">
            <Toggle checked={useForm} onChange={setUseForm} label="Ask for the “Before we meet” forms" />
            {useForm && (
              <div className="flex flex-wrap gap-2">
                {[
                  ["PARQ", "Health questionnaire"],
                  ["DECLARATION", "Health declaration"],
                  ["GOALS", "Goals and lifestyle"],
                ].map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={forms.includes(k)} onClick={() => setForms((f) => (f.includes(k) ? f.filter((x) => x !== k) : [...f, k]))} className={cn("min-h-10 rounded-full border px-3 text-sm font-semibold", forms.includes(k) ? "border-accent bg-accent/15 text-accent" : "border-line text-muted")}>
                    {l}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {can("program") && (
          <div className="space-y-2">
            <Toggle checked={useProgram} onChange={setUseProgram} label="Give them a program" />
            {useProgram && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Select value={program} onChange={(e) => setProgram(e.target.value)} aria-label="Program">
                  <option value="">Choose a program</option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <Select value={startIn} onChange={(e) => setStartIn(e.target.value)} aria-label="Start">
                  <option value="0">Starts today</option>
                  <option value="1">Starts tomorrow</option>
                  <option value="3">Starts in 3 days</option>
                  <option value="7">Starts in a week</option>
                </Select>
              </div>
            )}
          </div>
        )}
        {can("paylink") && (
          <div className="space-y-2">
            <Toggle checked={usePk} onChange={setUsePk} label="Make a pay link (use {pay_link} in the message)" />
            {usePk && (
              <Select value={pk} onChange={(e) => setPk(e.target.value)} aria-label="Package">
                <option value="">Choose a package</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
            {usePk && packages.length === 0 && <p className="text-xs text-pr">You have no packages yet. Add one in Settings, Payments.</p>}
          </div>
        )}
        {can("alert") && (
          <div className="space-y-2">
            <Toggle checked={useAlert} onChange={setUseAlert} label="Alert me in the app" />
            {useAlert && <Input value={alert} maxLength={300} onChange={(e) => setAlert(e.target.value)} placeholder="What should the alert say?" aria-label="Alert" />}
          </div>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

/* ---------------- Smart replies ---------------- */
function Smart({ smart, onChange }: { smart: Overview["smart"]; onChange: (s: Overview["smart"]) => void }) {
  const [busy, setBusy] = useState(false);
  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    const r = await api<{ smart: Overview["smart"] }>("/api/autopilot/smart", { method: "PUT", body });
    setBusy(false);
    if (r.ok && r.data) onChange(r.data.smart);
  };
  return (
    <Card className="space-y-4 p-4" data-autopilot="smart">
      <div>
        <h3 className="font-bold">Smart replies</h3>
        <p className="text-sm text-muted">A <b>Draft reply</b> button in your client chats. The AI reads the last few messages and a few facts (sessions left, last workout, next session; never their name), writes a short reply in your tone and in the style of your saved replies, and puts it in the message box. <b>It is never sent by itself.</b></p>
      </div>
      <Toggle checked={smart.enabled} onChange={(v) => void save({ enabled: v })} label={smart.enabled ? "On for my chats" : "Off"} />
      <Field label="Tone">
        <Select value={smart.tone} disabled={busy} onChange={(e) => void save({ tone: e.target.value })}>
          {TONES.map((t) => (
            <option key={t} value={t}>
              {TONE_LABEL[t]}
            </option>
          ))}
        </Select>
      </Field>
      <p className="text-xs text-muted">Up to {smart.perDay} a day. The chat text it reads is sent to the AI provider to write the reply (see the Privacy Policy). Not used for clients under 18. {smart.aiAvailable ? "" : "The AI is not available right now."}</p>
      {smart.enabled && (
        <Link href="/messages" className="inline-flex items-center gap-1 text-sm font-semibold text-accent">
          <Check size={14} /> Open Messages to try it
        </Link>
      )}
    </Card>
  );
}

/* ---------------- Team (gym managers) ---------------- */
function Team() {
  const [data, setData] = useState<{ coaches: { id: string; name: string }[]; events: (EventView & { coachName: string })[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await api<{ coaches: { id: string; name: string }[]; events: (EventView & { coachName: string })[] }>("/api/autopilot/team");
      if (!alive) return;
      if (r.ok && r.data) setData(r.data);
      else setError(r.error ?? "Couldn't load the team's activity.");
    })();
    return () => {
      alive = false;
    };
  }, []);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <div className="space-y-3" data-autopilot="team">
      <p className="text-sm text-muted">What your coaches&apos; Autopilot has done: who, what and when. You cannot see their messages or change their rules.</p>
      {data.events.length === 0 ? (
        <EmptyState title="Nothing yet" />
      ) : (
        <ul className="space-y-2">
          {data.events.map((e) => (
            <li key={e.id} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <b>{e.coachName}</b> <span className="text-muted">· {e.label} · {e.clientName}</span>
                </span>
                <Badge className={STATUS_STYLE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
              </div>
              <div className="text-xs text-muted">{format(parseISO(e.decidedAt ?? e.createdAt), "d MMM, h:mm a")}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
