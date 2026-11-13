"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button, Card, Notice, SectionTitle, Stat } from "@/components/ui";
import type { GymState } from "./types";

/** The gym's home: who is in, what's happening this week, the gym code and the free month. Never a client count. */
export function GymOverview({ state, goTo }: { state: GymState; goTo: (tab: string) => void }) {
  const [copied, setCopied] = useState(false);
  const o = state.overview;
  const s = state.settings;
  if (!o || !s) return null;
  const trial = s.trial;
  return (
    <div className="space-y-6">
      {s.code && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-muted">Gym code for coaches</div>
            <div className="font-mono text-3xl font-bold tracking-[0.2em]">{s.code}</div>
            <div className="text-xs text-muted">Coaches enter it in Settings → Coaching, or when they sign up. You approve each one.</div>
          </div>
          <Button
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(s.code).catch(() => undefined);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy gym code for coaches"}
          </Button>
        </Card>
      )}

      {o.pending > 0 && (
        <Notice tone="warn">
          {o.pending === 1 ? "1 coach is" : `${o.pending} coaches are`} waiting for you to approve them.{" "}
          <button className="font-semibold underline" onClick={() => goTo("team")}>
            Review
          </button>
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Coaches" value={o.coaches} tone="accent" sub="in your gym" />
        <Stat label="This week" value={o.sessionsThisWeek} sub="sessions and classes" />
        <Stat label="Hours this month" value={o.hoursThisMonth} sub="completed" tone="success" />
        <Stat label="Cover this week" value={o.coversThisWeek} sub="sessions covered" />
      </div>

      {trial && (
        <section>
          <SectionTitle>Your plan</SectionTitle>
          <Card className="p-4 text-sm">
            {trial.expired ? (
              <span>
                Your free month has ended. {trial.enforced ? "The platform is paused for you and your coaches until you subscribe." : "Subscriptions are opening soon."}
              </span>
            ) : (
              <span>
                Free trial: <strong>{trial.daysLeft} day{trial.daysLeft === 1 ? "" : "s"} left</strong>. It covers you and every coach in your gym. When it ends, the platform stops for the gym&apos;s coaches and admins until you subscribe.
              </span>
            )}
          </Card>
        </section>
      )}
    </div>
  );
}
