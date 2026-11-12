"use client";

import { ArrowDown, ArrowUp, Camera, Eye, EyeOff, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button, Notice, PersonAvatar } from "@/components/ui";
import { ACCENTS, ACCENT_SWATCH, BACKGROUNDS, HOME_SECTIONS, arrange, mediaUrl, type MediaKind } from "@/lib/prefs";
import { useViewer } from "@/lib/hooks";
import { removePicture, savePrefs, uploadPicture } from "@/lib/store";
import { cn } from "@/lib/utils";

/** Choose a picture from the device, shrink it and save it. Used for the profile photo, the background and a coach's banner and logo. */
export function PictureButtons({ kind, hasPicture, label, onDone }: { kind: MediaKind; hasPicture: boolean; label: string; onDone?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setBusy(true);
            setError(null);
            const err = await uploadPicture(kind, f);
            setBusy(false);
            if (err) setError(err);
            else onDone?.();
          }}
        />
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => input.current?.click()}>
          <Camera size={15} /> {busy ? "Saving…" : hasPicture ? `Change ${label}` : `Add ${label}`}
        </Button>
        {hasPicture && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void removePicture(kind)}>
            <Trash2 size={15} /> Remove
          </Button>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

/** Profile photo with the name and bio fields kept elsewhere; this is just the picture and its buttons. */
export function PhotoField() {
  const { user } = useViewer();
  if (!user) return null;
  return (
    <div className="flex items-center gap-4">
      <PersonAvatar user={user} size={72} />
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-semibold">Profile photo</div>
        <div className="text-xs text-muted">Seen by your coach and the people you train with, and by nobody else.</div>
        <PictureButtons kind="avatar" hasPicture={!!user.prefs?.avatarV} label="photo" />
      </div>
    </div>
  );
}

/** A coach's banner and logo: shown to their clients on the home screen. */
export function CoachBranding() {
  const { user } = useViewer();
  if (!user) return null;
  const banner = mediaUrl(user.id, "banner", user.prefs?.bannerV);
  const logo = mediaUrl(user.id, "logo", user.prefs?.logoV);
  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold">Banner</div>
        <div className="text-xs text-muted">A wide picture at the top of your clients&rsquo; home screen.</div>
        {banner && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={banner} alt="Your banner" className="mt-2 h-24 w-full rounded-xl object-cover" />
        )}
        <div className="mt-2">
          <PictureButtons kind="banner" hasPicture={!!banner} label="banner" />
        </div>
      </div>
      <div>
        <div className="text-sm font-semibold">Logo</div>
        <div className="text-xs text-muted">Shown next to your name on your clients&rsquo; home screen.</div>
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="Your logo" className="mt-2 h-14 w-14 rounded-xl border border-line bg-field object-contain p-1" />
        )}
        <div className="mt-2">
          <PictureButtons kind="logo" hasPicture={!!logo} label="logo" />
        </div>
      </div>
    </div>
  );
}

export function AccentPicker() {
  const { user } = useViewer();
  if (!user) return null;
  const cur = user.prefs?.accent;
  return (
    <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Accent colour">
      {ACCENTS.map((a) => (
        <button
          key={a}
          type="button"
          role="radio"
          aria-checked={cur === a}
          aria-label={a}
          onClick={() => savePrefs({ accent: a })}
          className={cn("flex h-11 w-11 items-center justify-center rounded-full border-2 transition", cur === a ? "border-ink" : "border-transparent")}
          style={{ background: ACCENT_SWATCH[a] }}
        >
          {cur === a && <span className="h-2.5 w-2.5 rounded-full bg-white" />}
        </button>
      ))}
    </div>
  );
}

/** Ready-made backgrounds, or the person's own picture with a "calmer" slider so text stays readable. */
export function BackgroundPicker() {
  const { user } = useViewer();
  if (!user) return null;
  const p = user.prefs ?? {};
  const cur = p.bg ?? "none";
  const custom = mediaUrl(user.id, "bg", p.bgV);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {BACKGROUNDS.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => savePrefs({ bg: b.id })}
            aria-pressed={cur === b.id}
            className={cn("relative h-16 overflow-hidden rounded-xl border-2 bg-bg text-xs font-semibold", cur === b.id ? "border-accent" : "border-line")}
            style={{ backgroundImage: b.css || undefined, backgroundSize: b.id === "grid" ? "18px 18px" : undefined }}
          >
            <span className="absolute inset-x-0 bottom-0 bg-bg/70 px-1 py-0.5 text-center">{b.label}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => custom && savePrefs({ bg: "custom" })}
          disabled={!custom}
          aria-pressed={cur === "custom"}
          className={cn("relative h-16 overflow-hidden rounded-xl border-2 bg-field text-xs font-semibold disabled:opacity-60", cur === "custom" ? "border-accent" : "border-line")}
          style={custom ? { backgroundImage: `url(${custom})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
        >
          <span className="absolute inset-x-0 bottom-0 bg-bg/70 px-1 py-0.5 text-center">Your picture</span>
        </button>
      </div>
      <PictureButtons kind="bg" hasPicture={!!custom} label="picture" onDone={() => savePrefs({ bg: "custom" })} />
      {cur !== "none" && (
        <label className="block space-y-1">
          <span className="flex justify-between text-sm font-semibold">
            <span>Calmer background</span>
            <span className="text-muted">{p.bgDim ?? (cur === "custom" ? 60 : 0)}%</span>
          </span>
          <input type="range" min={0} max={90} step={5} value={p.bgDim ?? (cur === "custom" ? 60 : 0)} onChange={(e) => savePrefs({ bgDim: Number(e.target.value) })} className="w-full accent-[var(--c-accent)]" aria-label="How much the background is toned down" />
          <span className="block text-xs text-muted">Higher is calmer and makes text easier to read. Only you see your background.</span>
        </label>
      )}
    </div>
  );
}

/** Show, hide and reorder the sections of the home screen. */
export function HomeLayoutEditor() {
  const { user, isTrainer } = useViewer();
  if (!user) return null;
  const side = isTrainer ? "coach" : "client";
  const all = HOME_SECTIONS[side];
  const setting = user.prefs?.home?.[side];
  const hidden = setting?.hidden ?? [];
  const shown = arrange(all, setting ? { hidden: [], order: setting.order } : undefined).filter((s) => !hidden.includes(s.id));
  const hiddenOnes = all.filter((s) => hidden.includes(s.id));
  const rows = [...shown, ...hiddenOnes];
  const save = (order: string[], hide: string[]) => savePrefs({ home: { ...user.prefs?.home, [side]: { hidden: hide, order } } });
  const move = (i: number, d: -1 | 1) => {
    const ids = shown.map((s) => s.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    save([...ids, ...hiddenOnes.map((s) => s.id)], hidden);
  };
  const toggle = (id: string) => {
    const nextHidden = hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id];
    save(setting?.order?.length ? setting.order : all.map((s) => s.id), nextHidden);
  };
  return (
    <div className="space-y-2">
      {rows.map((s) => {
        const off = hidden.includes(s.id);
        const idx = shown.findIndex((x) => x.id === s.id);
        return (
          <div key={s.id} className={cn("flex items-center gap-2 rounded-xl border border-line bg-field px-3 py-2", off && "opacity-60")}>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{s.label}</span>
            <button type="button" aria-label={`Move ${s.label} up`} disabled={off || idx <= 0} onClick={() => move(idx, -1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-line disabled:opacity-30">
              <ArrowUp size={16} />
            </button>
            <button type="button" aria-label={`Move ${s.label} down`} disabled={off || idx === shown.length - 1} onClick={() => move(idx, 1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-line disabled:opacity-30">
              <ArrowDown size={16} />
            </button>
            <button type="button" aria-label={off ? `Show ${s.label}` : `Hide ${s.label}`} onClick={() => toggle(s.id)} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-line">
              {off ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        );
      })}
      <Button variant="ghost" size="sm" onClick={() => savePrefs({ home: { ...user.prefs?.home, [side]: { hidden: [], order: [] } } })}>
        Reset layout
      </Button>
    </div>
  );
}
