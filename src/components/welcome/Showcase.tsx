"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/* The product, shown: a linked pair of phones in the hero and a tabbed showcase. Every picture is a real screen from the app with demo data. */

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const SHOTS = {
  home: { src: "/welcome/phone-home.webp", alt: "The CoachFlow home screen: next session, group classes and credits." },
  logger: { src: "/welcome/phone-logger.webp", alt: "The CoachFlow workout logger: sets with last time's weights beside them." },
  progress: { src: "/welcome/phone-progress.webp", alt: "The CoachFlow progress screen: weekly volume, streak and totals." },
  clients: { src: "/welcome/phone-clients.webp", alt: "The CoachFlow clients screen: a coach code and a roster of clients." },
  schedule: { src: "/welcome/phone-schedule.webp", alt: "The CoachFlow schedule screen: sessions waiting for attendance." },
} as const;

type Shot = keyof typeof SHOTS;
type Who = "train" | "coach";

/** Two phones, one for you and one for your coach, with messages passing between them. The one that matches the visitor leads. */
export function LinkedPair({ who }: { who: Who }) {
  return (
    <div className="wc-pair" data-lead={who === "train" ? "you" : "coach"}>
      <figure className="wc-side" data-side="you">
        <div className="wc-phone">
          <Image src={SHOTS.logger.src} alt={SHOTS.logger.alt} width={540} height={1170} sizes="(max-width: 860px) 42vw, 260px" priority />
        </div>
        <figcaption>You log the set</figcaption>
      </figure>
      <div className="wc-link" aria-hidden="true">
        <span className="wc-dot" />
        <span className="wc-pulse" style={{ ["--i" as string]: "0s" }}>
          Set logged
        </span>
        <span className="wc-pulse" style={{ ["--i" as string]: "3s" }}>
          Note sent
        </span>
        <span className="wc-pulse" style={{ ["--i" as string]: "6s" }}>
          Session booked
        </span>
      </div>
      <figure className="wc-side" data-side="coach">
        <div className="wc-phone">
          <Image src={SHOTS.clients.src} alt={SHOTS.clients.alt} width={540} height={1170} sizes="(max-width: 860px) 42vw, 260px" priority />
        </div>
        <figcaption>Your coach sees it</figcaption>
      </figure>
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
