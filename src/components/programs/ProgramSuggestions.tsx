"use client";

import { format, parseISO } from "date-fns";
import { Check, Lightbulb, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, Notice } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { api, refreshAssignments } from "@/lib/store";

interface Item {
  exerciseId: string;
  kind: "progress" | "hold" | "easier";
  weight?: number;
  text: string;
}
interface Suggestion {
  id: string;
  clientId: string;
  clientName: string;
  programName: string;
  weekStart: string;
  summary: string;
  items: Item[];
}

/**
 * Monday suggestions from what clients logged ("hit every set: go up 2.5 kg", "missed two workouts: an easier week"). Nothing changes until
 * the coach taps Apply; Apply changes only that client's coming week. On the dashboard it lists everyone; on a client's Plan tab only them.
 */
export function ProgramSuggestions({ clientId, showCheck }: { clientId?: string; showCheck?: boolean }) {
  const { exMap, isTrainer } = useViewer();
  const [list, setList] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!isTrainer) return;
    let alive = true;
    void (async () => {
      const r = await api<{ suggestions: Suggestion[] }>("/api/programs/suggestions");
      if (alive && r.ok && r.data) setList(r.data.suggestions);
    })();
    return () => {
      alive = false;
    };
  }, [isTrainer]);

  if (!isTrainer || !list) return null;
  const shown = clientId ? list.filter((s) => s.clientId === clientId) : list;

  const decide = async (s: Suggestion, action: "apply" | "dismiss") => {
    setBusy(s.id);
    const r = await api<{ changed: number; suggestions: Suggestion[] }>(`/api/programs/suggestions/${s.id}`, { body: { action } });
    setBusy(null);
    if (!r.ok || !r.data) return setMsg(r.error ?? "That didn't work.");
    setList(r.data.suggestions);
    if (action === "apply") {
      setMsg(`Done: ${s.clientName.split(" ")[0]}'s coming week was updated.`);
      await refreshAssignments();
    }
  };

  const check = async () => {
    setChecking(true);
    const r = await api<{ made: number; suggestions: Suggestion[] }>("/api/programs/suggestions", { body: {} });
    setChecking(false);
    if (!r.ok || !r.data) return setMsg(r.error ?? "That didn't work.");
    setList(r.data.suggestions);
    setMsg(r.data.made > 0 ? `Found ${r.data.made} client${r.data.made === 1 ? "" : "s"} to look at.` : "Nothing to suggest right now: last week looks fine, or nobody has a program running.");
  };
  const checkButton = showCheck ? (
    <Button size="sm" variant="secondary" disabled={checking} onClick={() => void check()}>
      {checking ? "Looking…" : "Check how last week went"}
    </Button>
  ) : null;

  if (shown.length === 0)
    return checkButton || msg ? (
      <div className="space-y-2">
        {checkButton}
        {msg && <Notice tone="success">{msg}</Notice>}
      </div>
    ) : null;

  return (
    <section className="space-y-2" data-suggestions>
      <h2 className="flex items-center gap-2 text-sm font-bold">
        <Lightbulb size={16} className="text-pr" /> Program suggestions
      </h2>
      {checkButton}
      {msg && <Notice tone="success">{msg}</Notice>}
      {shown.map((s) => (
        <Card key={s.id} className="space-y-2 p-4" data-suggestion={s.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              {clientId ? (
                <span className="font-bold">{s.programName}</span>
              ) : (
                <Link href={`/clients/${s.clientId}`} className="font-bold hover:underline">
                  {s.clientName}
                </Link>
              )}
              <span className="text-xs text-muted">
                {" "}
                · {clientId ? "" : `${s.programName} · `}week of {format(parseISO(s.weekStart), "d MMM")}
              </span>
            </div>
            <span className="text-xs text-muted">{s.summary}</span>
          </div>
          <ul className="space-y-1 text-sm">
            {s.items.map((i, n) => (
              <li key={n} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-pr" />
                <span>
                  {i.exerciseId !== "*" && <b>{exMap.get(i.exerciseId)?.name ?? "Exercise"}: </b>}
                  {i.text}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" disabled={busy !== null} onClick={() => void decide(s, "apply")}>
              <Check size={14} /> Apply to their week
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void decide(s, "dismiss")}>
              <X size={14} /> Dismiss
            </Button>
          </div>
        </Card>
      ))}
    </section>
  );
}
