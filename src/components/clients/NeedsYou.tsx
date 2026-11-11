"use client";

import { CheckCircle2, ChevronRight, Send } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar, Button, Card, SectionTitle } from "@/components/ui";
import { nudgeLists } from "@/lib/attention";
import { useViewer } from "@/lib/hooks";
import { NudgeModal } from "./NudgeModal";
import { ReasonBadges, useStatuses } from "./status";

/** The dashboard's "Needs you today": who skipped a session, is behind this week or has gone quiet, with a one-tap way to nudge them. */
export function NeedsYou() {
  const { clients } = useViewer();
  const statuses = useStatuses();
  const [nudging, setNudging] = useState(false);

  const active = useMemo(() => clients.filter((c) => !c.profile.archived), [clients]);
  const flagged = useMemo(
    () =>
      active
        .map((c) => ({ c, s: statuses.get(c.user.id) }))
        .filter((x): x is { c: (typeof active)[number]; s: NonNullable<typeof x.s> } => !!x.s?.attention)
        .sort((a, b) => b.s.noShows.length - a.s.noShows.length || b.s.reasons.length - a.s.reasons.length || a.c.user.name.localeCompare(b.c.user.name)),
    [active, statuses],
  );
  const lists = useMemo(() => nudgeLists(flagged.map((f) => f.s)), [flagged]);
  const canNudge = lists.noShow.length + lists.behind.length + lists.quiet.length > 0;
  const low = flagged.filter((f) => f.s.lowCredits).length;

  if (active.length === 0) return null;

  if (flagged.length === 0) {
    return (
      <Card className="flex items-center gap-3 border-success/30 bg-success/10 p-4" data-tour="needs-you">
        <CheckCircle2 size={22} className="shrink-0 text-success" />
        <div>
          <div className="font-semibold">Everyone is on track</div>
          <div className="text-xs text-muted">No missed sessions, nobody behind their weekly target and nobody gone quiet.</div>
        </div>
      </Card>
    );
  }

  return (
    <section data-tour="needs-you">
      <SectionTitle
        action={
          <Link href="/clients?group=attention" className="text-xs font-semibold text-accent">
            See all →
          </Link>
        }
      >
        Needs you today ({flagged.length})
      </SectionTitle>
      <Card className="space-y-3 border-pr/40 p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>
            <b className="text-ink">{lists.noShow.length}</b> missed a session
          </span>
          <span>
            <b className="text-ink">{lists.behind.length}</b> behind this week
          </span>
          <span>
            <b className="text-ink">{lists.quiet.length}</b> quiet 7+ days
          </span>
          <span>
            <b className="text-ink">{low}</b> low on credits
          </span>
        </div>
        <ul className="space-y-2">
          {flagged.slice(0, 5).map(({ c, s }) => (
            <li key={c.user.id}>
              <Link href={`/clients/${c.user.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-field/40 p-2.5 hover:border-accent/50" aria-label={`Open ${c.user.name}`}>
                <Avatar name={c.user.name} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{c.user.name}</div>
                  <ReasonBadges status={s} max={2} />
                </div>
                <ChevronRight size={16} className="shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
        {flagged.length > 5 && <div className="text-xs text-muted">+ {flagged.length - 5} more on the Clients page</div>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setNudging(true)} disabled={!canNudge}>
            <Send size={16} /> Review and nudge
          </Button>
          <Link href="/clients?group=attention">
            <Button variant="secondary">Open in Clients</Button>
          </Link>
        </div>
      </Card>
      <NudgeModal open={nudging} onClose={() => setNudging(false)} />
    </section>
  );
}
