"use client";

import { useEffect, useState } from "react";

/* Hands-on samples for the newer features. Browser only: invented names and numbers, nothing is sent or saved. */

/** Type a goal, get a multi-week program that leaves out what a sore joint can't do. Progression is by rules, with a lighter week every fourth. */
export function ProgramBuilderDemo() {
  const [weeks, setWeeks] = useState(8);
  const [days, setDays] = useState(3);
  const [shoulder, setShoulder] = useState(true);
  const press = shoulder ? "Incline dumbbell press" : "Overhead press";
  const lines = [
    `${press} 3 x 10`,
    "Chest-supported row 3 x 10",
    "Cable fly 2 x 12",
    "Hammer curl 2 x 12",
  ];
  const bars = Array.from({ length: weeks }, (_, i) => {
    const deload = (i + 1) % 4 === 0;
    const build = 1 + Math.floor(i / 4) * 0.06 + (i % 4) * 0.02;
    return { deload, h: Math.round((deload ? 0.7 : build) * 70) };
  });
  return (
    <div>
      <div className="wc-chips" role="group" aria-label="Weeks">
        {[4, 8, 12].map((w) => (
          <button key={w} type="button" className="wc-day" aria-pressed={weeks === w} onClick={() => setWeeks(w)}>
            {w} weeks
          </button>
        ))}
      </div>
      <div className="wc-chips" role="group" aria-label="Days a week">
        {[3, 4].map((d) => (
          <button key={d} type="button" className="wc-day" aria-pressed={days === d} onClick={() => setDays(d)}>
            {d} days a week
          </button>
        ))}
        <button type="button" className="wc-day" aria-pressed={shoulder} onClick={() => setShoulder((s) => !s)}>
          Sore left shoulder
        </button>
      </div>
      <div className="wc-suggest" aria-live="polite">
        <strong>
          Week 1, day 1: Upper ({days} days a week)
        </strong>
        {lines.map((l) => (
          <div key={l}>{l}</div>
        ))}
        {shoulder && <div className="wc-footnote">Left out for the shoulder: overhead press.</div>}
      </div>
      <div className="wc-weeks" role="img" aria-label={`${weeks} weeks of load: it builds, with a lighter week every fourth`}>
        {bars.map((b, i) => (
          <i key={i} data-deload={b.deload || undefined} style={{ height: `${b.h}%` }} />
        ))}
      </div>
      <p className="wc-footnote">Reps first, then weight, and a lighter week every fourth. Nothing reaches a client until you press Assign.</p>
    </div>
  );
}

const RULES: { label: string; auto: boolean; why: string; text: string }[] = [
  { label: "A new client joins", auto: true, why: "Bella became your client.", text: "Hi Bella, welcome! Here are two short forms to fill in before we meet." },
  { label: "Missed 2 workouts", auto: false, why: "Bella missed 2 assigned workouts.", text: "Hi Bella, two sessions slipped this week. Everything okay?" },
  { label: "1 session left", auto: false, why: "Bella has 1 session left.", text: "Hi Bella, you have 1 session left. Here's a link to renew by PayNow." },
];

/** Rules a coach switches on. Welcome messages go by themselves; nudges wait as drafts the coach reads first. */
export function AutopilotDemo() {
  const [i, setI] = useState(0);
  const [done, setDone] = useState<"sent" | "dismissed" | null>(null);
  const r = RULES[i];
  return (
    <div>
      <div className="wc-chips" role="group" aria-label="When this happens">
        {RULES.map((x, n) => (
          <button
            key={x.label}
            type="button"
            className="wc-day"
            aria-pressed={n === i}
            onClick={() => {
              setI(n);
              setDone(null);
            }}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div className="wc-suggest" aria-live="polite">
        <strong>
          {r.why} <span className="wc-fig">{r.auto ? "Automatic" : "Draft"}</span>
        </strong>
        <div>{r.text}</div>
        {r.auto ? (
          <div className="wc-joined">Sent at once, with the forms.</div>
        ) : done ? (
          <div className="wc-joined">{done === "sent" ? "Sent to Bella, in the chat as from you." : "Dismissed. Nothing was sent."}</div>
        ) : (
          <div className="wc-stepper">
            <button type="button" className="wc-btn wc-btn-primary wc-btn-small" onClick={() => setDone("sent")}>
              Send
            </button>
            <button type="button" className="wc-btn wc-btn-ghost wc-btn-small" onClick={() => setDone("dismissed")}>
              Dismiss
            </button>
          </div>
        )}
      </div>
      <p className="wc-footnote">Nothing goes out between 9 pm and 8 am, and no client gets more than 2 automatic messages a day.</p>
    </div>
  );
}

const PACKS = [
  { sessions: 5, price: 400 },
  { sessions: 10, price: 750 },
];

/** PayNow straight to the coach: the client sees the number, the amount and a reference, taps "I have sent it", the coach confirms and the credits load. */
export function PayNowDemo() {
  const [pack, setPack] = useState(1);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const p = PACKS[pack];
  return (
    <div>
      <div className="wc-chips" role="group" aria-label="Package">
        {PACKS.map((x, n) => (
          <button
            key={x.sessions}
            type="button"
            className="wc-day"
            aria-pressed={n === pack}
            onClick={() => {
              setPack(n);
              setStep(0);
            }}
          >
            {x.sessions} sessions
          </button>
        ))}
      </div>
      <div className="wc-suggest" aria-live="polite">
        <strong>
          Pay S${p.price} by PayNow <span className="wc-fig">Ref CF-7K2M4Q</span>
        </strong>
        <div>Send it from your bank app to 9123 4567, with that reference.</div>
        {step === 0 && (
          <div className="wc-stepper">
            <button type="button" className="wc-btn wc-btn-primary wc-btn-small" onClick={() => setStep(1)}>
              Client: I have sent it
            </button>
          </div>
        )}
        {step === 1 && (
          <div className="wc-stepper">
            <button type="button" className="wc-btn wc-btn-primary wc-btn-small" onClick={() => setStep(2)}>
              Coach: confirm it arrived
            </button>
          </div>
        )}
        {step === 2 && <div className="wc-joined">Confirmed. {p.sessions} credits added: 12 sessions left.</div>}
      </div>
      <p className="wc-footnote">PayNow and cash have no fees. Card payments are coming.</p>
    </div>
  );
}

const LANES = [
  { name: "Alice", lift: "Back squat", kg: 62.5 },
  { name: "Ben", lift: "Deadlift", kg: 80 },
];

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** One tablet, two clients: weights are pre-filled, you tap to log, a rest timer runs, and ending the session marks attendance. */
export function FloorDemo() {
  const [sets, setSets] = useState<number[]>([0, 0]);
  const [rest, setRest] = useState(0);
  const [ended, setEnded] = useState(false);
  const resting = rest > 0;
  useEffect(() => {
    if (!resting) return;
    const id = setInterval(() => setRest((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [resting]);
  const any = sets.some((n) => n > 0);
  return (
    <div>
      <ul className="wc-rows wc-lanes">
        {LANES.map((l, n) => (
          <li key={l.name}>
            <span>
              <strong>{l.name}</strong> <small>{l.lift}, {l.kg} kg</small>
            </span>
            <span className="wc-fig">{sets[n]} sets</span>
            <button
              type="button"
              className="wc-btn wc-btn-primary wc-btn-small"
              disabled={ended}
              onClick={() => {
                setSets((s) => s.map((v, i) => (i === n ? v + 1 : v)));
                setRest(90);
              }}
            >
              Log set
            </button>
          </li>
        ))}
      </ul>
      <div className="wc-suggest" aria-live="polite">
        {rest > 0 ? (
          <>
            <strong>Rest</strong> <span className="wc-fig">{mmss(rest)}</span>
          </>
        ) : (
          <strong>Rest timer: starts when you log a set</strong>
        )}
      </div>
      {ended ? (
        <div className="wc-joined">Attendance marked and 1 credit used for each client.</div>
      ) : (
        <button type="button" className="wc-btn wc-btn-ghost wc-btn-small" disabled={!any} onClick={() => setEnded(true)}>
          End session
        </button>
      )}
    </div>
  );
}

const PLAN: Record<number, string[]> = {
  2: ["Mon: Full body A", "Thu: Full body B"],
  3: ["Mon: Full body A", "Wed: Full body B", "Fri: Full body A"],
  4: ["Mon: Upper", "Tue: Lower", "Thu: Upper", "Fri: Lower"],
};

/** The AI personal trainer: a health check shapes the plan, and the plan can grow into a longer program. */
export function AiTrainerLive() {
  const [days, setDays] = useState(3);
  const [flag, setFlag] = useState(false);
  const [weeks, setWeeks] = useState(8);
  return (
    <div>
      <div className="wc-chips" role="group" aria-label="Days a week">
        {[2, 3, 4].map((d) => (
          <button key={d} type="button" className="wc-day" aria-pressed={days === d} onClick={() => setDays(d)}>
            {d} days
          </button>
        ))}
      </div>
      <div className="wc-chips" role="group" aria-label="Health check">
        <button type="button" className="wc-day" aria-pressed={!flag} onClick={() => setFlag(false)}>
          Nothing to flag
        </button>
        <button type="button" className="wc-day" aria-pressed={flag} onClick={() => setFlag(true)}>
          Something to flag
        </button>
      </div>
      <ul className="wc-rows" aria-live="polite">
        {PLAN[days].map((r) => (
          <li key={r}>
            <span>{r}</span>
            <span className="wc-fig">{flag ? "Gentle" : "Standard"}</span>
          </li>
        ))}
      </ul>
      {flag && <div className="wc-suggest wc-suggest-warn">Gentle plan: no jumping, no heavy or maximum lifts, and unsafe drills stay out.</div>}
      <div className="wc-chips" role="group" aria-label="Program length" style={{ marginTop: 12 }}>
        {[4, 8, 12].map((w) => (
          <button key={w} type="button" className="wc-day" aria-pressed={weeks === w} onClick={() => setWeeks(w)}>
            {w}-week program
          </button>
        ))}
      </div>
      <p className="wc-footnote">It builds on what you log, with a lighter week every fourth. General fitness guidance, not medical advice.</p>
    </div>
  );
}

const BADGES: { name: string; ok: (w: number, kg: number) => boolean }[] = [
  { name: "First workout", ok: (w) => w >= 1 },
  { name: "10 workouts", ok: (w) => w >= 10 },
  { name: "50 workouts", ok: (w) => w >= 50 },
  { name: "100 workouts", ok: (w) => w >= 100 },
  { name: "1,000 kg lifted", ok: (_w, kg) => kg >= 1000 },
  { name: "10,000 kg lifted", ok: (_w, kg) => kg >= 10000 },
];

/** Badges that light up as workouts are finished, with a picture to share. */
export function BadgesDemo() {
  const [w, setW] = useState(0);
  const [shared, setShared] = useState(false);
  const kg = w * 600;
  const earned = BADGES.filter((b) => b.ok(w, kg));
  return (
    <div>
      <div className="wc-stepper">
        <button type="button" className="wc-btn wc-btn-primary wc-btn-small" onClick={() => { setW((n) => n + 1); setShared(false); }}>
          Finish a workout
        </button>
        <button type="button" className="wc-btn wc-btn-ghost wc-btn-small" onClick={() => { setW((n) => n + 10); setShared(false); }}>
          10 more
        </button>
        <span className="wc-fig">{w} workouts</span>
      </div>
      <ul className="wc-badges" aria-live="polite">
        {BADGES.map((b) => (
          <li key={b.name} data-on={b.ok(w, kg) || undefined}>
            {b.name}
          </li>
        ))}
      </ul>
      {earned.length > 0 && (
        <button type="button" className="wc-btn wc-btn-ghost wc-btn-small" onClick={() => setShared(true)}>
          Share a picture
        </button>
      )}
      {shared && <div className="wc-joined">Your phone&apos;s share sheet opens here.</div>}
      <p className="wc-footnote">Nine badges in all, including streaks and your first personal best.</p>
    </div>
  );
}

/** Invite a friend: they start with 60 days free, and each one adds 30 days to your free time (up to six). */
export function InviteDemo() {
  const [n, setN] = useState(0);
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="wc-stepper">
        <button type="button" className="wc-btn wc-btn-primary wc-btn-small" onClick={() => setCopied(true)}>
          Copy my invite link
        </button>
        <button type="button" className="wc-btn wc-btn-ghost wc-btn-small" disabled={n >= 6} onClick={() => setN((v) => Math.min(6, v + 1))}>
          A friend joins
        </button>
      </div>
      {copied && <div className="wc-joined">Link copied. This one is a sample.</div>}
      <ul className="wc-rows" aria-live="polite">
        <li>
          <span>Friends who joined</span>
          <span className="wc-fig">{n} of 6</span>
        </li>
        <li>
          <span>Your free time</span>
          <span className="wc-fig">{30 + 30 * n} days</span>
        </li>
        <li>
          <span>Each friend starts with</span>
          <span className="wc-fig">60 days free</span>
        </li>
      </ul>
    </div>
  );
}
