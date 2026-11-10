"use client";

import { useEffect, useRef, useState } from "react";

/*
 * Hands-on samples for the welcome page. Everything here runs in the browser only: invented names and numbers, nothing is sent or saved.
 */

/** Both sides of one app: log a set as the client and the coach sees it; send a note as the coach and the client sees it. */
export function LinkedDemo() {
  const weights = [80, 82.5, 85, 87.5];
  const [sets, setSets] = useState<number[]>([80]);
  const [note, setNote] = useState(false);
  return (
    <div className="wc-linked">
      <div className="wc-col">
        <div className="wc-col-head">You</div>
        <ul className="wc-rows">
          {sets.map((w, i) => (
            <li key={`${i}-${w}`}>
              <span>Set {i + 1}</span>
              <span className="wc-fig">{w} kg x 5</span>
            </li>
          ))}
        </ul>
        {note && <div className="wc-note">Coach: great depth. Add 2.5 kg Thursday.</div>}
        <button type="button" className="wc-btn wc-btn-primary wc-btn-small" onClick={() => setSets((s) => (s.length >= weights.length ? [weights[0]] : [...s, weights[s.length]]))}>
          Log a set
        </button>
      </div>
      <div className="wc-col">
        <div className="wc-col-head">Your coach</div>
        <ul className="wc-rows">
          {sets.map((w, i) => (
            <li key={`c${i}-${w}`}>
              <span>
                <span className="wc-person">Dana</span> logged squat
              </span>
              <span className="wc-fig">{w} kg</span>
            </li>
          ))}
        </ul>
        <button type="button" className="wc-btn wc-btn-ghost wc-btn-small" onClick={() => setNote(true)}>
          Send a note
        </button>
      </div>
    </div>
  );
}

const fmt = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
};

/** Travel time between gyms moves the next bookable slot. */
export function TravelDemo() {
  const [travel, setTravel] = useState(25);
  const end = 10 * 60;
  const earliest = Math.ceil((end + travel) / 15) * 15;
  const scale = 180;
  return (
    <div>
      <div className="wc-tl" role="img" aria-label={`A session at Gym A ends at 10:00, then ${travel} minutes of travel, then the next booking can start at ${fmt(earliest)}.`}>
        <div className="wc-tl-seg" data-kind="session" style={{ flex: `0 0 ${(60 / scale) * 100}%` }}>
          Gym A
        </div>
        <div className="wc-tl-seg" data-kind="travel" style={{ flex: `0 0 ${(travel / scale) * 100}%` }}>
          {travel >= 15 ? "Travel" : ""}
        </div>
        <div className="wc-tl-seg" data-kind="open" style={{ flex: "1 1 0" }}>
          Open
        </div>
      </div>
      <div className="wc-tl-axis">
        <span>9:00</span>
        <span>10:00</span>
        <span>11:00</span>
        <span>12:00</span>
      </div>
      <label className="wc-range">
        <span>Travel to Gym B: {travel} min</span>
        <input type="range" min={10} max={60} step={5} value={travel} onChange={(e) => setTravel(Number(e.target.value))} />
      </label>
      <div className="wc-confirm" aria-live="polite">
        Clients can book Gym B from <strong>{fmt(earliest)}</strong>.
      </div>
    </div>
  );
}

const SAMPLE = "Squat 5x5 80kg\nBench press 4x8 60kg\nBarbell row 3x10 50kg";
const LINE = /^(.+?)\s+(\d+)\s*[x×]\s*(\d+)\s*(?:@\s*)?(\d+(?:\.\d+)?)\s*kg\b/i;

/** Paste notes, get a logged workout. A tiny sample parser stands in for the real import. */
export function ImportDemo() {
  const [text, setText] = useState(SAMPLE);
  const [rows, setRows] = useState<{ name: string; sets: string; reps: string; kg: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    const out = text
      .split("\n")
      .map((l) => LINE.exec(l.trim()))
      .filter((m): m is RegExpExecArray => !!m)
      .slice(0, 8)
      .map((m) => ({ name: m[1].trim(), sets: m[2], reps: m[3], kg: m[4] }));
    if (out.length === 0) {
      setRows([]);
      setError("Add a line like Squat 5x5 80kg.");
      return;
    }
    setError(null);
    setRows(out);
  };
  return (
    <div>
      <label htmlFor="wc-notes" className="wc-sr">
        Workout notes
      </label>
      <textarea id="wc-notes" className="wc-notes" rows={3} value={text} onChange={(e) => (setText(e.target.value), setError(null))} />
      <button type="button" className="wc-btn wc-btn-primary wc-btn-small" onClick={run}>
        Import
      </button>
      {error && (
        <p className="wc-err" role="alert">
          {error}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="wc-rows" aria-live="polite">
          {rows.map((r, i) => (
            <li key={`${i}-${r.name}-${r.kg}`} style={{ animationDelay: `${i * 90}ms` }}>
              <span>{r.name}</span>
              <span className="wc-fig">
                {r.sets} x {r.reps} @ {r.kg} kg
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Six digits to join a coach. Any six digits work in this sample. */
export function CodeDemo() {
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "sent" | "joined">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const change = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (timer.current) clearTimeout(timer.current);
    if (digits.length === 6) {
      setState("sent");
      timer.current = setTimeout(() => setState("joined"), 1400);
    } else setState("idle");
  };
  return (
    <div>
      <div className="wc-code">
        <input inputMode="numeric" autoComplete="off" aria-label="Six digit coach code" placeholder="482915" value={code} onChange={(e) => change(e.target.value)} />
      </div>
      <div className="wc-confirm" aria-live="polite">
        {state === "idle" && "Type any six digits to see what happens."}
        {state === "sent" && "Request sent. Nothing is shared until the coach accepts."}
        {state === "joined" && <div className="wc-joined">Coach Sam accepted you. Book sessions and chat from here.</div>}
      </div>
    </div>
  );
}
