"use client";

import { Camera, Check, Copy, MapPin, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button, Card, Field, Input, Notice, SectionTitle, Segmented, Toggle } from "@/components/ui";
import { can, type GymSettingsData } from "./types";
import type { GymInfo } from "@/lib/gymPerms";
import { pictureToUpload } from "@/lib/image";
import { mediaUrl } from "@/lib/prefs";
import { CORE_SPORTS, sportLabel } from "@/lib/sports";
import { api } from "@/lib/store";
import { cn } from "@/lib/utils";

/** The gym's name, logo, banner, the defaults new coaches start with, halls and branches, the hours rule and the gym code. */
export function GymSettingsPanel({ gym, settings, onChanged }: { gym: GymInfo; settings: GymSettingsData; onChanged: () => void }) {
  const branding = can(gym, "branding.manage");
  const team = can(gym, "coaches.manage");
  const [name, setName] = useState(settings.name);
  const [flash, setFlash] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [bName, setBName] = useState("");
  const [bAddr, setBAddr] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [eName, setEName] = useState("");
  const [eAddr, setEAddr] = useState("");
  const logoIn = useRef<HTMLInputElement>(null);
  const bannerIn = useRef<HTMLInputElement>(null);

  const say = (text: string, tone: "success" | "error" = "success") => setFlash({ tone, text });
  const patch = async (body: Record<string, unknown>, ok: string) => {
    const r = await api("/api/gym", { method: "PATCH", body });
    if (!r.ok) return say(r.error ?? "That didn't work.", "error");
    say(ok);
    onChanged();
  };
  const upload = async (kind: "logo" | "banner", file: File) => {
    try {
      const up = await pictureToUpload(file, kind);
      const r = await api(`/api/gym/media/${kind}`, { method: "PUT", body: up });
      if (!r.ok) return say(r.error ?? "Couldn't save the picture.", "error");
      say(`${kind === "logo" ? "Logo" : "Banner"} saved.`);
      onChanged();
    } catch (e) {
      say(e instanceof Error ? e.message : "That picture couldn't be read.", "error");
    }
  };
  const branch = async (method: string, body: Record<string, unknown>, ok: string) => {
    const r = await api("/api/gym/branches", { method, body });
    if (!r.ok) return say(r.error ?? "That didn't work.", "error");
    say(ok);
    onChanged();
  };

  const logo = mediaUrl(settings.id, "logo", settings.logoV);
  const banner = mediaUrl(settings.id, "banner", settings.bannerV);

  return (
    <div className="space-y-6">
      {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}

      {team && settings.code && (
        <section>
          <SectionTitle>Gym code</SectionTitle>
          <Card className="flex flex-wrap items-center gap-3 p-4">
            <div className="font-mono text-2xl font-bold tracking-[0.2em]">{settings.code}</div>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(settings.code).catch(() => undefined);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />} Copy
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                const r = await api("/api/gym", { body: { action: "regenerate_code" } });
                if (!r.ok) return say(r.error ?? "That didn't work.", "error");
                say("New code made. The old one no longer works; people already in your gym are unaffected.");
                onChanged();
              }}
            >
              <RefreshCw size={14} /> New code
            </Button>
          </Card>
        </section>
      )}

      {branding && (
        <>
          <section>
            <SectionTitle>Name and pictures</SectionTitle>
            <Card className="space-y-4 p-4">
              <Field label="Gym or academy name">
                <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== settings.name && void patch({ name: name.trim() }, "Name saved.")} />
              </Field>
              <div className="flex flex-wrap gap-6">
                <div className="space-y-2">
                  <div className="text-sm font-semibold">Logo</div>
                  {logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logo} alt="Gym logo" className="h-16 w-16 rounded-xl border border-line bg-field object-contain p-1" />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-line text-xs text-muted">None</div>
                  )}
                  <input ref={logoIn} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload("logo", f); }} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => logoIn.current?.click()}>
                      <Camera size={14} /> {logo ? "Change" : "Add"}
                    </Button>
                    {logo && (
                      <Button size="sm" variant="ghost" onClick={async () => { await api("/api/gym/media/logo", { method: "DELETE" }); onChanged(); }}>
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="text-sm font-semibold">Banner</div>
                  {banner ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={banner} alt="Gym banner" className="h-16 w-full max-w-xs rounded-xl object-cover" />
                  ) : (
                    <div className="flex h-16 w-full max-w-xs items-center justify-center rounded-xl border border-dashed border-line text-xs text-muted">None</div>
                  )}
                  <input ref={bannerIn} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload("banner", f); }} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => bannerIn.current?.click()}>
                      <Camera size={14} /> {banner ? "Change" : "Add"}
                    </Button>
                    {banner && (
                      <Button size="sm" variant="ghost" onClick={async () => { await api("/api/gym/media/banner", { method: "DELETE" }); onChanged(); }}>
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted">Your coaches&apos; clients see the logo and name on their home screen.</p>
            </Card>
          </section>

          <section>
            <SectionTitle>What a new coach starts with</SectionTitle>
            <Card className="space-y-4 p-4">
              <p className="text-xs text-muted">When a coach joins they get these, once. They can change any of it afterwards: their own theme, niches, exercises and locations stay theirs.</p>
              <div>
                <div className="mb-2 text-sm font-semibold">Theme</div>
                <Segmented
                  value={settings.theme ?? ""}
                  onChange={(v) => void patch({ theme: v || null }, "Default theme saved.")}
                  options={[{ value: "", label: "None" }, { value: "black", label: "Black" }, { value: "white", label: "White" }, { value: "navy", label: "Navy Blue" }]}
                />
              </div>
              <div>
                <div className="mb-2 text-sm font-semibold">Coaching niches</div>
                <div className="flex flex-wrap gap-2">
                  {CORE_SPORTS.map((s) => {
                    const on = settings.niches.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={on}
                        onClick={() => void patch({ niches: on ? settings.niches.filter((x) => x !== s) : [...settings.niches, s] }, "Default niches saved.")}
                        className={cn("min-h-10 rounded-xl border px-3 text-xs font-semibold transition-colors", on ? "border-accent bg-accent/15 text-accent" : "border-line bg-field text-muted hover:text-ink")}
                      >
                        {sportLabel(s)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Button
                variant="secondary"
                onClick={async () => {
                  const r = await api<{ coaches: number }>("/api/gym", { body: { action: "apply_all" } });
                  if (!r.ok) return say(r.error ?? "That didn't work.", "error");
                  say(`Handed to ${r.data?.coaches} coach${r.data?.coaches === 1 ? "" : "es"}. Their own choices are kept; the theme is replaced.`);
                }}
              >
                Apply to everyone now
              </Button>
            </Card>
          </section>

          <section>
            <SectionTitle>Halls and branches</SectionTitle>
            <Card className="space-y-3 p-4">
              <p className="text-xs text-muted">Each coach gets these as saved locations when they join, and you can filter the master schedule by them.</p>
              {settings.branches.map((b) => (
                <div key={b.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
                  <MapPin size={18} className="shrink-0 text-accent" />
                  {editing === b.id ? (
                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                      <Input value={eName} onChange={(e) => setEName(e.target.value)} aria-label="Branch name" />
                      <Input value={eAddr} onChange={(e) => setEAddr(e.target.value)} aria-label="Address" placeholder="Address (optional)" />
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{b.name}</div>
                      <div className="truncate text-xs text-muted">{b.address || "No address"}</div>
                    </div>
                  )}
                  {editing === b.id ? (
                    <Button size="sm" onClick={async () => { await branch("PATCH", { id: b.id, name: eName, address: eAddr }, "Saved."); setEditing(null); }}>
                      Save
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" aria-label={`Edit ${b.name}`} onClick={() => { setEditing(b.id); setEName(b.name); setEAddr(b.address); }}>
                      <Pencil size={15} />
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" aria-label={`Delete ${b.name}`} onClick={() => void branch("DELETE", { id: b.id }, `${b.name} removed.`)}>
                    <Trash2 size={15} />
                  </Button>
                </div>
              ))}
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input value={bName} onChange={(e) => setBName(e.target.value)} placeholder="Hall or branch name" aria-label="New branch name" />
                <Input value={bAddr} onChange={(e) => setBAddr(e.target.value)} placeholder="Address (optional)" aria-label="New branch address" />
                <Button
                  disabled={bName.trim().length < 2}
                  onClick={async () => {
                    await branch("POST", { name: bName, address: bAddr }, `${bName} added.`);
                    setBName("");
                    setBAddr("");
                  }}
                >
                  <Plus size={16} /> Add
                </Button>
              </div>
            </Card>
          </section>

          <section>
            <SectionTitle>Hours and payroll</SectionTitle>
            <Card className="p-4">
              <Toggle checked={settings.countNoShows} onChange={(v) => void patch({ countNoShows: v }, "Saved.")} label="Count client no-shows as worked time" />
              <p className="mt-1 text-xs text-muted">Off by default: only sessions and classes that actually happened count.</p>
            </Card>
          </section>
        </>
      )}
      {!branding && !team && <Card className="p-4 text-sm text-muted">Your role doesn&apos;t include changing gym settings.</Card>}
    </div>
  );
}
