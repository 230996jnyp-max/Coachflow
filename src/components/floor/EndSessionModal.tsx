"use client";

import { CheckCircle2, CloudOff, UserCheck, UserX } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Avatar, Button, Modal, Notice, Toggle } from "@/components/ui";
import { endPlan, type EndMark, type FloorSession } from "@/lib/floor";
import { useViewer } from "@/lib/hooks";
import { endFloorSession, type FloorEndResult } from "@/lib/store";
import { cn } from "@/lib/utils";

type Stage = { name: "ask" } | { name: "busy" } | { name: "done"; result: FloorEndResult };

/** "End session": everyone present or no-show in one go, then one call settles credits, finalises the session and sends recaps. */
export function EndSessionModal({ session, onClose }: { session: FloorSession; onClose: () => void }) {
  const { db } = useViewer();
  const plan = endPlan(session.participants, db.workouts, session);
  const [marks, setMarks] = useState<Record<string, EndMark | null>>(() => Object.fromEntries(plan.map((r) => [r.clientId, r.suggested])));
  const [deduct, setDeduct] = useState<Record<string, boolean>>({});
  const [stage, setStage] = useState<Stage>({ name: "ask" });
  const nameOf = (id: string) => db.users.find((u) => u.id === id)?.name ?? "Client";
  const missing = plan.filter((r) => !marks[r.clientId]).length;
  const present = plan.filter((r) => marks[r.clientId] === "PRESENT").length;

  const confirm = async () => {
    setStage({ name: "busy" });
    const result = await endFloorSession(
      { kind: session.kind, id: session.targetId },
      plan.map((r) => ({ clientId: r.clientId, workoutId: r.workoutId, mark: marks[r.clientId] as EndMark, deduct: marks[r.clientId] === "NO_SHOW" ? !!deduct[r.clientId] : undefined })),
    );
    setStage({ name: "done", result });
  };

  if (stage.name === "done") {
    const r = stage.result;
    return (
      <Modal open onClose={onClose} title={r.ok ? "Session complete" : r.queued ? "Saved on this device" : "Couldn't finish the session"} footer={<Link href="/trainer" className="inline-flex min-h-11 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent">Back to dashboard</Link>}>
        {r.ok ? (
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 shrink-0 text-success" />
            <p className="text-sm">
              Attendance and credits are settled, {present} workout{present === 1 ? "" : "s"} finished, and {r.recaps} recap{r.recaps === 1 ? "" : "s"} sent to your clients.
            </p>
          </div>
        ) : r.queued ? (
          <div className="flex items-start gap-3">
            <CloudOff className="mt-0.5 shrink-0 text-pr" />
            <p className="text-sm">There’s no connection right now, so nothing is lost. Everything is kept on this device and the session finishes by itself, with credits and recaps, as soon as you’re back online. You can leave this page.</p>
          </div>
        ) : (
          <Notice tone="error">{r.error ?? "Something went wrong."} The workouts are saved. You can set attendance from the schedule instead.</Notice>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={stage.name === "busy" ? () => undefined : onClose}
      title="End session"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={stage.name === "busy"}>
            Keep going
          </Button>
          <Button variant="success" onClick={confirm} disabled={missing > 0 || stage.name === "busy"}>
            {stage.name === "busy" ? "Finishing…" : "End session"}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">Finishes everyone’s workout, settles credits and sends each client their recap. Anyone with nothing logged needs a mark.</p>
      <div className="space-y-2">
        {plan.map((r) => {
          const m = marks[r.clientId];
          return (
            <div key={r.clientId} className="rounded-xl border border-line p-3">
              <div className="flex items-center gap-3">
                <Avatar name={nameOf(r.clientId)} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{nameOf(r.clientId)}</div>
                  <div className="text-xs text-muted">{r.doneSets > 0 ? `${r.doneSets} set${r.doneSets === 1 ? "" : "s"} logged` : "Nothing logged"}</div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant={m === "PRESENT" ? "success" : "secondary"} aria-pressed={m === "PRESENT"} onClick={() => setMarks((x) => ({ ...x, [r.clientId]: "PRESENT" }))}>
                    <UserCheck size={14} /> Present
                  </Button>
                  <Button size="sm" variant={m === "NO_SHOW" ? "danger" : "secondary"} aria-pressed={m === "NO_SHOW"} onClick={() => setMarks((x) => ({ ...x, [r.clientId]: "NO_SHOW" }))}>
                    <UserX size={14} /> No-show
                  </Button>
                </div>
              </div>
              {m === "NO_SHOW" && (
                <div className={cn("mt-2 border-t border-line pt-2")}>
                  <Toggle checked={!!deduct[r.clientId]} onChange={(v) => setDeduct((x) => ({ ...x, [r.clientId]: v }))} label="Take the credit anyway" />
                </div>
              )}
              {m === "PRESENT" && r.doneSets === 0 && <p className="mt-2 text-xs text-muted">They were there but nothing was logged, so no workout is saved for them.</p>}
            </div>
          );
        })}
      </div>
      {missing > 0 && <p className="mt-3 text-xs font-semibold text-pr">Choose Present or No-show for {missing} more {missing === 1 ? "person" : "people"}.</p>}
    </Modal>
  );
}
