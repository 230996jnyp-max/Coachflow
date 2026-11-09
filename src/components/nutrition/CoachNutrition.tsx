"use client";

import { format, parseISO } from "date-fns";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Send } from "lucide-react";
import { useState } from "react";
import { NumberInput } from "@/components/NumberInput";
import { Badge, Button, Card, Field, Notice, SectionTitle, Stat, Textarea } from "@/components/ui";
import { atwater, dayAdd, daysBack, dietConflicts, KCAL_MIN_COACH, sumMacros, weekSummary, type NutritionTargets } from "@/lib/nutrition";
import { dayString, postComment, saveTargets, useDiary } from "@/lib/nutritionClient";
import { cn } from "@/lib/utils";

/** A coach's view of one client's food diary: the week at a glance, targets, each day's foods, and comments the client is notified about. */
export function CoachNutrition({ clientId }: { clientId: string }) {
  const today = dayString();
  const [offset, setOffset] = useState(0);
  const to = dayAdd(today, -7 * offset);
  const from = dayAdd(to, -6);
  const { bundle, error, loading, reload } = useDiary(clientId, from, to);
  const [open, setOpen] = useState<string | null>(today);

  if (!bundle) return <div className="py-12 text-center text-sm text-muted">{error ?? "Loading…"}</div>;
  const { entries, targets, settings, comments } = bundle;
  const week = weekSummary(entries, daysBack(to, 7), targets);
  const minor = settings.adult === false;

  return (
    <div className={cn("space-y-6", loading && "opacity-70")}>
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {settings.diets.map((d) => (
            <Badge key={d} className="border-accent/30 bg-accent/10 text-accent">
              {d}
            </Badge>
          ))}
          {settings.allergies.map((a) => (
            <Badge key={a} className="border-danger/30 bg-danger/10 text-danger">
              Allergy: {a}
            </Badge>
          ))}
          {settings.other && <span className="text-muted">{settings.other}</span>}
          {settings.diets.length + settings.allergies.length === 0 && !settings.other && <span className="text-muted">No diet or allergy info yet.</span>}
        </div>
        {settings.adult === null && <p className="text-xs text-muted">This client hasn’t opened their Nutrition tab yet.</p>}
      </section>

      <TargetsCard key={targets?.at ?? "none"} clientId={clientId} targets={targets} minor={minor} onSaved={reload} />

      <section>
        <SectionTitle
          action={
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" aria-label="Earlier week" onClick={() => setOffset((o) => o + 1)}>
                <ChevronLeft size={16} />
              </Button>
              <span className="text-xs text-muted">{format(parseISO(from), "d MMM")} – {format(parseISO(to), "d MMM")}</span>
              <Button size="sm" variant="ghost" aria-label="Later week" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - 1))}>
                <ChevronRight size={16} />
              </Button>
            </div>
          }
        >
          The week
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Days logged" value={`${week.loggedDays} / 7`} tone={week.loggedDays >= 5 ? "accent" : undefined} />
          <Stat label="Avg calories" value={week.loggedDays ? week.avgKcal : "–"} sub={targets ? `target ${targets.kcal}` : "no target"} />
          <Stat label="Avg protein" value={week.loggedDays ? `${week.avgProtein} g` : "–"} sub={targets ? `target ${targets.protein} g` : "no target"} />
          <Stat label="On target" value={targets ? `${week.onTargetDays} / 7` : "–"} sub={targets ? "calories ±10%, protein 90%+" : "set a target"} tone={targets && week.onTargetDays >= 4 ? "accent" : undefined} />
        </div>
      </section>

      <section className="space-y-2">
        {[...week.days].reverse().map((d) => {
          const list = entries.filter((e) => e.day === d.day);
          const t = sumMacros(list);
          const isOpen = open === d.day;
          const dayComments = comments.filter((c) => c.day === d.day);
          return (
            <Card key={d.day} className="overflow-hidden">
              <button type="button" onClick={() => setOpen(isOpen ? null : d.day)} aria-expanded={isOpen} className="flex min-h-14 w-full items-center gap-3 px-4 text-left">
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", d.onTarget ? "bg-success" : d.logged ? "bg-accent/60" : "bg-line")} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold">{d.day === today ? "Today" : format(parseISO(d.day), "EEEE d MMM")}</div>
                  <div className="text-xs text-muted">{d.logged ? `${t.kcal} kcal · P ${Math.round(t.protein)} · C ${Math.round(t.carbs)} · F ${Math.round(t.fat)}` : "Nothing logged"}</div>
                </div>
                {dayComments.length > 0 && <Badge>{dayComments.length} comment{dayComments.length > 1 ? "s" : ""}</Badge>}
                <ChevronDown size={18} className={cn("shrink-0 text-muted transition-transform", isOpen && "rotate-180")} />
              </button>
              {isOpen && (
                <div className="space-y-3 border-t border-line px-4 py-3">
                  {list.length === 0 && <p className="text-sm text-muted">No foods logged for this day.</p>}
                  {list.map((e) => {
                    const warn = dietConflicts(settings, e.contains);
                    return (
                      <div key={e.id} className="text-sm">
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate font-semibold">{e.name}</span>
                          {e.approx && <Badge className="border-pr/30 bg-pr/10 text-pr">approx.</Badge>}
                          <span className="shrink-0 font-bold tabular-nums">{e.kcal} kcal</span>
                        </div>
                        <div className="text-xs text-muted">
                          {e.meal} · {e.amountText || "1 serving"} · P {Math.round(e.protein)} · C {Math.round(e.carbs)} · F {Math.round(e.fat)}
                        </div>
                        {warn.map((w) => (
                          <div key={w} className="mt-1 flex items-start gap-1.5 text-xs font-semibold text-danger">
                            <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  {dayComments.map((c) => (
                    <div key={c.id} className="rounded-xl bg-accent/10 px-3 py-2 text-sm">
                      <div className="text-xs font-bold text-accent">{c.authorName} · {format(parseISO(c.at), "d MMM, h:mm a")}</div>
                      <div className="whitespace-pre-wrap">{c.text}</div>
                    </div>
                  ))}
                  <CommentBox clientId={clientId} day={d.day} onSent={reload} />
                </div>
              )}
            </Card>
          );
        })}
      </section>
    </div>
  );
}

function CommentBox({ clientId, day, onSent }: { clientId: string; day: string; onSent: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    const err = await postComment(clientId, day, text.trim());
    setBusy(false);
    if (err) return setError(err);
    setText("");
    onSent();
  };
  return (
    <div className="space-y-2">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex items-end gap-2">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Comment on this day. Your client is notified." maxLength={500} rows={2} className="min-h-12" />
        <Button onClick={send} disabled={busy || text.trim().length === 0} aria-label="Send comment">
          <Send size={16} />
        </Button>
      </div>
    </div>
  );
}

function TargetsCard({ clientId, targets, minor, onSaved }: { clientId: string; targets: NutritionTargets | null; minor: boolean; onSaved: () => void }) {
  const [kcal, setKcal] = useState<number | undefined>(targets?.kcal);
  const [protein, setProtein] = useState<number | undefined>(targets?.protein);
  const [carbs, setCarbs] = useState<number | undefined>(targets?.carbs);
  const [fat, setFat] = useState<number | undefined>(targets?.fat);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const run = async (input: { kcal: number; protein: number; carbs: number; fat: number } | { clear: true }, ok: string) => {
    setBusy(true);
    setMsg(null);
    const err = await saveTargets(input, clientId);
    setBusy(false);
    if (err) return setMsg({ tone: "error", text: err });
    setMsg({ tone: "success", text: ok });
    onSaved();
  };
  return (
    <section>
      <SectionTitle>Daily targets</SectionTitle>
      <Card className="space-y-3 p-4">
        {minor ? (
          <Notice>This client said they’re under 18, so calorie targets aren’t offered. They can still keep a food diary.</Notice>
        ) : (
          <>
            {targets && <p className="text-xs text-muted">Set by {targets.setBy === "COACH" ? "you" : "the client"}. {targets.setBy === "CLIENT" ? "Saving new targets here replaces theirs." : ""}</p>}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Calories">
                <NumberInput label="Calories per day" min={0} max={6000} step={50} allowEmpty value={kcal} onChange={setKcal} />
              </Field>
              <Field label="Protein g">
                <NumberInput label="Protein per day" min={0} max={500} allowEmpty value={protein} onChange={setProtein} />
              </Field>
              <Field label="Carbs g">
                <NumberInput label="Carbs per day" min={0} max={1000} allowEmpty value={carbs} onChange={setCarbs} />
              </Field>
              <Field label="Fat g">
                <NumberInput label="Fat per day" min={0} max={400} allowEmpty value={fat} onChange={setFat} />
              </Field>
            </div>
            {(protein ?? 0) + (carbs ?? 0) + (fat ?? 0) > 0 && <p className="text-xs text-muted">The macros add up to about {Math.round(atwater({ protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0 }))} kcal. Calories can’t be set below {KCAL_MIN_COACH}.</p>}
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
            <div className="flex gap-2">
              <Button onClick={() => run({ kcal: kcal ?? 0, protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0 }, "Targets saved. Your client has been told.")} disabled={busy || !kcal || !protein}>
                Save targets
              </Button>
              {targets && (
                <Button variant="ghost" onClick={() => run({ clear: true }, "Targets cleared.")} disabled={busy}>
                  Clear
                </Button>
              )}
            </div>
          </>
        )}
      </Card>
    </section>
  );
}
