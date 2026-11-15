"use client";

import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { ArrowDown, ArrowUp, ChevronRight, GitCompare, LoaderCircle, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AssessmentEditor } from "@/components/assessment/AssessmentEditor";
import { AssessmentView } from "@/components/assessment/AssessmentView";
import { Badge, Button, Card, EmptyState, Notice, SectionTitle } from "@/components/ui";
import { compareAssessments } from "@/lib/assessment";
import type { AssessmentRec } from "@/lib/intakeApi";
import { api, refreshAccounts, useNow } from "@/lib/store";
import { cn } from "@/lib/utils";

/*
 * The list of a client's assessments, with starting a new one (the first session, then every 8 to 12 weeks), opening one, and
 * comparing them over time. Used by the coach on a client's Intake tab and by the client on their own page.
 */

type Mode = { kind: "list" } | { kind: "edit"; id: string } | { kind: "view"; id: string } | { kind: "compare" };

const day = (iso: string) => {
  try {
    return format(parseISO(iso), "d MMM yyyy");
  } catch {
    return iso;
  }
};

export function AssessmentHub({ clientId, clientName, role, minor, onChanged, onDetail }: { clientId: string; clientName: string; role: "COACH" | "CLIENT"; minor: boolean; onChanged?: () => void; onDetail?: (open: boolean) => void }) {
  const coach = role === "COACH";
  const [list, setList] = useState<AssessmentRec[] | null>(null);
  const [mode, setModeRaw] = useState<Mode>({ kind: "list" });
  // Tells the page around it when one assessment is open, so the page can hide everything else and give it the whole screen.
  const setMode = (m: Mode) => {
    setModeRaw(m);
    onDetail?.(m.kind !== "list");
  };
  const [rev, setRev] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const now = useNow(60_000);

  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await api<{ assessments: AssessmentRec[] }>(`/api/assessments?clientId=${encodeURIComponent(clientId)}`);
      if (!live) return;
      if (!r.ok || !r.data) setError(r.error ?? "Couldn't load assessments.");
      else {
        setError(null);
        setList(r.data.assessments);
      }
    })();
    return () => {
      live = false;
    };
  }, [clientId, rev]);

  const reload = () => {
    setRev((n) => n + 1);
    onChanged?.();
    // Opening a client's own assessment clears the "new" flag, which lives in the profile list.
    void refreshAccounts();
  };

  const start = async () => {
    setStarting(true);
    setError(null);
    const r = await api<{ assessment: AssessmentRec }>("/api/assessments", { body: coach ? { clientId } : {} });
    setStarting(false);
    if (!r.ok || !r.data) return setError(r.error ?? "Couldn't start one.");
    setRev((n) => n + 1);
    setMode({ kind: "edit", id: r.data.assessment.id });
  };

  const done = useMemo(() => (list ?? []).filter((a) => a.status === "DONE"), [list]);
  const lastCoachDone = done.find((a) => a.filledBy === "COACH");
  const weeksSince = lastCoachDone ? Math.floor(differenceInCalendarDays(now, parseISO(lastCoachDone.takenAt)) / 7) : null;

  if (mode.kind === "edit") return <AssessmentEditor id={mode.id} role={role} minor={minor} onClose={() => { setMode({ kind: "list" }); reload(); }} onSaved={() => setRev((n) => n + 1)} />;
  if (mode.kind === "view") {
    const rec = (list ?? []).find((a) => a.id === mode.id);
    if (!rec) return <Button variant="secondary" onClick={() => setMode({ kind: "list" })}>Back</Button>;
    return <AssessmentView rec={rec} role={role} clientName={clientName} minor={minor} onBack={() => setMode({ kind: "list" })} onChanged={reload} />;
  }
  if (mode.kind === "compare") return <Compare list={done} onBack={() => setMode({ kind: "list" })} />;

  return (
    <div className="space-y-4">
      <SectionTitle
        action={
          <div className="flex gap-2">
            {done.length >= 2 && (
              <Button variant="secondary" size="sm" onClick={() => setMode({ kind: "compare" })}>
                <GitCompare size={14} /> Compare
              </Button>
            )}
            <Button size="sm" onClick={() => void start()} disabled={starting}>
              {starting ? <LoaderCircle size={14} className="animate-spin" /> : <Plus size={14} />} {coach ? "New assessment" : "Fill in my own"}
            </Button>
          </div>
        }
      >
        Posture and fitness assessments
      </SectionTitle>

      {coach && weeksSince !== null && weeksSince >= 8 && (
        <Notice tone="info">
          It has been {weeksSince} weeks since the last one ({day(lastCoachDone!.takenAt)}). Repeating it every 8 to 12 weeks shows what has changed.
        </Notice>
      )}
      {coach && !list?.length && <p className="text-sm text-muted">Do one at the first session to see what to work on besides muscle, then repeat it every 8 to 12 weeks. Anything you write under “Others” is listed again next time.</p>}
      {!coach && <p className="text-sm text-muted">You can fill one in yourself before you meet. Your coach is told when you hand it in. When your coach does one with you, you get a copy here to read.</p>}

      {error && <Notice tone="error">{error}</Notice>}
      {list === null && !error && (
        <div className="flex items-center gap-2 p-4 text-sm text-muted">
          <LoaderCircle size={16} className="animate-spin" /> Loading…
        </div>
      )}
      {list && list.length === 0 && <EmptyState title="No assessments yet" hint={coach ? "Start one to record posture, movement and fitness." : "Nothing here yet."} />}
      <div className="space-y-2">
        {(list ?? []).map((a) => {
          const own = coach ? a.filledBy === "COACH" : a.filledBy === "CLIENT";
          const draft = a.status === "DRAFT";
          return (
            <button key={a.id} type="button" onClick={() => setMode({ kind: draft && own ? "edit" : "view", id: a.id })} className="block w-full text-left">
              <Card className="flex items-center gap-3 p-4 transition-colors hover:border-accent/50">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{day(a.takenAt)}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge>{a.filledBy === "CLIENT" ? (coach ? "Filled in by the client" : "My own") : "With the coach"}</Badge>
                    {draft && <Badge className="border-pr/30 bg-pr/15 text-pr">Draft</Badge>}
                    {coach && a.filledBy === "CLIENT" && !a.seenAt && <Badge className="border-accent/30 bg-accent/15 text-accent">New</Badge>}
                    {a.filledBy === "COACH" && a.sharedAt && !a.ackAt && <Badge className="border-accent/30 bg-accent/15 text-accent">{coach ? "Copy given" : "Please read and acknowledge"}</Badge>}
                    {a.ackAt && <Badge className="border-success/30 bg-success/15 text-success">Acknowledged</Badge>}
                    {a.photos.length > 0 && <Badge>{a.photos.length} photo{a.photos.length === 1 ? "" : "s"}</Badge>}
                  </div>
                </div>
                <ChevronRight size={18} className="text-muted" />
              </Card>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Comparing over time ---------------- */
function Compare({ list, onBack }: { list: AssessmentRec[]; onBack: () => void }) {
  const asc = useMemo(() => [...list].sort((a, b) => a.takenAt.localeCompare(b.takenAt) || a.createdAt.localeCompare(b.createdAt)), [list]);
  const rows = useMemo(() => compareAssessments(asc.map((a) => a.data)), [asc]);
  const groups = ["Posture", "Others", "Movement", "Tests"] as const;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <div className="font-semibold">Compare assessments</div>
      </div>
      {rows.length === 0 && <Notice tone="info">Nothing to compare yet. Fill in the same items at more than one assessment.</Notice>}
      {groups.map((g) => {
        const rs = rows.filter((r) => r.group === g);
        if (rs.length === 0) return null;
        return (
          <section key={g}>
            <SectionTitle>{g === "Tests" ? "Fitness tests" : g}</SectionTitle>
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="p-3 font-medium">Item</th>
                    {asc.map((a) => (
                      <th key={a.id} className="p-3 font-medium">
                        {day(a.takenAt)}
                        {a.filledBy === "CLIENT" ? " (self)" : ""}
                      </th>
                    ))}
                    <th className="p-3 font-medium">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {rs.map((r) => (
                    <tr key={`${r.group}-${r.key}`} className="border-t border-line">
                      <td className="p-3 font-medium">{r.label}</td>
                      {r.values.map((v, i) => (
                        <td key={i} className={cn("p-3", v === null && "text-muted")}>
                          {v ?? "—"}
                        </td>
                      ))}
                      <td className="p-3">
                        {r.trend === "better" && (
                          <span className="inline-flex items-center gap-1 text-success">
                            <ArrowUp size={14} /> Better
                          </span>
                        )}
                        {r.trend === "worse" && (
                          <span className="inline-flex items-center gap-1 text-danger">
                            <ArrowDown size={14} /> Worse
                          </span>
                        )}
                        {r.trend === "same" && (
                          <span className="inline-flex items-center gap-1 text-muted">
                            <Minus size={14} /> Same
                          </span>
                        )}
                        {r.trend === null && <span className="text-muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>
        );
      })}
    </div>
  );
}
