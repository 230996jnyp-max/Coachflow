"use client";

import { Check, ClipboardPaste, Copy, FileUp, LoaderCircle, Sparkles } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Badge, Button, Field, Input, Modal, Notice, Select, Textarea } from "@/components/ui";
import { CANDIDATE_FIELDS, diffAgainst, GOAL_VALUES, LEVEL_VALUES, type ClientCandidate } from "@/lib/clientImport";
import { useViewer } from "@/lib/hooks";
import { ageOn, isMinorAge } from "@/lib/signupRules";
import { api, refreshAccounts } from "@/lib/store";
import { cn } from "@/lib/utils";

/*
 * Import client details, like importing a workout: paste, upload a file or a photo, check what was read, then save. Used from the
 * Clients page (many people at once, new or updates) and from one client's Profile (an update for just that client).
 */

type Action = "create" | "update" | "skip";
type Key = keyof ClientCandidate;

interface Current {
  name: string;
  phone: string;
  email: string;
  dob: string;
  goal: string;
  level: string;
  medicalNotes: string;
  credits: number;
  packageSize: number;
  homeAddress: string;
}
interface ReadCandidate extends ClientCandidate {
  match?: { clientId: string; current: Current };
  duplicateInList?: boolean;
  minor?: boolean;
}
interface ImportResult {
  index: number;
  ok: boolean;
  action: Action;
  name: string;
  clientId?: string;
  username?: string;
  password?: string;
  emailed?: "sent" | "preview" | "failed" | "none";
  error?: string;
}
interface Row {
  key: number;
  cand: ReadCandidate;
  action: Action;
  fields: ClientCandidate;
  picked: Set<Key>;
  sendLogin: boolean;
  guardian: boolean;
  edit: boolean;
}

const EXAMPLE = `Name, Phone, Email, Goal, Injuries
Jamie Ong, 9123 4567, jamie@example.com, Strength, Left knee
Priya Nair, 8234 5678, priya@example.com, Fat Loss,`;

export function ImportClientsModal({ open, onClose, targetClientId, onDone }: { open: boolean; onClose: () => void; targetClientId?: string; onDone?: () => void }) {
  return open ? <Flow onClose={onClose} targetClientId={targetClientId} onDone={onDone} /> : null;
}

function Flow({ onClose, targetClientId, onDone }: { onClose: () => void; targetClientId?: string; onDone?: () => void }) {
  const { db } = useViewer();
  const [step, setStep] = useState<"input" | "review" | "done">("input");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [via, setVia] = useState<"table" | "lines" | "ai">("table");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setFileNote(null);
    const isImage = f.type.startsWith("image/") || /\.(png|jpe?g|webp|heic|heif)$/i.test(f.name);
    if (f.size > (isImage ? 25 : 4) * 1024 * 1024) return setError(isImage ? "That photo is too large." : "That file is too large (4 MB max).");
    if (/\.(txt|text|md|markdown|log|csv|tsv)$/i.test(f.name)) {
      setText(await f.text());
      setFileNote(`Loaded ${f.name}. Check the text below, then press Read.`);
      return;
    }
    setReading(f.name);
    try {
      let body: Blob = f;
      let sendName = f.name;
      if (isImage) {
        try {
          body = await shrinkImage(f);
          sendName = f.name.replace(/\.[^.]+$/, "") + ".jpg";
        } catch {
          setReading(null);
          return setError("I couldn't open that picture. Try a JPG or PNG.");
        }
      }
      const res = await fetch(`/api/import/extract?raw=1&brand=${encodeURIComponent(db.settings.brandName || "CoachFlow")}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(sendName) },
        body,
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => null)) as { text?: string; kind?: string; error?: string } | null;
      if (!res.ok || !data?.text) setError(data?.error ?? "I couldn't read that file. Try another format or paste the text.");
      else {
        setText(data.text);
        setFileNote(`Read ${f.name}. Check the text below, then press Read.`);
      }
    } catch {
      setError("Couldn't reach the server to read that file. Check your connection.");
    }
    setReading(null);
  };

  const read = async () => {
    setError(null);
    setBusy(true);
    const r = await api<{ candidates: ReadCandidate[]; via: "table" | "lines" | "ai"; note?: string }>("/api/clients/import/read", { body: { text, targetClientId } });
    setBusy(false);
    if (!r.ok || !r.data) return setError(r.error ?? "I couldn't read that.");
    let list = r.data.candidates;
    // Updating one client: only the first person in the details counts.
    if (targetClientId) list = list.slice(0, 1);
    setVia(r.data.via);
    setRows(
      list.map((cand, i): Row => {
        const matched = !!cand.match;
        const action: Action = targetClientId ? "update" : cand.duplicateInList ? "skip" : matched ? "update" : "create";
        const fields = pickFields(cand);
        const diff = cand.match ? diffAgainst(cand.match.current, fields) : [];
        return { key: i, cand, action, fields, // A different name is the one change left unticked: the same phone or email with a different spelling is usually the same person.
        picked: new Set(diff.filter((d) => d.key !== "name").map((d) => d.key)), sendLogin: !!cand.email, guardian: false, edit: false };
      }),
    );
    setStep("review");
  };

  const patch = (key: number, p: Partial<Row>) => setRows((l) => l.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const setField = (key: number, f: Key, v: string | number | undefined) =>
    setRows((l) => l.map((r) => (r.key === key ? { ...r, fields: { ...r.fields, [f]: v === "" ? undefined : v } as ClientCandidate } : r)));

  const isMinor = (r: Row) => !!r.fields.dob && isMinorAge(ageOn(r.fields.dob));
  const active = rows.filter((r) => r.action !== "skip");
  const missingGuardian = active.filter((r) => isMinor(r) && !r.guardian);
  const noName = active.filter((r) => !r.fields.name?.trim());
  const canSave = active.length > 0 && missingGuardian.length === 0 && noName.length === 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    const payload = rows.map((r) => {
      if (r.action === "update" && r.cand.match) {
        const cur = r.cand.match.current;
        const only: Record<string, unknown> = { name: cur.name };
        for (const { key } of CANDIDATE_FIELDS) if (r.picked.has(key)) only[key] = r.fields[key];
        return { action: r.action, clientId: r.cand.match.clientId, fields: only, guardian: r.guardian };
      }
      return { action: r.action, fields: r.fields, sendLogin: r.sendLogin, guardian: r.guardian };
    });
    const res = await api<{ results: ImportResult[] }>("/api/clients/import/save", { body: { rows: payload } });
    setBusy(false);
    if (!res.ok || !res.data) return setError(res.error ?? "Couldn't save that.");
    setResults(res.data.results);
    await refreshAccounts();
    onDone?.();
    setStep("done");
  };

  const created = results.filter((r) => r.ok && r.action === "create");
  const updated = results.filter((r) => r.ok && r.action === "update");
  const failed = results.filter((r) => !r.ok);
  const loginText = useMemo(
    () => created.map((c) => `${c.name}\nUsername: ${c.username}\nPassword: ${c.password}${c.emailed === "sent" ? "\n(emailed)" : ""}`).join("\n\n"),
    [created],
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Login details (each person is asked to choose their own password on first sign-in):\n\n${loginText}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={step === "input" ? (targetClientId ? "Update from details" : "Import client details") : step === "review" ? "Check before saving" : "Imported"}
      footer={
        step === "input" ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={text.trim().length < 3 || busy || !!reading} onClick={() => void read()}>
              {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />} {busy ? "Reading…" : "Read details"}
            </Button>
          </>
        ) : step === "review" ? (
          <>
            <Button variant="secondary" onClick={() => setStep("input")} className="mr-auto">
              Back
            </Button>
            <Button disabled={!canSave || busy} onClick={() => void save()}>
              <Check size={16} /> {busy ? "Saving…" : `Save ${active.length} ${active.length === 1 ? "client" : "clients"}`}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Done</Button>
        )
      }
    >
      {step === "input" && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {targetClientId
              ? "Paste this client's details, or upload a file or photo (a form, a sheet, a screenshot). You'll see old and new side by side and tick what to change. Blank values never erase anything."
              : "Paste a list or one person's details, or upload a spreadsheet, PDF, Word file or photo. Up to 50 people at a time. You check everything before it is saved."}
          </p>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void readFile(e.dataTransfer.files?.[0]);
            }}
            placeholder={EXAMPLE}
            className={cn("min-h-44 font-mono text-xs", dragging && "border-accent")}
            aria-label="Client details"
          />
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" hidden accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf,.docx,.doc,.rtf,.html,.md" onChange={(e) => { void readFile(e.target.files?.[0]); e.target.value = ""; }} />
            <input ref={photoRef} type="file" hidden accept="image/*" onChange={(e) => { void readFile(e.target.files?.[0]); e.target.value = ""; }} />
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={!!reading}>
              <FileUp size={14} /> Upload a file
            </Button>
            <Button variant="secondary" size="sm" onClick={() => photoRef.current?.click()} disabled={!!reading}>
              <ClipboardPaste size={14} /> Photo or screenshot
            </Button>
            {reading && (
              <span className="inline-flex items-center gap-2 text-xs text-muted">
                <LoaderCircle size={14} className="animate-spin" /> Reading {reading}…
              </span>
            )}
          </div>
          {fileNote && <p className="text-xs text-success">{fileNote}</p>}
          <p className="text-xs text-muted">
            Tables and “Name: value” lines are read here. Anything else (a PDF, a photo, free text) is read by AI, so that text is sent to an AI service.
          </p>
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      )}

      {step === "review" && (
        <div className="space-y-4">
          <Notice tone="info">
            {rows.length} {rows.length === 1 ? "person" : "people"} found{via === "ai" ? " (read by AI, so check carefully)" : ""}. Logins are made for you: they are never taken from the file.
          </Notice>
          {rows.map((r) => (
            <RowCard key={r.key} r={r} onPatch={(p) => patch(r.key, p)} onField={(f, v) => setField(r.key, f, v)} targeted={!!targetClientId} minor={isMinor(r)} />
          ))}
          {missingGuardian.length > 0 && <Notice tone="warn">{missingGuardian.length} {missingGuardian.length === 1 ? "person is" : "people are"} under 18. Tick that a parent or guardian agrees, or skip them.</Notice>}
          {noName.length > 0 && <Notice tone="warn">Every person needs a name.</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      )}

      {step === "done" && (
        <div className="space-y-4">
          <Notice tone={failed.length ? "warn" : "success"}>
            {created.length > 0 && `${created.length} new ${created.length === 1 ? "client" : "clients"} created. `}
            {updated.length > 0 && `${updated.length} updated. `}
            {failed.length > 0 && `${failed.length} could not be saved.`}
            {created.length + updated.length + failed.length === 0 && "Nothing was changed."}
          </Notice>
          {created.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-semibold">Logins</div>
              <p className="text-xs text-muted">Shown once. Each person is asked to choose their own password the first time they sign in.</p>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-field p-3 font-mono text-xs">{loginText}</pre>
              <Button variant="secondary" size="sm" onClick={() => void copy()}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy logins"}
              </Button>
              {created.some((c) => c.emailed === "preview") && <p className="text-xs text-muted">Email isn’t set up on this server, so nothing was actually emailed. Copy the logins instead.</p>}
            </div>
          )}
          {failed.length > 0 && (
            <ul className="space-y-1 text-sm text-danger">
              {failed.map((f) => (
                <li key={f.index}>
                  {f.name || `Row ${f.index + 1}`}: {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Just the client fields of a candidate (not the match info the server adds). */
function pickFields(c: ClientCandidate): ClientCandidate {
  const out: Record<string, unknown> = {};
  for (const { key } of CANDIDATE_FIELDS) if (c[key] !== undefined) out[key] = c[key];
  return out as unknown as ClientCandidate;
}

function show(f: Key, v: string | number | undefined): string {
  if (v === undefined || v === "") return "—";
  if (f === "credits" || f === "packageSize") return String(v);
  return String(v);
}

function RowCard({ r, onPatch, onField, targeted, minor }: { r: Row; onPatch: (p: Partial<Row>) => void; onField: (f: Key, v: string | number | undefined) => void; targeted: boolean; minor: boolean }) {
  const c = r.cand;
  const diff = c.match ? diffAgainst(c.match.current, r.fields) : [];
  const fieldsRead = CANDIDATE_FIELDS.filter((f) => r.fields[f.key] !== undefined && r.fields[f.key] !== "");
  return (
    <div className={cn("rounded-2xl border border-line bg-field/40 p-4", r.action === "skip" && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{r.fields.name || "No name"}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {c.match ? <Badge className="border-accent/30 bg-accent/15 text-accent">Already your client: {c.match.current.name}</Badge> : <Badge className="border-success/30 bg-success/15 text-success">New</Badge>}
            {c.duplicateInList && <Badge className="border-pr/30 bg-pr/15 text-pr">Listed twice</Badge>}
            {minor && <Badge className="border-danger/30 bg-danger/15 text-danger">Under 18</Badge>}
          </div>
        </div>
        {!targeted && (
          <Select value={r.action} onChange={(e) => onPatch({ action: e.target.value as Action })} className="w-auto" aria-label="What to do with this person">
            {!c.match && <option value="create">Create client</option>}
            {c.match && <option value="update">Update client</option>}
            {c.match && <option value="create">Create a separate client</option>}
            <option value="skip">Skip</option>
          </Select>
        )}
      </div>

      {r.action === "update" && c.match && (
        <div className="mt-3 overflow-x-auto">
          {diff.length === 0 ? (
            <p className="text-sm text-muted">Nothing new: everything in the details matches what you already have.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="w-8 pb-1" />
                  <th className="pb-1 pr-3">Field</th>
                  <th className="pb-1 pr-3">Now</th>
                  <th className="pb-1">New</th>
                </tr>
              </thead>
              <tbody>
                {diff.map((d) => {
                  const label = CANDIDATE_FIELDS.find((f) => f.key === d.key)?.label ?? d.key;
                  const on = r.picked.has(d.key);
                  return (
                    <tr key={d.key} className="border-t border-line align-top">
                      <td className="py-2">
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-accent"
                          checked={on}
                          aria-label={`Change ${label}`}
                          onChange={() => {
                            const next = new Set(r.picked);
                            if (on) next.delete(d.key);
                            else next.add(d.key);
                            onPatch({ picked: next });
                          }}
                        />
                      </td>
                      <td className="py-2 pr-3 font-medium">{label}</td>
                      <td className="py-2 pr-3 text-muted">{d.from || "—"}</td>
                      <td className={cn("py-2", on ? "font-semibold text-ink" : "text-muted line-through")}>{d.to}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {r.action === "create" && (
        <div className="mt-3 space-y-3">
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            {fieldsRead.map((f) => (
              <div key={f.key} className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted">{f.label}</dt>
                <dd className="min-w-0 break-words">{show(f.key, r.fields[f.key])}</dd>
              </div>
            ))}
          </dl>
          {r.fields.email ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-accent" checked={r.sendLogin} onChange={(e) => onPatch({ sendLogin: e.target.checked })} />
              <span>Email the login to {r.fields.email}</span>
            </label>
          ) : (
            <p className="text-xs text-muted">No email address, so you’ll copy the login to send it yourself.</p>
          )}
        </div>
      )}

      {minor && r.action !== "skip" && (
        <label className="mt-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5 accent-accent" checked={r.guardian} onChange={(e) => onPatch({ guardian: e.target.checked })} />
          <span>This person is under 18. A parent or guardian has agreed to them training with me and to this information being kept.</span>
        </label>
      )}

      {r.action !== "skip" && (
        <div className="mt-3">
          <button type="button" className="min-h-9 text-xs font-semibold text-accent" onClick={() => onPatch({ edit: !r.edit })}>
            {r.edit ? "Hide edit" : "Fix something"}
          </button>
          {r.edit && (
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <Input value={r.fields.name ?? ""} onChange={(e) => onField("name", e.target.value)} />
              </Field>
              <Field label="Phone">
                <Input value={r.fields.phone ?? ""} onChange={(e) => onField("phone", e.target.value)} inputMode="tel" />
              </Field>
              <Field label="Email">
                <Input type="email" value={r.fields.email ?? ""} onChange={(e) => onField("email", e.target.value)} />
              </Field>
              <Field label="Date of birth">
                <Input type="date" value={r.fields.dob ?? ""} onChange={(e) => onField("dob", e.target.value)} />
              </Field>
              <Field label="Goal">
                <Select value={r.fields.goal ?? ""} onChange={(e) => onField("goal", e.target.value)}>
                  <option value="">Not set</option>
                  {GOAL_VALUES.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Experience">
                <Select value={r.fields.level ?? ""} onChange={(e) => onField("level", e.target.value)}>
                  <option value="">Not set</option>
                  {LEVEL_VALUES.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Session credits">
                <Input type="number" min={0} value={r.fields.credits ?? ""} onChange={(e) => onField("credits", e.target.value === "" ? undefined : Math.max(0, Math.round(Number(e.target.value))))} />
              </Field>
              <Field label="Package size">
                <Input type="number" min={0} value={r.fields.packageSize ?? ""} onChange={(e) => onField("packageSize", e.target.value === "" ? undefined : Math.max(0, Math.round(Number(e.target.value))))} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Home address">
                  <Input value={r.fields.homeAddress ?? ""} onChange={(e) => onField("homeAddress", e.target.value)} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Injuries and health notes">
                  <Textarea value={r.fields.medicalNotes ?? ""} onChange={(e) => onField("medicalNotes", e.target.value)} />
                </Field>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Scales a photo down to at most 1800px and re-encodes it as JPEG (smaller upload; converts iPhone formats). */
async function shrinkImage(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.85));
}
