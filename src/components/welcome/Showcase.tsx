"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/* The loud parts of the welcome page: moving phones, the marquee and the tabbed showcase. Every picture is a real screen from the app with demo data. */

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const SHOTS = {
  home: { src: "/welcome/phone-home.webp", alt: "The CoachFlow home screen: next session, group classes and credits." },
  logger: { src: "/welcome/phone-logger.webp", alt: "The CoachFlow workout logger: sets with last time's weights beside them." },
  progress: { src: "/welcome/phone-progress.webp", alt: "The CoachFlow progress screen: weekly volume, streak and totals." },
  clients: { src: "/welcome/phone-clients.webp", alt: "The CoachFlow clients screen: a coach code and a roster of clients." },
  schedule: { src: "/welcome/phone-schedule.webp", alt: "The CoachFlow schedule screen: sessions waiting for attendance." },
} as const;

type Who = "train" | "coach";
type Shot = keyof typeof SHOTS;

const STACKS: Record<Who, { c: Shot; l: Shot; r: Shot; chips: [string, string, string] }> = {
  train: { c: "logger", l: "progress", r: "home", chips: ["New best on squat", "Coach note: great depth", "Session confirmed"] },
  coach: { c: "clients", l: "schedule", r: "logger", chips: ["Alice logged a workout", "New client request", "Attendance in one tap"] },
};

/** Three phones that float and lean toward the pointer, with chips that pop in around them. */
export function PhoneStack({ who }: { who: Who }) {
  const ref = useRef<HTMLDivElement>(null);
  const s = STACKS[who];
  const move = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || reducedMotion()) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--px", String(((e.clientX - r.left) / r.width - 0.5) * 2));
    el.style.setProperty("--py", String(((e.clientY - r.top) / r.height - 0.5) * 2));
  };
  const leave = () => {
    ref.current?.style.setProperty("--px", "0");
    ref.current?.style.setProperty("--py", "0");
  };
  const phone = (pos: "c" | "l" | "r", shot: Shot, delay: string, priority = false) => (
    <div className="wc-ph" data-pos={pos}>
      <div className="wc-phone" style={{ ["--delay" as string]: delay }}>
        <Image src={SHOTS[shot].src} alt={SHOTS[shot].alt} width={540} height={1170} sizes="(max-width: 860px) 40vw, 260px" priority={priority} />
      </div>
    </div>
  );
  return (
    <div className="wc-stack" ref={ref} onPointerMove={move} onPointerLeave={leave} key={who}>
      {phone("l", s.l, "-2s")}
      {phone("r", s.r, "-4s")}
      {phone("c", s.c, "0s", true)}
      <span className="wc-chip" data-pos="1">
        {s.chips[0]}
      </span>
      <span className="wc-chip" data-pos="2">
        {s.chips[1]}
      </span>
      <span className="wc-chip" data-pos="3">
        {s.chips[2]}
      </span>
    </div>
  );
}

const WORDS = ["Back squat", "Bench press", "Deadlift", "Pull-up", "Overhead press", "Barbell row", "Lunge", "Plank", "Hip thrust", "Dip"];

/** A band of exercise names sliding past. Decorative, so it is hidden from screen readers. */
export function Marquee() {
  const track = [...WORDS, ...WORDS];
  return (
    <div className="wc-marquee" aria-hidden="true">
      <div className="wc-marquee-track">
        {track.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
        {track.map((w, i) => (
          <span key={`b${i}`}>{w}</span>
        ))}
      </div>
    </div>
  );
}

const TABS: { title: string; text: string; shot: Shot }[] = [
  { title: "Log every set", text: "Last time's weights sit beside each set, so you know exactly what to beat.", shot: "logger" },
  { title: "See the climb", text: "Weekly volume, streaks and totals build up as you train.", shot: "progress" },
  { title: "Stay on schedule", text: "Your next session, group classes and credits in one view.", shot: "home" },
  { title: "Run your roster", text: "Every client with their credits and next session. Your coach code is one tap away.", shot: "clients" },
  { title: "Confirm sessions fast", text: "Finished sessions wait for attendance: present or no-show in one tap.", shot: "schedule" },
];

/** Tabs that swap the phone. They advance by themselves until someone picks one. */
export function Showcase() {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto || reducedMotion()) return;
    const id = setInterval(() => setI((n) => (n + 1) % TABS.length), 4500);
    return () => clearInterval(id);
  }, [auto]);
  return (
    <section className="wc-show" aria-labelledby="wc-all">
      <div className="wc-wrap">
        <h2 id="wc-all" className="wc-rv">
          Everything in one place.
        </h2>
        <div className="wc-show-grid">
          <div role="tablist" aria-label="What CoachFlow does" className="wc-tabs">
            {TABS.map((t, n) => (
              <button
                key={t.title}
                type="button"
                role="tab"
                id={`wc-tab-${n}`}
                aria-selected={i === n}
                aria-controls="wc-tabpanel"
                className="wc-tab"
                data-auto={auto}
                onClick={() => {
                  setAuto(false);
                  setI(n);
                }}
              >
                <strong>{t.title}</strong>
                <span>{t.text}</span>
                <i className="wc-bar" />
              </button>
            ))}
          </div>
          <div className="wc-show-phone" id="wc-tabpanel" role="tabpanel" aria-labelledby={`wc-tab-${i}`}>
            <div className="wc-phone">
              {TABS.map((t, n) => (
                <Image key={t.shot} src={SHOTS[t.shot].src} alt={n === i ? SHOTS[t.shot].alt : ""} width={540} height={1170} sizes="330px" data-on={i === n} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The email box, used in the hero and again at the bottom. The address travels to the sign-up form in this tab's session storage, never in the address bar. */
export function StartForm({ signup, id, label }: { signup: string; id: string; label: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  return (
    <form
      className="wc-start"
      onSubmit={(e) => {
        e.preventDefault();
        const v = email.trim();
        try {
          if (v) sessionStorage.setItem("cf_signup_email", v);
        } catch {
          /* private mode: they just type it again */
        }
        router.push(signup);
      }}
    >
      <label htmlFor={id} className="wc-sr">
        Email address
      </label>
      <input id={id} type="email" autoComplete="email" inputMode="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button type="submit" className="wc-btn wc-btn-primary">
        {label}
      </button>
    </form>
  );
}
