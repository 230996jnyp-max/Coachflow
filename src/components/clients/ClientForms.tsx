"use client";

import { Check, Copy, FileUp, RefreshCw } from "lucide-react";
import { useState } from "react";
import { ImportClientsModal } from "@/components/clients/ImportClientsModal";
import { GymSelect } from "@/components/GymSelect";
import { NumberInput } from "@/components/NumberInput";
import { Button, Field, IconButton, Input, Modal, Notice, Select, Textarea } from "@/components/ui";
import { isGymComplete } from "@/lib/gyms";
import { useViewer } from "@/lib/hooks";
import { createClient } from "@/lib/store";
import type { ClientGoal } from "@/lib/types";

export const GOALS: ClientGoal[] = ["Hypertrophy", "Fat Loss", "Strength", "Conditioning", "General Fitness"];

const WORDS = ["iron", "lift", "peak", "core", "swift", "bold", "grit", "power", "forge", "ember", "cedar", "delta", "nova", "raven", "stone", "tiger"];
const rand = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const cap = (w: string) => w[0].toUpperCase() + w.slice(1);
/** Temporary password for a new/reset client — random words + digits (the client must change it on first login). */
export function genPassword(): string {
  return `${cap(WORDS[rand(WORDS.length)])}-${cap(WORDS[rand(WORDS.length)])}-${1000 + rand(9000)}`;
}

export function slugUsername(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export interface Credentials {
  name: string;
  username: string;
  password: string;
  /** The "Before we meet" forms were asked for. */
  pack?: boolean;
  /** What happened to the email with the login (when one was asked for). */
  emailed?: "sent" | "preview" | "failed" | "none";
}

export function AddClientModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string, c: Credentials) => void }) {
  return open ? <Form onClose={onClose} onCreated={onCreated} /> : null;
}

function Form({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string, c: Credentials) => void }) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [userTouched, setUserTouched] = useState(false);
  const [password, setPassword] = useState(() => genPassword());
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [goal, setGoal] = useState<ClientGoal>("Hypertrophy");
  const [credits, setCredits] = useState(10);
  const [groupCredits, setGroupCredits] = useState(0);
  const [gym, setGym] = useState<string>("");
  const [medical, setMedical] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sendPack, setSendPack] = useState(false);
  const [emailLogin, setEmailLogin] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);

  const effUser = userTouched ? username : slugUsername(name);

  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return setError("Enter the client’s full name.");
    if (effUser.length < 3) return setError("Username must be at least 3 characters.");
    if (gym && !isGymComplete(gym)) return setError("Please type the place name for the default gym.");
    if (password.length < 8) return setError("Temporary password must be at least 8 characters.");
    setError(null);
    setBusy(true);
    const res = await createClient({
      name,
      username: effUser,
      password,
      phone: phone.trim(),
      email: email.trim(),
      goal,
      credits: Math.max(0, credits),
      groupClassCredits: Math.max(0, groupCredits),
      defaultGymId: gym || null,
      medicalNotes: medical.trim(),
      sendPack,
      emailLogin: emailLogin || sendPack,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onCreated(res.id, { name: name.trim(), username: effUser, password, pack: res.pack, emailed: res.emailed });
  };

  return (
    <>
    <Modal
      open
      onClose={onClose}
      title="Add new client"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={() => setImporting(true)} className="mr-auto">
            <FileUp size={16} /> Import details
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create client"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jamie Ong" autoFocus />
          </Field>
          <Field label="Username" hint="Used to log in. Auto-filled from the name.">
            <Input
              value={effUser}
              onChange={(e) => {
                setUserTouched(true);
                setUsername(e.target.value.toLowerCase().replace(/\s+/g, "_"));
              }}
              autoCapitalize="none"
            />
          </Field>
          <Field label="Initial temporary password" hint="The client is prompted to change it on first login.">
            <div className="flex gap-2">
              <Input value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />
              <IconButton label="Generate password" onClick={() => setPassword(genPassword())} className="border border-line bg-field">
                <RefreshCw size={16} />
              </IconButton>
            </div>
          </Field>
          <Field label="Session package credits">
            <NumberInput label="Session package credits" min={0} max={1000} value={credits} onChange={(v) => setCredits(v ?? credits)} />
          </Field>
          <Field label="Group class credits" hint="Used for group classes and partner sessions. Can be changed any time.">
            <NumberInput label="Group class credits" min={0} max={1000} value={groupCredits} onChange={(v) => setGroupCredits(v ?? groupCredits)} />
          </Field>
          <Field label="Phone / WhatsApp">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+65 9xxx xxxx" inputMode="tel" />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Goal">
            <Select value={goal} onChange={(e) => setGoal(e.target.value as ClientGoal)}>
              {GOALS.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </Select>
          </Field>
          <Field label="Default gym">
            <GymSelect value={gym} onChange={setGym} noneLabel="None / decide later" />
          </Field>
        </div>
        <Field label="Medical / injury notes">
          <Textarea value={medical} onChange={(e) => setMedical(e.target.value)} placeholder="Injuries, conditions, contraindications…" />
        </Field>
        <div className="space-y-2 rounded-xl border border-line bg-field/40 p-3">
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-accent" checked={sendPack} onChange={(e) => setSendPack(e.target.checked)} />
            <span>
              <span className="font-semibold">Ask them to fill in the “Before we meet” forms</span>
              <span className="block text-xs text-muted">A health questionnaire, a declaration and a goals form, about five minutes. One email covers their login and the forms{email.trim() ? "" : " (add an email address to send it)"}.</span>
            </span>
          </label>
          {!sendPack && (
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-accent" checked={emailLogin} disabled={!email.trim()} onChange={(e) => setEmailLogin(e.target.checked)} />
              <span>Email the login to the client{email.trim() ? "" : " (needs an email address)"}</span>
            </label>
          )}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
    <ImportClientsModal
      open={importing}
      onClose={() => {
        setImporting(false);
        if (imported) onClose();
      }}
      onDone={() => setImported(true)}
    />
    </>
  );
}

/** Shareable login card shown after creating a client or resetting a password. */
export function CredentialsModal({ creds, onClose, title = "Client created" }: { creds: Credentials | null; onClose: () => void; title?: string }) {
  const { db } = useViewer();
  const [copied, setCopied] = useState(false);
  if (!creds) return null;
  const link = typeof window !== "undefined" ? window.location.origin : "";
  const text = `Hi ${creds.name.split(" ")[0]}! Here are your ${db.settings.brandName} login details:\n\nApp: ${link}\nUsername: ${creds.username}\nPassword: ${creds.password}\n\nYou'll be asked to set your own password after logging in. Tip: open the link on your phone and tap "Install Mobile App" for the full-screen app.`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={copy}>
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied!" : "Copy Login Credentials"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Notice tone="success">Account ready. Paste these details into WhatsApp or SMS for {creds.name}.</Notice>
        {creds.emailed === "sent" && <Notice tone="success">An email with the login{creds.pack ? " and the forms to fill in" : ""} was sent to {creds.name}.</Notice>}
        {creds.emailed === "preview" && <Notice tone="warn">Email isn’t set up on this server, so nothing was emailed. Copy the details below instead.</Notice>}
        {creds.emailed === "failed" && <Notice tone="warn">The email couldn’t be sent. Copy the details below instead.</Notice>}
        {creds.pack && <Notice tone="info">{creds.name.split(" ")[0]} will see the “Before we meet” forms as soon as they sign in. You’ll be told when they’re done.</Notice>}
        <pre className="whitespace-pre-wrap rounded-xl border border-line bg-field p-4 font-mono text-xs leading-relaxed">{text}</pre>
      </div>
    </Modal>
  );
}
