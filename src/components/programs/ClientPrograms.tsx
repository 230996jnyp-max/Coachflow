"use client";

import { format, parseISO } from "date-fns";
import { Layers, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Modal, Notice } from "@/components/ui";
import { api, refreshAssignments } from "@/lib/store";
import { AssignProgramModal } from "./AssignProgramModal";
import type { ProgramSummary } from "./ProgramsHome";

interface Enrolment {
  id: string;
  programId: string;
  programName: string;
  clientId: string;
  startDate: string;
  endDate: string;
  liveSync: boolean;
  behind: boolean;
}

/** On a client's Plan tab: the program they are on, and a way to give them one. */
export function ClientPrograms({ clientId }: { clientId: string }) {
  const [enrolments, setEnrolments] = useState<Enrolment[] | null>(null);
  const [programs, setPrograms] = useState<ProgramSummary[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [assigning, setAssigning] = useState<ProgramSummary | null>(null);
  const [ending, setEnding] = useState<Enrolment | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [e, p] = await Promise.all([api<{ enrolments: Enrolment[] }>(`/api/programs/enrolments?clientId=${clientId}`), api<{ programs: ProgramSummary[] }>("/api/programs")]);
    if (e.ok && e.data) setEnrolments(e.data.enrolments);
    if (p.ok && p.data) setPrograms(p.data.programs);
  }, [clientId]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [e, p] = await Promise.all([api<{ enrolments: Enrolment[] }>(`/api/programs/enrolments?clientId=${clientId}`), api<{ programs: ProgramSummary[] }>("/api/programs")]);
      if (!alive) return;
      if (e.ok && e.data) setEnrolments(e.data.enrolments);
      if (p.ok && p.data) setPrograms(p.data.programs);
    })();
    return () => {
      alive = false;
    };
  }, [clientId]);

  const end = async (removeFuture: boolean) => {
    if (!ending) return;
    const r = await api<{ removed: number }>(`/api/programs/enrolments/${ending.id}${removeFuture ? "?remove=1" : ""}`, { method: "DELETE" });
    setEnding(null);
    if (r.ok) {
      setMsg(removeFuture ? `Ended, and ${r.data?.removed ?? 0} coming workouts were removed.` : "Ended. The workouts already given stay.");
      await refreshAssignments();
      await load();
    } else setMsg(r.error ?? "Couldn't end it.");
  };

  if (enrolments === null || programs === null) return null;

  return (
    <Card className="space-y-3 p-4" data-tour="client-programs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted">
          <Layers size={14} /> Program
        </h3>
        <Button size="sm" variant="secondary" onClick={() => setPicking(true)} disabled={programs.length === 0}>
          Assign a program
        </Button>
      </div>
      {msg && <Notice tone="info">{msg}</Notice>}
      {enrolments.length === 0 ? (
        <p className="text-sm text-muted">
          Not on a program. {programs.length === 0 ? <>Build one on the <Link href="/programs" className="font-semibold underline">Programs</Link> page first.</> : "Give them a multi-week program in one go."}
        </p>
      ) : (
        <ul className="space-y-2">
          {enrolments.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-field/50 px-3 py-2 text-sm">
              <Link href={`/programs/${e.programId}`} className="min-w-0 flex-1 font-semibold hover:underline">
                {e.programName}
              </Link>
              <span className="text-xs text-muted">
                {format(parseISO(e.startDate), "d MMM")} to {format(parseISO(e.endDate), "d MMM yyyy")}
              </span>
              <Badge className={e.liveSync ? "border-accent/30 bg-accent/15 text-accent" : undefined}>{e.liveSync ? "Live Sync" : "Fixed copy"}</Badge>
              {e.behind && <Badge className="border-pr/30 bg-pr/15 text-pr">Program changed since</Badge>}
              <Button size="sm" variant="ghost" onClick={() => setEnding(e)}>
                <X size={14} /> End
              </Button>
            </li>
          ))}
        </ul>
      )}

      {picking && (
        <Modal open onClose={() => setPicking(false)} title="Pick a program" footer={<Button variant="secondary" onClick={() => setPicking(false)}>Cancel</Button>}>
          <ul className="space-y-2">
            {programs
              .filter((p) => p.slotCount > 0)
              .map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => {
                      setPicking(false);
                      setAssigning(p);
                    }}
                    className="w-full rounded-xl border border-line bg-field/50 p-3 text-left hover:border-accent/50"
                  >
                    <div className="font-bold">{p.name}</div>
                    <div className="text-xs text-muted">{p.summary}</div>
                  </button>
                </li>
              ))}
            {programs.every((p) => p.slotCount === 0) && <li className="text-sm text-muted">Your programs have no workouts yet.</li>}
          </ul>
        </Modal>
      )}
      {assigning && <AssignProgramModal program={{ id: assigning.id, name: assigning.name, weeks: assigning.weeks, slotCount: assigning.slotCount }} solo={false} clientId={clientId} onClose={() => setAssigning(null)} onDone={() => void load()} />}
      {ending && (
        <Modal
          open
          onClose={() => setEnding(null)}
          title="End this program?"
          footer={
            <>
              <Button variant="secondary" onClick={() => setEnding(null)}>
                Cancel
              </Button>
              <Button variant="secondary" onClick={() => void end(false)}>
                End, keep the coming workouts
              </Button>
              <Button className="bg-danger text-on-danger" onClick={() => void end(true)}>
                End and remove the coming workouts
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">Workouts already done or in the past always stay.</p>
        </Modal>
      )}
    </Card>
  );
}
