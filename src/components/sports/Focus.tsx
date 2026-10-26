"use client";

import { Pencil, Plus, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, Card, Modal, Notice } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { CORE_SPORTS, sportLabel } from "@/lib/sports";
import { saveClientFocuses, updateSettings } from "@/lib/store";
import { cn } from "@/lib/utils";
import { AiSportModal } from "./AiSportModal";

/** Every sport the coach can assign or specialise in: the built-in ones plus those added with AI. */
export function useSportOptions(): string[] {
  const { db } = useViewer();
  return [...CORE_SPORTS, ...(db.settings.sports ?? [])];
}

export function SportChip({ label, on, onClick, disabled }: { label: string; on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cn("min-h-10 rounded-full border px-4 text-sm font-semibold transition-colors disabled:opacity-60", on ? "border-accent bg-accent text-on-accent" : "border-line bg-field text-muted hover:text-ink")}
    >
      {sportLabel(label)}
    </button>
  );
}

/** Coach: what this client trains (one or several). The client's and the coach's exercise pickers follow it. Saves as you tap. */
export function FocusPicker({ clientId }: { clientId: string }) {
  const { db } = useViewer();
  const options = useSportOptions();
  const profile = db.clients.find((c) => c.id === clientId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!profile) return null;
  const current = profile.focuses ?? [];
  const toggle = async (s: string) => {
    setBusy(true);
    setError(null);
    const next = current.includes(s) ? current.filter((x) => x !== s) : [...current, s];
    setError(await saveClientFocuses(clientId, next));
    setBusy(false);
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {options.map((s) => (
          <SportChip key={s} label={s} on={current.includes(s)} disabled={busy} onClick={() => void toggle(s)} />
        ))}
      </div>
      <p className="text-xs text-muted">
        {current.length === 0 ? "Nothing assigned: this client sees every exercise." : `This client's exercise picker${current.length > 1 ? " shows all of these, with a filter for each" : " shows only " + sportLabel(current[0])}. Clients can't change it.`}
      </p>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

/** The client's focuses as small pills, with a pencil to change them (used in the workout logger and the client page). */
export function ClientFocusBadge({ clientId }: { clientId: string }) {
  const { db, isTrainer } = useViewer();
  const [open, setOpen] = useState(false);
  const profile = db.clients.find((c) => c.id === clientId);
  if (!profile || !isTrainer) return null;
  const f = profile.focuses ?? [];
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-field py-1 pl-3 pr-2.5 text-xs font-semibold text-muted hover:text-ink" aria-label="Change training focus">
        <span>Focus: {f.length ? f.map(sportLabel).join(", ") : "all sports"}</span>
        <Pencil size={12} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Training focus" footer={<Button onClick={() => setOpen(false)}>Done</Button>}>
        <FocusPicker clientId={clientId} />
      </Modal>
    </>
  );
}

/**
 * Coach: choose what you specialise in. Your exercise library, routine builder and session-focus lists show these first.
 * `compact` is the dashboard prompt for coaches who haven't chosen yet.
 */
export function SpecialtiesCard({ compact, onDismiss }: { compact?: boolean; onDismiss?: () => void }) {
  const { db } = useViewer();
  const options = useSportOptions();
  const [adding, setAdding] = useState(false);
  const specialties = db.settings.specialties ?? [];
  const added = db.settings.sports ?? [];
  const toggle = (s: string) => updateSettings({ specialties: specialties.includes(s) ? specialties.filter((x) => x !== s) : [...specialties, s] });
  const removeSport = (s: string) => updateSettings({ sports: added.filter((x) => x !== s), specialties: specialties.filter((x) => x !== s) });

  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{compact ? "What do you coach?" : "Coaching specialties"}</div>
          <p className="text-xs text-muted">Pick one or more. Your Exercise Library, routine builder and session focus lists put these first — you can always show every sport.</p>
        </div>
        {compact && onDismiss && (
          <button type="button" onClick={onDismiss} aria-label="Not now" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-field hover:text-ink">
            <X size={16} />
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((s) => (
          <span key={s} className="inline-flex items-center">
            <SportChip label={s} on={specialties.includes(s)} onClick={() => toggle(s)} />
            {added.includes(s) && (
              <button type="button" aria-label={`Remove ${s}`} onClick={() => removeSport(s)} className="-ml-2 flex h-6 w-6 items-center justify-center rounded-full bg-field text-muted hover:text-danger">
                <X size={12} />
              </button>
            )}
          </span>
        ))}
        <button type="button" onClick={() => setAdding(true)} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-dashed border-accent/50 px-4 text-sm font-semibold text-accent hover:bg-accent/10">
          <Plus size={14} /> <Sparkles size={13} /> Add a sport with AI
        </button>
      </div>
      {compact && (
        <Link href="/settings" className="inline-block text-xs font-semibold text-accent">
          More in Settings →
        </Link>
      )}
      <AiSportModal open={adding} onClose={() => setAdding(false)} />
    </Card>
  );
}
