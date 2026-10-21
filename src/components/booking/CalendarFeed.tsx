"use client";

import { CalendarSync, Check, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, ConfirmDialog, Modal, Notice } from "@/components/ui";
import { api } from "@/lib/store";

interface Link {
  https: string;
  webcal: string;
}

/** Coach: subscribe a phone/desktop calendar to a private live feed of all booked, moved and cancelled sessions. */
export function CalendarFeedButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <CalendarSync size={14} /> Sync to My Calendar
      </Button>
      {open && <FeedModal onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedModal({ onClose }: { onClose: () => void }) {
  const [link, setLink] = useState<Link | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async (regenerate: boolean) => {
    setLoading(true);
    setError(null);
    const r = await api<Link>("/api/calendar-link", { method: regenerate ? "POST" : "GET", body: regenerate ? {} : undefined });
    setLoading(false);
    if (r.ok && r.data) setLink(r.data);
    else setError(r.error ?? "Could not create your calendar link.");
  };

  // Fetch (or create) the link when the modal opens.
  useEffect(() => {
    let alive = true;
    api<Link>("/api/calendar-link").then((r) => {
      if (!alive) return;
      if (r.ok && r.data) setLink(r.data);
      else setError(r.error ?? "Could not create your calendar link.");
    });
    return () => {
      alive = false;
    };
  }, []);

  const googleUrl = link ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(link.webcal)}` : "#";

  return (
    <Modal open onClose={onClose} title="Sync to My Calendar" wide footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-5">
        <p className="text-sm text-muted">
          Subscribe once and every session you book, move or cancel appears in your calendar app automatically — no more adding events by hand.
        </p>
        {error && <Notice tone="error">{error}</Notice>}
        {!link && !error && <div className="h-24 animate-pulse rounded-xl bg-field" />}

        {link && (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <a href={link.webcal}>
                <Button className="w-full">
                  <CalendarSync size={16} /> Subscribe — Apple / Outlook
                </Button>
              </a>
              <a href={googleUrl} target="_blank" rel="noreferrer">
                <Button variant="secondary" className="w-full">
                  <ExternalLink size={16} /> Add to Google Calendar
                </Button>
              </a>
            </div>

            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Your private link</div>
              <div className="flex items-center gap-2 rounded-xl border border-line bg-field p-2">
                <code className="min-w-0 flex-1 truncate px-1 text-xs">{link.https}</code>
                <button
                  aria-label="Copy calendar link"
                  onClick={async () => {
                    await navigator.clipboard.writeText(link.https).catch(() => undefined);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface text-muted hover:text-ink"
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
            </div>

            <div className="space-y-2 rounded-xl border border-line p-3 text-xs text-muted">
              <div className="font-semibold text-ink">How it works</div>
              <p>
                <span className="font-semibold text-ink">iPhone / Mac:</span> tap Subscribe, then Subscribe again.{" "}
                <span className="font-semibold text-ink">Google (Android or web):</span> use Add to Google Calendar.{" "}
                <span className="font-semibold text-ink">Outlook:</span> Add calendar → Subscribe from web → paste the link.
              </p>
              <p>
                Calendar apps check the link on their own schedule — Apple Calendar every few minutes to hours, Outlook every few hours, and Google roughly once or twice a day — so a change can take a while to appear. For an instant update, accept the emailed invite sent whenever a session is booked.
              </p>
              <p>The link is a secret: anyone who has it can see your client names, session times and locations (never notes).</p>
            </div>

            <Button variant="ghost" size="sm" onClick={() => setConfirm(true)} disabled={loading}>
              <RefreshCw size={14} /> Generate a new link (disables the old one)
            </Button>
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        danger
        title="Generate a new calendar link?"
        message="Calendars subscribed to the current link will stop updating. You'll need to subscribe again with the new link."
        confirmLabel="Generate new link"
        onConfirm={() => void load(true)}
      />
    </Modal>
  );
}
