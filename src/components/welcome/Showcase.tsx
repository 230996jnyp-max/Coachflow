"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/store";

/* The product, shown: a linked pair of phones in the hero and a tabbed showcase. Every picture is a real screen from the app with demo data. */

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const SHOTS = {
  home: { src: "/welcome/phone-home.webp", alt: "The CoachFlow home screen: next session, group classes and credits." },
  logger: { src: "/welcome/phone-logger.webp", alt: "The CoachFlow workout logger: sets with last time's weights beside them." },
  progress: { src: "/welcome/phone-progress.webp", alt: "The CoachFlow progress screen: weekly volume, streak and totals." },
  clients: { src: "/welcome/phone-clients.webp", alt: "The CoachFlow clients screen: a coach code and a roster of clients." },
  schedule: { src: "/welcome/phone-schedule.webp", alt: "The CoachFlow schedule screen: sessions waiting for attendance." },
  classes: { src: "/welcome/phone-classes.webp", alt: "The CoachFlow classes list: a group class that is full with two people on the waitlist." },
} as const;

type Shot = keyof typeof SHOTS;
type Who = "train" | "coach";

const PAIR: Record<Who, { left: Shot; right: Shot; leftCap: string; rightCap: string; link: boolean; pulses: [string, string, string] }> = {
  // Someone training on their own: their log, and what it builds.
  train: { left: "logger", right: "progress", leftCap: "Log it", rightCap: "Watch it climb", link: false, pulses: ["New personal best", "Workout imported", "Goal on track"] },
  // A coach: the client's side and their own, linked.
  coach: { left: "logger", right: "clients", leftCap: "Your client logs it", rightCap: "You see it", link: true, pulses: ["Set logged", "Note sent", "Session booked"] },
};

/** Two phones. For someone training alone they show the log and what it builds; for a coach they are the client's phone and the coach's, with messages passing between. */
export function LinkedPair({ who }: { who: Who }) {
  const p = PAIR[who];
  return (
    <div className="wc-pair" data-lead={who === "train" ? "you" : "coach"} data-link={p.link} key={who}>
      <figure className="wc-side" data-side="you">
        <div className="wc-phone">
          <Image src={SHOTS[p.left].src} alt={SHOTS[p.left].alt} width={540} height={1170} sizes="(max-width: 860px) 42vw, 260px" priority />
        </div>
        <figcaption>{p.leftCap}</figcaption>
      </figure>
      <div className="wc-link" aria-hidden="true">
        <span className="wc-dot" />
        {p.pulses.map((t, n) => (
          <span key={t} className="wc-pulse" style={{ ["--i" as string]: `${n * 3}s` }}>
            {t}
          </span>
        ))}
      </div>
      <figure className="wc-side" data-side="coach">
        <div className="wc-phone">
          <Image src={SHOTS[p.right].src} alt={SHOTS[p.right].alt} width={540} height={1170} sizes="(max-width: 860px) 42vw, 260px" priority />
        </div>
        <figcaption>{p.rightCap}</figcaption>
      </figure>
    </div>
  );
}

type Tab = { title: string; text: string; shot: Shot };

const TABS: Record<Who, Tab[]> = {
  train: [
    { title: "Log every set", text: "Last time's weights sit beside each set, so you know exactly what to beat.", shot: "logger" },
    { title: "See the climb", text: "Weekly volume, streaks and totals build up as you train.", shot: "progress" },
  ],
  coach: [
    { title: "Run your roster", text: "Every client with their credits and next session. Your coach code is one tap away.", shot: "clients" },
    { title: "Group classes with waitlists", text: "Set the spots. Extra clients wait in order and move up when someone cancels.", shot: "classes" },
    { title: "Confirm sessions fast", text: "Finished sessions wait for attendance: present or no-show in one tap.", shot: "schedule" },
    { title: "What your clients see", text: "Their next session, group classes and credits in one view.", shot: "home" },
    { title: "Smart suggestions", text: "Plain rules suggest the next weight, and a deload when progress stalls.", shot: "logger" },
  ],
};

/** Tabs that swap the phone. They advance by themselves until someone picks one. */
export function Showcase({ who }: { who: Who }) {
  return <ShowcaseTabs key={who} tabs={TABS[who]} />;
}

function ShowcaseTabs({ tabs: TAB_LIST }: { tabs: Tab[] }) {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto || reducedMotion()) return;
    const id = setInterval(() => setI((n) => (n + 1) % TAB_LIST.length), 4500);
    return () => clearInterval(id);
  }, [auto, TAB_LIST.length]);
  return (
    <section className="wc-show" aria-labelledby="wc-all">
      <div className="wc-wrap">
        <h2 id="wc-all" className="wc-rv">
          Everything in one place.
        </h2>
        <div className="wc-show-grid">
          <div role="tablist" aria-label="What CoachFlow does" className="wc-tabs">
            {TAB_LIST.map((t, n) => (
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
              {TAB_LIST.map((t, n) => (
                <Image key={t.shot} src={SHOTS[t.shot].src} alt={n === i ? SHOTS[t.shot].alt : ""} width={540} height={1170} sizes="330px" data-on={i === n} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** "Have a coach code?": checks the six digits, names the coach, then carries the code to the sign-up form (in this tab's session storage, not the address bar). */
export function CoachCodeStart() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "busy" | "error" | "found"; text?: string }>({ kind: "idle" });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return setState({ kind: "error", text: "A coach code is six digits." });
    setState({ kind: "busy" });
    const r = await api<{ name: string }>("/api/signup/coach-code", { body: { code } });
    if (!r.ok || !r.data) return setState({ kind: "error", text: r.error ?? "We couldn't find a coach with that code." });
    setState({ kind: "found", text: `${r.data.name} is waiting for you. Taking you to sign-up.` });
    try {
      sessionStorage.setItem("cf_signup_coach_code", code);
    } catch {
      /* private mode: they type it again on the next screen */
    }
    router.push("/signup?role=client");
  };
  if (!open) {
    return (
      <button type="button" className="wc-codelink" onClick={() => setOpen(true)}>
        Have a coach code?
      </button>
    );
  }
  return (
    <form className="wc-codebox" onSubmit={submit}>
      <label htmlFor="wc-coach-code">Your coach&apos;s six-digit code</label>
      <div className="wc-codebox-row">
        <input
          id="wc-coach-code"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          placeholder="482915"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
            setState({ kind: "idle" });
          }}
        />
        <button type="submit" className="wc-btn wc-btn-ghost wc-btn-small" disabled={state.kind === "busy" || state.kind === "found"}>
          {state.kind === "busy" ? "Checking" : "Continue"}
        </button>
      </div>
      <p className={state.kind === "error" ? "wc-err" : "wc-fine"} role={state.kind === "error" ? "alert" : "status"}>
        {state.text ?? "Your coach shares it with you. They accept you once you've signed up."}
      </p>
    </form>
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
