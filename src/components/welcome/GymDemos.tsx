"use client";

import { useState } from "react";

/* Hands-on samples for a gym owner. Browser only: invented names and numbers, nothing is sent or saved. */

const ROLES: { name: string; text: string }[] = [
  { name: "Owner", text: "Everything, and it can't be taken away." },
  { name: "Manager", text: "You choose: for example the schedule, the team and hours." },
  { name: "Receptionist", text: "For example only the master schedule and bookings." },
  { name: "Coach", text: "Their own clients and their own schedule." },
];

/** The gym's team: a six-digit code coaches join with, a request the owner approves, and roles the owner designs. */
export function GymTeamDemo() {
  const [team, setTeam] = useState<{ name: string; role: string }[]>([
    { name: "Sam Wong", role: "Manager" },
    { name: "Dana Koh", role: "Coach" },
  ]);
  const [asking, setAsking] = useState<string | null>("Jordan Lim");
  const [note, setNote] = useState<string | null>(null);
  const [role, setRole] = useState(1);
  return (
    <div>
      <div className="wc-class-head">
        <span>Your gym code</span>
        <span className="wc-fig">482 915</span>
      </div>
      <ul className="wc-rows" aria-live="polite">
        {team.map((p) => (
          <li key={p.name}>
            <span>{p.name}</span>
            <span className="wc-fig">{p.role}</span>
          </li>
        ))}
      </ul>
      {asking ? (
        <div className="wc-suggest" aria-live="polite">
          <strong>{asking} wants to join as a coach</strong>
          <div className="wc-stepper">
            <button
              type="button"
              className="wc-btn wc-btn-primary wc-btn-small"
              onClick={() => {
                setTeam((t) => [...t, { name: asking, role: "Coach" }]);
                setNote(`${asking} joined and was told.`);
                setAsking(null);
              }}
            >
              Approve
            </button>
            <button
              type="button"
              className="wc-btn wc-btn-ghost wc-btn-small"
              onClick={() => {
                setNote(`${asking} was told the gym isn't taking coaches right now.`);
                setAsking(null);
              }}
            >
              Not now
            </button>
          </div>
        </div>
      ) : (
        <div className="wc-joined" role="status">
          {note ?? "No requests waiting."}
        </div>
      )}
      <div className="wc-chips" role="group" aria-label="Roles you design" style={{ marginTop: 14 }}>
        {ROLES.map((r, n) => (
          <button key={r.name} type="button" className="wc-day" aria-pressed={n === role} onClick={() => setRole(n)}>
            {r.name}
          </button>
        ))}
      </div>
      <p className="wc-footnote" aria-live="polite">
        {ROLES[role].text} You design the roles; these are examples.
      </p>
    </div>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const BANDS = ["Morning", "Lunch", "Evening"];
const FILL: Record<"this" | "last", number[][]> = {
  this: [
    [62, 38, 91],
    [58, 41, 94],
    [64, 35, 88],
    [60, 44, 92],
    [55, 40, 83],
    [88, 47, 52],
    [71, 30, 36],
  ],
  last: [
    [55, 33, 82],
    [52, 39, 85],
    [60, 30, 80],
    [57, 38, 86],
    [49, 36, 75],
    [81, 42, 47],
    [66, 28, 31],
  ],
};
const TOTALS = { this: { fill: 78, waitlist: 11, cancels: 6 }, last: { fill: 71, waitlist: 7, cancels: 9 } };

/** The gym's numbers: fill, waitlist and cancellations for a month, and a busy-times heat map you can tap. */
export function GymNumbersDemo() {
  const [period, setPeriod] = useState<"this" | "last">("this");
  const [cell, setCell] = useState<[number, number]>([1, 2]);
  const t = TOTALS[period];
  const pct = FILL[period][cell[0]][cell[1]];
  const waiting = pct >= 90 ? 4 : pct >= 80 ? 2 : 0;
  return (
    <div>
      <div className="wc-chips" role="group" aria-label="Month">
        <button type="button" className="wc-day" aria-pressed={period === "this"} onClick={() => setPeriod("this")}>
          This month
        </button>
        <button type="button" className="wc-day" aria-pressed={period === "last"} onClick={() => setPeriod("last")}>
          Last month
        </button>
      </div>
      <div className="wc-tiles">
        <div>
          <b className="wc-fig">{t.fill}%</b>
          <small>classes full</small>
        </div>
        <div>
          <b className="wc-fig">{t.waitlist}</b>
          <small>on waitlists</small>
        </div>
        <div>
          <b className="wc-fig">{t.cancels}</b>
          <small>cancellations</small>
        </div>
      </div>
      <div className="wc-heat" role="group" aria-label="Busy times. Tap a square.">
        <div className="wc-heat-row">
          <span />
          {BANDS.map((b) => (
            <span key={b}>{b}</span>
          ))}
        </div>
        {DAYS.map((d, di) => (
          <div key={d} className="wc-heat-row">
            <span>{d}</span>
            {BANDS.map((b, bi) => {
              const v = FILL[period][di][bi];
              const on = cell[0] === di && cell[1] === bi;
              return (
                <button
                  key={b}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${d} ${b.toLowerCase()}: ${v}% full`}
                  style={{ background: `color-mix(in srgb, var(--wc-accent) ${Math.round(v * 0.6)}%, transparent)` }}
                  onClick={() => setCell([di, bi])}
                >
                  {v}%
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="wc-joined" aria-live="polite">
        {DAYS[cell[0]]} {BANDS[cell[1]].toLowerCase()}: {pct}% full{waiting > 0 ? `, ${waiting} on the waitlist` : ""}.
      </div>
    </div>
  );
}

const COACHES = [
  { name: "Dana K.", sessions: 62, attendance: 94, retention: 81 },
  { name: "Marcus L.", sessions: 48, attendance: 89, retention: 88 },
  { name: "Priya S.", sessions: 55, attendance: 91, retention: 76 },
  { name: "Lee T.", sessions: 39, attendance: 96, retention: 84 },
];

/** How each coach is doing, in counts only: sessions, attendance and how many clients are still around after 3 months. */
export function CoachPerformanceDemo() {
  const [by, setBy] = useState<"sessions" | "attendance" | "retention">("sessions");
  const rows = [...COACHES].sort((a, b) => b[by] - a[by]);
  return (
    <div>
      <div className="wc-chips" role="group" aria-label="Sort by">
        {(["sessions", "attendance", "retention"] as const).map((k) => (
          <button key={k} type="button" className="wc-day" aria-pressed={by === k} onClick={() => setBy(k)}>
            {k === "sessions" ? "Sessions" : k === "attendance" ? "Attendance" : "Kept at 3 months"}
          </button>
        ))}
      </div>
      <ul className="wc-rows wc-perf" aria-live="polite">
        <li className="wc-perf-head" aria-hidden="true">
          <span>Coach</span>
          <span>Sessions</span>
          <span>Attended</span>
          <span>Kept</span>
        </li>
        {rows.map((c) => (
          <li key={c.name}>
            <span>{c.name}</span>
            <span className="wc-fig">{c.sessions}</span>
            <span className="wc-fig">{c.attendance}%</span>
            <span className="wc-fig">{c.retention}%</span>
          </li>
        ))}
      </ul>
      <p className="wc-footnote">Counts only: never a chat, a note or a health form. Each coach sees just their own row.</p>
    </div>
  );
}

const STEPS: { title: string; text: string }[] = [
  { title: "Create your gym", text: "Choose Gym when you sign up. You get a six-digit gym code and your first 30 days free." },
  { title: "Coaches join with your code", text: "They type it in, you approve them, and from then on you see their schedule and hours." },
  { title: "Know your numbers", text: "Classes full, busy times, waitlists, and how each coach is doing, in one place." },
];

/** Three plain steps for a gym owner, where a coach or a solo trainer sees the phone showcase. */
export function GymSteps() {
  return (
    <section className="wc-show" aria-labelledby="wc-all">
      <div className="wc-wrap">
        <h2 id="wc-all" className="wc-rv">
          Set up in an afternoon.
        </h2>
        <ol className="wc-steps">
          {STEPS.map((s, n) => (
            <li key={s.title}>
              <b className="wc-fig">{n + 1}</b>
              <strong>{s.title}</strong>
              <span>{s.text}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
