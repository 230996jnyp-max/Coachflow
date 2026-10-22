"use client";

import { format, isAfter, parseISO } from "date-fns";
import { CalendarClock, ChevronRight, Dumbbell, Plus, Ticket } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { LocationPill } from "@/components/LocationPill";
import { Button, Card, ConfirmDialog, EmptyState, Notice, SectionTitle } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { bookClass, leaveClass, requestToJoin, useNow, withdrawRequest } from "@/lib/store";
import type { GroupSession } from "@/lib/types";
import { CreateClassModal } from "./CreateClassModal";
import { ApprovalCard, classLocation, classTime, classTitle, GroupBadge, SpotsPill } from "./groupUi";

/** Group credits of the signed-in client: what they hold, what is promised to upcoming classes, what is left to book. */
export function useGroupCredits() {
  const { db, user } = useViewer();
  const profile = user ? db.clients.find((c) => c.id === user.id) : undefined;
  // Promised to an upcoming class and not yet settled by an attendance mark (the owner of a partner session uses one too).
  const reserved = db.groups.filter((g) => g.status === "OPEN" && g.mine?.status === "CONFIRMED" && !g.mine.attendance).length;
  const total = profile?.groupClassCredits ?? 0;
  return { total, reserved, available: total - reserved };
}

export function GroupCreditsCard() {
  const { total, reserved, available } = useGroupCredits();
  return (
    <Card className="grid grid-cols-3 divide-x divide-line p-4 text-center">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Group credits</div>
        <div className="mt-1 text-2xl font-bold">{total}</div>
      </div>
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Reserved</div>
        <div className="mt-1 text-2xl font-bold text-pr">{reserved}</div>
      </div>
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Available to book</div>
        <div className={`mt-1 text-2xl font-bold ${available > 0 ? "text-success" : "text-danger"}`}>{available}</div>
      </div>
    </Card>
  );
}

/** What a client can do with a class (book, waitlist, leave, ask to join a shared session). Used on cards and on the class page. */
export function ClientActions({ g }: { g: GroupSession }) {
  const { available } = useGroupCredits();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const { db } = useViewer();
  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    const err = await fn();
    setBusy(false);
    if (err) setError(err);
  };
  const open = g.status === "OPEN";
  const mine = g.mine;
  const req = db.groupRequests.find((r) => r.groupId === g.id && r.mine && r.status === "PENDING");

  let body: React.ReactNode = null;
  if (!open) body = null;
  else if (mine?.role === "OWNER") body = <span className="text-xs font-semibold text-success">This is your session</span>;
  else if (mine?.status === "CONFIRMED") {
    body = (
      <>
        <span className="text-xs font-semibold text-success">You’re in</span>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirmLeave(true)}>
          Leave
        </Button>
      </>
    );
  } else if (mine?.status === "WAITLIST") {
    body = (
      <>
        <span className="text-xs font-semibold text-pr">Waitlist #{mine.position}</span>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => leaveClass(g.id))}>
          Leave waitlist
        </Button>
      </>
    );
  } else if (g.kind === "CLASS") {
    body =
      g.spotsLeft > 0 ? (
        <Button size="sm" disabled={busy || available < 1} onClick={() => run(async () => (await bookClass(g.id)).error)}>
          Book spot
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => (await bookClass(g.id)).error)}>
          Join waitlist
        </Button>
      );
  } else if (req) {
    body = (
      <>
        <span className="text-xs font-semibold text-pr">Request sent — waiting for approval</span>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => withdrawRequest(req.id))}>
          Withdraw
        </Button>
      </>
    );
  } else {
    body =
      g.spotsLeft > 0 ? (
        <Button size="sm" disabled={busy || available < 1} onClick={() => run(() => requestToJoin(g.id))}>
          Ask to join
        </Button>
      ) : (
        <span className="text-xs font-semibold text-danger">Full</span>
      );
  }

  const needsCredit = open && !mine && available < 1 && (g.kind === "SHARED" || g.spotsLeft > 0);
  return (
    <div className="space-y-2">
      {body && <div className="flex flex-wrap items-center justify-end gap-2">{body}</div>}
      {needsCredit && <p className="text-right text-[11px] text-danger">You have no group class credits left — ask your coach to add some.</p>}
      {error && <Notice tone="error">{error}</Notice>}
      <ConfirmDialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title="Leave this class?"
        message="Your spot goes to the next person on the waitlist. No group credit is used."
        confirmLabel="Leave class"
        danger
        onConfirm={() => run(() => leaveClass(g.id))}
      />
    </div>
  );
}

function ClassCard({ g, mode }: { g: GroupSession; mode: "coach" | "client" }) {
  const { db } = useViewer();
  const loc = classLocation(g, db.gyms);
  return (
    <Card className="p-0">
      <Link href={`/classes/${g.id}`} className="flex items-center gap-3 p-3">
        <div className="w-[64px] shrink-0 text-center">
          <div className="text-[10px] font-bold uppercase text-muted">{format(parseISO(g.start), "EEE")}</div>
          <div className="text-xl font-bold leading-tight">{format(parseISO(g.start), "d")}</div>
          <div className="text-[10px] text-muted">{format(parseISO(g.start), "MMM")}</div>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-bold">{classTitle(g)}</span>
            <GroupBadge g={g} />
            {g.workoutStartedAt && g.status === "OPEN" && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-accent">
                <Dumbbell size={11} /> Workout live
              </span>
            )}
          </div>
          <div className="truncate text-xs text-muted">{classTime(g)}</div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <LocationPill nested small label={loc.label} href={loc.href} className="font-medium" />
            {mode === "coach" ? (
              <span className="text-xs font-semibold text-muted">
                {g.confirmed} / {g.capacity} booked{g.waitlist > 0 ? ` · ${g.waitlist} waitlisted` : ""}
              </span>
            ) : (
              <SpotsPill g={g} />
            )}
          </div>
        </div>
        <ChevronRight size={16} className="shrink-0 text-muted" />
      </Link>
      {mode === "client" && g.status === "OPEN" && (
        <div className="border-t border-line px-3 py-2">
          <ClientActions g={g} />
        </div>
      )}
    </Card>
  );
}

export function ClassList({ mode }: { mode: "coach" | "client" }) {
  const { db } = useViewer();
  const now = useNow(60_000);
  const [creating, setCreating] = useState(false);
  const upcoming = db.groups.filter((g) => g.status === "OPEN" && isAfter(parseISO(g.end), now)).sort((a, b) => a.start.localeCompare(b.start));
  const past = db.groups.filter((g) => !(g.status === "OPEN" && isAfter(parseISO(g.end), now))).sort((a, b) => b.start.localeCompare(a.start));
  const mineList = mode === "client" ? upcoming.filter((g) => g.mine) : [];
  const others = mode === "client" ? upcoming.filter((g) => !g.mine) : upcoming;
  const toAnswer = db.groupRequests.filter((r) => r.needsMe);
  const mineReqs = db.groupRequests.filter((r) => r.mine && r.status === "PENDING");

  return (
    <div className="space-y-6">
      {mode === "client" && <GroupCreditsCard />}

      {toAnswer.length > 0 && (
        <section>
          <SectionTitle>Waiting for your answer</SectionTitle>
          <div className="space-y-2">
            {toAnswer.map((r) => (
              <ApprovalCard key={r.id} req={r} group={db.groups.find((g) => g.id === r.groupId)} />
            ))}
          </div>
        </section>
      )}

      {mode === "coach" && (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} /> Schedule class
          </Button>
        </div>
      )}

      {mode === "client" && mineReqs.length > 0 && <Notice tone="info">You have {mineReqs.length} join request{mineReqs.length === 1 ? "" : "s"} waiting for approval.</Notice>}

      {mode === "client" && (
        <section>
          <SectionTitle>
            <span className="inline-flex items-center gap-2">
              <Ticket size={14} /> My group sessions
            </span>
          </SectionTitle>
          {mineList.length === 0 ? (
            <EmptyState title="No group sessions yet" hint="Book a spot in a class below, or open one of your own sessions to a partner from your booking." />
          ) : (
            <div className="space-y-2">
              {mineList.map((g) => (
                <ClassCard key={g.id} g={g} mode={mode} />
              ))}
            </div>
          )}
        </section>
      )}

      <section>
        <SectionTitle>
          <span className="inline-flex items-center gap-2">
            <CalendarClock size={14} /> {mode === "client" ? "Open classes & partner sessions" : "Upcoming classes"}
          </span>
        </SectionTitle>
        {others.length === 0 ? (
          <EmptyState
            title={mode === "coach" ? "No classes scheduled" : "Nothing open right now"}
            hint={mode === "coach" ? "Schedule a group class and your clients can book a spot until it’s full." : "Your coach hasn’t scheduled any open group classes yet."}
          />
        ) : (
          <div className="space-y-2">
            {others.map((g) => (
              <ClassCard key={g.id} g={g} mode={mode} />
            ))}
          </div>
        )}
      </section>

      {past.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-muted">Past &amp; closed ({past.length})</summary>
          <div className="mt-3 space-y-2">
            {past.slice(0, 30).map((g) => (
              <ClassCard key={g.id} g={g} mode={mode} />
            ))}
          </div>
        </details>
      )}

      {mode === "coach" && <CreateClassModal open={creating} onClose={() => setCreating(false)} />}
    </div>
  );
}
