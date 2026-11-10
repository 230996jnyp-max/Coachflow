"use client";

import { useEffect, useRef, useState } from "react";

/*
 * The product, shown. Everything here is a labelled sample: invented names and numbers that never claim to be real users or results.
 */

const SLOTS: Record<string, { t: string; taken?: boolean }[]> = {
  Thu: [{ t: "7:00" }, { t: "8:00", taken: true }, { t: "9:30" }, { t: "12:00" }, { t: "5:30", taken: true }],
  Fri: [{ t: "7:00", taken: true }, { t: "8:30" }, { t: "10:00" }, { t: "4:00" }],
  Sat: [{ t: "9:00" }, { t: "10:30" }, { t: "11:30", taken: true }],
};

/** Pick a day and a time; the coach's side answers in one tap. */
export function BookingDemo() {
  const [day, setDay] = useState("Thu");
  const [slot, setSlot] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const pick = (d: string) => {
    setDay(d);
    setSlot(null);
    setAccepted(false);
  };
  return (
    <div className="wc-panel" style={{ minHeight: 0 }} aria-label="Sample booking">
      <div className="wc-panel-head">
        <span>Book a session</span>
        <span className="wc-sample">Sample</span>
      </div>
      <div className="wc-days">
        {Object.keys(SLOTS).map((d) => (
          <button key={d} type="button" className="wc-day" aria-pressed={day === d} onClick={() => pick(d)}>
            {d}
          </button>
        ))}
      </div>
      <div className="wc-slots">
        {SLOTS[day].map((s) => (
          <button
            key={s.t}
            type="button"
            className="wc-slot"
            disabled={s.taken}
            aria-pressed={slot === s.t}
            onClick={() => {
              setSlot(s.t);
              setAccepted(false);
            }}
          >
            {s.t}
            {s.taken ? " taken" : ""}
          </button>
        ))}
      </div>
      <div className="wc-confirm" aria-live="polite">
        {!slot && "Choose a time to send your request."}
        {slot && !accepted && (
          <>
            <strong>
              {day} {slot}
            </strong>{" "}
            requested. Coach view:{" "}
            <button type="button" className="wc-btn wc-btn-primary wc-btn-small" onClick={() => setAccepted(true)}>
              Accept
            </button>
          </>
        )}
        {slot && accepted && (
          <>
            <strong>
              {day} {slot}
            </strong>{" "}
            is confirmed. Both of you get a reminder.
          </>
        )}
      </div>
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
    <div className="wc-panel" style={{ minHeight: 0 }} aria-label="Sample coach code">
      <div className="wc-panel-head">
        <span>Join a coach</span>
        <span className="wc-sample">Sample</span>
      </div>
      <div className="wc-code">
        <input
          inputMode="numeric"
          autoComplete="off"
          aria-label="Six digit coach code"
          placeholder="482915"
          value={code}
          onChange={(e) => change(e.target.value)}
        />
      </div>
      <div className="wc-confirm" aria-live="polite">
        {state === "idle" && "Type any six digits to see what happens."}
        {state === "sent" && "Request sent. Nothing is shared until the coach accepts."}
        {state === "joined" && <div className="wc-joined">Coach Sam accepted you. Book sessions and chat from here.</div>}
      </div>
    </div>
  );
}

const WEEKS = [60, 62.5, 65, 65, 70, 72.5, 75, 80];

/** The progress line draws itself once, when it scrolls into view. */
export function ProgressChart() {
  const ref = useRef<SVGSVGElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let done = false;
    const show = () => {
      if (done) return;
      done = true;
      setInView(true);
      io.disconnect();
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
    // Belt and braces: the observer is the normal route; the position check covers browsers or panes that throttle it.
    const check = () => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.85 && r.bottom > 0) show();
    };
    const io = new IntersectionObserver(([e]) => e.isIntersecting && show(), { threshold: 0.4 });
    io.observe(el);
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    const first = setTimeout(check, 250);
    return () => {
      done = true;
      clearTimeout(first);
      io.disconnect();
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  const W = 560;
  const H = 260;
  const pad = { l: 40, r: 16, t: 20, b: 34 };
  const min = 55;
  const max = 85;
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / (WEEKS.length - 1);
  const y = (v: number) => pad.t + ((max - v) * (H - pad.t - pad.b)) / (max - min);
  const d = WEEKS.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const last = WEEKS.length - 1;
  return (
    <div className="wc-panel" style={{ minHeight: 0 }}>
      <div className="wc-panel-head">
        <span>Back squat, best set each week (kg)</span>
        <span className="wc-sample">Sample data</span>
      </div>
      <svg ref={ref} className="wc-chart" viewBox={`0 0 ${W} ${H}`} data-in={inView} role="img" aria-label="A sample line chart: a squat rising from 60 to 80 kilograms over 8 weeks">
        {[60, 70, 80].map((v) => (
          <g key={v}>
            <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {WEEKS.map((_, i) => (
          <text key={i} x={x(i)} y={H - 10} textAnchor="middle">
            {i + 1}
          </text>
        ))}
        <path className="line" d={d} pathLength={1} />
        <circle className="dot" cx={x(last)} cy={y(WEEKS[last])} r={7} />
      </svg>
      <div className="wc-sample" style={{ textAlign: "center" }}>
        Week
      </div>
    </div>
  );
}
