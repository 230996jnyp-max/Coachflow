"use client";

import { useState } from "react";

/* Hands-on samples for coaches. Browser only: invented names and numbers, nothing is sent or saved. */

const PEOPLE = ["Dana", "Marcus", "Priya", "Lee", "Sam"];
const SPOTS = 3;

/** A class with three spots: extra clients wait in order, and a cancellation promotes the first in line. */
export function WaitlistDemo() {
  const [booked, setBooked] = useState<string[]>(["Dana", "Marcus"]);
  const [wait, setWait] = useState<string[]>([]);
  const [promoted, setPromoted] = useState<string | null>(null);
  const next = PEOPLE.find((p) => !booked.includes(p) && !wait.includes(p));
  const add = () => {
    setPromoted(null);
    if (!next) {
      setBooked(["Dana", "Marcus"]);
      setWait([]);
      return;
    }
    if (booked.length < SPOTS) setBooked((b) => [...b, next]);
    else setWait((w) => [...w, next]);
  };
  const cancel = () => {
    if (booked.length === 0) return;
    const [, ...rest] = booked;
    if (wait.length > 0) {
      setBooked([...rest, wait[0]]);
      setPromoted(wait[0]);
      setWait(wait.slice(1));
    } else {
      setBooked(rest);
      setPromoted(null);
    }
  };
  return (
    <div>
      <div className="wc-class-head">
        <span>Athletic S&amp;C group</span>
        <span className="wc-fig">
          {booked.length} / {SPOTS} booked{wait.length > 0 ? `, ${wait.length} waitlisted` : ""}
        </span>
      </div>
      <ul className="wc-rows" aria-live="polite">
        {booked.map((p) => (
          <li key={p}>
            <span>{p}</span>
            <span className="wc-fig">Booked</span>
          </li>
        ))}
        {wait.map((p, i) => (
          <li key={p}>
            <span>{p}</span>
            <span className="wc-fig">Waitlist #{i + 1}</span>
          </li>
        ))}
      </ul>
      {promoted && <div className="wc-joined">{promoted} moved up from the waitlist and was told.</div>}
      <div className="wc-stepper">
        <button type="button" className="wc-btn wc-btn-primary wc-btn-small" onClick={add}>
          {next ? `Add ${next}` : "Start again"}
        </button>
        <button type="button" className="wc-btn wc-btn-ghost wc-btn-small" onClick={cancel} disabled={booked.length === 0}>
          Someone cancels
        </button>
      </div>
    </div>
  );
}

/** Plain rules, no AI: a very hard run of sessions suggests a deload, an easy run suggests a small step up. */
export function DeloadDemo() {
  const [hard, setHard] = useState<boolean[]>([false, true, true]);
  const [applied, setApplied] = useState(false);
  const current = 82.5;
  const hardCount = hard.filter(Boolean).length;
  const deload = hardCount >= 2;
  const easy = hardCount === 0;
  const target = deload ? Math.round((current * 0.9) / 2.5) * 2.5 : easy ? current + 2.5 : current;
  return (
    <div>
      <div className="wc-chips">
        {hard.map((h, i) => (
          <button
            key={i}
            type="button"
            className="wc-day"
            aria-pressed={h}
            onClick={() => {
              setApplied(false);
              setHard((x) => x.map((v, n) => (n === i ? !v : v)));
            }}
          >
            Session {i + 1}: {h ? "RPE 9.5" : "RPE 8"}
          </button>
        ))}
      </div>
      <div className={deload ? "wc-suggest wc-suggest-warn" : "wc-suggest"} aria-live="polite">
        {deload ? (
          <>
            <strong>Deload suggested</strong> {current} kg to {target} kg (-10%)
          </>
        ) : easy ? (
          <>
            <strong>Suggested today</strong> {current} kg to {target} kg
          </>
        ) : (
          <>
            <strong>Suggested today</strong> stay at {current} kg
          </>
        )}
      </div>
      {deload && (
        <button type="button" className="wc-btn wc-btn-ghost wc-btn-small" onClick={() => setApplied(true)}>
          Apply
        </button>
      )}
      {applied && <div className="wc-joined">Next session is set to {target} kg.</div>}
      <p className="wc-footnote">Tap a session to change how hard it felt.</p>
    </div>
  );
}

const EXPORT_TEXT = "Push day\nBench press - 4 x 8 @ 60kg\nShoulder press - 3 x 10 @ 20kg\nTriceps pushdown - 3 x 12 @ 25kg";

/** Export a workout as a PDF or as plain text that imports straight back in. */
export function ExportDemo() {
  const [kind, setKind] = useState<"pdf" | "text">("pdf");
  return (
    <div>
      <div className="wc-chips">
        <button type="button" className="wc-day" aria-pressed={kind === "pdf"} onClick={() => setKind("pdf")}>
          PDF
        </button>
        <button type="button" className="wc-day" aria-pressed={kind === "text"} onClick={() => setKind("text")}>
          Plain text
        </button>
      </div>
      {kind === "pdf" ? (
        <div className="wc-paper" role="img" aria-label="A sample exported workout page: Push day with three exercises">
          <div className="wc-paper-head">CoachFlow</div>
          <div className="wc-paper-title">Push day</div>
          <ul>
            <li>
              <span>Bench press</span>
              <span>4 x 8 @ 60 kg</span>
            </li>
            <li>
              <span>Shoulder press</span>
              <span>3 x 10 @ 20 kg</span>
            </li>
            <li>
              <span>Triceps pushdown</span>
              <span>3 x 12 @ 25 kg</span>
            </li>
          </ul>
        </div>
      ) : (
        <pre className="wc-notes wc-pre">{EXPORT_TEXT}</pre>
      )}
      <p className="wc-footnote">Text exports paste straight back into import.</p>
    </div>
  );
}
