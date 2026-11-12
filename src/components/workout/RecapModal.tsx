"use client";

import { Check, Copy, Download, FileText, Mail, Trophy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { NewBadges } from "@/components/progress/NewBadges";
import { Badge, Button, Modal, Notice } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { buildRecap, recapText } from "@/lib/recap";
import { recapPdf, recapPng, saveBlob } from "@/lib/recapImage";
import { api } from "@/lib/store";

type Flash = { tone: "success" | "error"; text: string } | null;

/**
 * The post-workout recap card: brand, title, date, duration, focus, totals, every new PR (gold), the coach's notes and the client's
 * remaining credits, with one-tap sharing: copy for WhatsApp / chat, email it to the client, or save it as a picture / PDF.
 * `children` shows under the card (the finish screen puts the "how did it feel" questions there).
 */
export function RecapModal({ workoutId, open, onClose, children, title = "Workout recap" }: { workoutId: string; open: boolean; onClose: () => void; children?: ReactNode; title?: string }) {
  const { db, unit, exMap, user, isTrainer } = useViewer();
  const [flash, setFlash] = useState<Flash>(null);
  const [busy, setBusy] = useState<"copy" | "email" | "png" | "pdf" | null>(null);

  const w = db.workouts.find((x) => x.id === workoutId);
  const profile = w ? db.clients.find((c) => c.id === w.clientId) : undefined;
  const clientName = w ? (db.users.find((u) => u.id === w.clientId)?.name ?? "") : "";
  if (!open || !w || !user) return null;

  const recap = buildRecap(w, exMap, {
    brand: db.settings.brandName,
    clientName,
    focuses: profile?.focuses ?? [],
    credits: profile ? { oneOnOne: profile.credits, group: profile.groupClassCredits ?? 0 } : null,
    unit,
  });
  const hasEmail = !!profile?.email?.trim();
  const fileBase = `${recap.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "workout"}-${w.startedAt.slice(0, 10)}`;

  const run = async (kind: "copy" | "email" | "png" | "pdf") => {
    setBusy(kind);
    setFlash(null);
    try {
      if (kind === "copy") {
        const text = recapText(recap);
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setFlash({ tone: "success", text: "Copied. Paste it into WhatsApp or the chat." });
      } else if (kind === "email") {
        const r = await api<{ to: string }>(`/api/training/workouts/${w.id}/recap`, { body: {} });
        setFlash(r.ok ? { tone: "success", text: `Recap emailed to ${r.data?.to ?? "the client"}.` } : { tone: "error", text: r.error ?? "Couldn't send the email." });
      } else if (kind === "png") {
        saveBlob(await recapPng(recap), `${fileBase}.png`);
        setFlash({ tone: "success", text: "Picture saved." });
      } else {
        saveBlob(await recapPdf(recap), `${fileBase}.pdf`);
        setFlash({ tone: "success", text: "PDF saved." });
      }
    } catch {
      setFlash({ tone: "error", text: "That didn't work. Please try again." });
    }
    setBusy(null);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <Button onClick={onClose}>
          <Check size={16} /> Done
        </Button>
      }
    >
      <div className="space-y-4">
        {/* The card */}
        <div className="overflow-hidden rounded-2xl border border-line bg-bg">
          <div className="flex items-center justify-between bg-accent px-4 py-3 text-on-accent">
            <span className="text-lg font-bold">{recap.brand}</span>
            <span className="text-xs font-semibold opacity-90">Workout recap</span>
          </div>
          <div className="space-y-4 p-4">
            <div>
              <div className="text-xl font-bold">{recap.title}</div>
              <div className="text-sm text-muted">{[recap.clientName, recap.date, recap.duration].filter(Boolean).join(" · ")}</div>
              {recap.focus.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {recap.focus.map((f) => (
                    <Badge key={f} className="border-accent/30 bg-accent/10 text-accent">
                      {f}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Tile label="Exercises" value={String(recap.exercises)} />
              <Tile label="Sets" value={String(recap.sets)} />
              <Tile label={recap.volume ? "Volume" : "Duration"} value={recap.volume || recap.duration || "—"} />
            </div>
            {recap.prs.length > 0 ? (
              <div>
                <div className="mb-2 flex items-center gap-2 text-sm font-bold text-pr">
                  <Trophy size={16} /> {recap.prs.length} new personal record{recap.prs.length === 1 ? "" : "s"} today
                </div>
                <ul className="space-y-1.5">
                  {recap.prs.slice(0, 8).map((p) => (
                    <li key={p.exercise} className="flex items-center justify-between gap-3 rounded-lg bg-pr/10 px-3 py-2 text-sm">
                      <span className="truncate font-medium">{p.exercise}</span>
                      <span className="shrink-0 text-xs font-semibold text-pr">{p.records.join(" · ")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <Notice>Great work. Consistency builds records. No new PRs this time.</Notice>
            )}
            {recap.notes && (
              <div>
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted">Coach notes</div>
                <p className="whitespace-pre-wrap text-sm">{recap.notes}</p>
              </div>
            )}
            {recap.credits && (
              <div className="flex items-center justify-between rounded-xl bg-field px-4 py-3 text-sm">
                <span className="font-semibold">Sessions left</span>
                <span className="text-lg font-bold text-accent">
                  {recap.credits.oneOnOne}
                  {recap.credits.group > 0 && <span className="ml-2 text-xs font-semibold text-muted">group {recap.credits.group}</span>}
                </span>
              </div>
            )}
          </div>
        </div>

        <NewBadges workoutId={w.id} clientId={w.clientId} />

        {/* Share */}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => void run("copy")} disabled={busy !== null}>
            <Copy size={16} /> Copy for WhatsApp
          </Button>
          <Button variant="secondary" onClick={() => void run("email")} disabled={busy !== null || !hasEmail}>
            <Mail size={16} /> {busy === "email" ? "Sending…" : isTrainer ? "Email to client" : "Email me this"}
          </Button>
          <Button variant="secondary" onClick={() => void run("png")} disabled={busy !== null}>
            <Download size={16} /> {busy === "png" ? "Making…" : "Save picture"}
          </Button>
          <Button variant="secondary" onClick={() => void run("pdf")} disabled={busy !== null}>
            <FileText size={16} /> {busy === "pdf" ? "Making…" : "Save PDF"}
          </Button>
        </div>
        {!hasEmail && <p className="text-xs text-muted">{isTrainer ? "This client has no email address on file. Add one on their profile to email the recap." : "Add your email address on your profile to email yourself the recap."}</p>}
        {flash && <Notice tone={flash.tone === "error" ? "error" : "success"}>{flash.text}</Notice>}
        {children}
      </div>
    </Modal>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-field py-2.5">
      <div className="text-lg font-bold">{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}
