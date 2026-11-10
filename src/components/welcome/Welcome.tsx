"use client";

import Link from "next/link";
import { useState } from "react";
import { CoachDemoCards, PersonalDemoCards } from "./Cards";
import { saira } from "./fonts";
import { CoachCodeStart, LinkedPair, Showcase, StartForm } from "./Showcase";
import "./welcome.css";

type Who = "train" | "coach";

const HERO: Record<Who, { head: string; lede: string; signup: string }> = {
  train: { head: "Train smarter. Beat last week.", lede: "Log every lift, track your food and watch your numbers climb. No coach needed.", signup: "/signup?role=personal" },
  coach: { head: "Coach more. Chase less.", lede: "Run clients, classes and bookings in one place, and see exactly what they log.", signup: "/signup?role=coach" },
};

const SECTION: Record<Who, { head: string; note: string }> = {
  train: { head: "Made for how you train.", note: "Five things to try right now, and one on the way. Everything here is a sample, so nothing is saved." },
  coach: { head: "Made for how coaching really works.", note: "Six things to try right now, and one on the way. Everything here is a sample, so nothing is saved." },
};

const FAQ: { q: string; a: string }[] = [
  { q: "Do I need a coach to use it?", a: "No. You can train on your own and add a coach later with their six-digit code. Your history comes with you." },
  { q: "What does it cost?", a: "Your first 30 days are free and you don't need a card to start. We'll show pricing before anything is charged." },
  { q: "Do I install anything?", a: "No. It runs in your browser, and you can add it to your phone's home screen like an app." },
  { q: "Can coaches run groups?", a: "Yes. Group classes have spots, waitlists and attendance, next to one-to-one sessions." },
  { q: "Who can see my data?", a: "You, and the coach you accept. A coach never sees another coach's clients." },
];

/** The page logged-out visitors see first: what CoachFlow is, shown by using it. */
export function Welcome() {
  const [who, setWho] = useState<Who>("train");
  const h = HERO[who];
  const s = SECTION[who];

  return (
    <div className={`wc ${saira.variable}`}>
      <div className="wc-top">
        <div className="wc-wrap">
          <header className="wc-nav">
            <Link href="/" className="wc-mark">
              CoachFlow
            </Link>
            <nav className="wc-nav-links" aria-label="Main">
              <a href="#different" className="wc-hide-s">
                Why CoachFlow
              </a>
              <a href="#features" className="wc-hide-s">
                Features
              </a>
              <a href="#faq" className="wc-hide-s">
                Questions
              </a>
              <Link href="/login">Log in</Link>
              <Link href={h.signup} className="wc-btn wc-btn-primary wc-btn-small">
                Start free
              </Link>
            </nav>
          </header>

          <main id="main">
            <section className="wc-hero" aria-labelledby="wc-h1">
              <div>
                <div className="wc-roles" role="group" aria-label="I want to">
                  <button type="button" aria-pressed={who === "train"} onClick={() => setWho("train")}>
                    I train
                  </button>
                  <button type="button" aria-pressed={who === "coach"} onClick={() => setWho("coach")}>
                    I coach
                  </button>
                </div>
                <h1 id="wc-h1" key={who}>
                  {h.head}
                </h1>
                <p className="wc-lede">{h.lede}</p>
                <StartForm signup={h.signup} id="wc-email" label="Start free for 30 days" />
                <p className="wc-fine">
                  No card needed. Already have an account? <Link href="/login">Log in</Link>
                </p>
                {who === "train" && <CoachCodeStart />}
              </div>
              <LinkedPair who={who} />
            </section>
          </main>
        </div>
      </div>

      <div className="wc-wrap">
        <section className="wc-diff" id="different" aria-labelledby="wc-diff-h">
          <h2 id="wc-diff-h" className="wc-rv">
            {s.head}
          </h2>
          <p className="wc-diff-note">{s.note}</p>
          <div className="wc-diff-grid" key={who}>
            {who === "train" ? <PersonalDemoCards /> : <CoachDemoCards />}
          </div>
        </section>
      </div>

      <div id="features">
        <Showcase who={who} />
      </div>

      <div className="wc-wrap">
        <section className="wc-trust" aria-label="Good to know">
          <div className="wc-rv">
            <strong>Private by design</strong>
            <span>Client profiles are encrypted, and coaches only see their own clients.</span>
          </div>
          <div className="wc-rv">
            <strong>No card to start</strong>
            <span>Your first 30 days are free. Pricing is shown before anything is charged.</span>
          </div>
          <div className="wc-rv">
            <strong>Nothing to install</strong>
            <span>It runs in your browser, and sits on your home screen like an app.</span>
          </div>
        </section>

        <section className="wc-faq" id="faq" aria-labelledby="wc-q">
          <h2 id="wc-q" className="wc-rv">
            Questions
          </h2>
          <div>
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </div>

      <section className="wc-end" aria-labelledby="wc-free">
        <div className="wc-wrap">
          <h2 id="wc-free" className="wc-rv">
            Free for your first 30 days.
          </h2>
          <div>
            <StartForm signup={h.signup} id="wc-email-end" label="Start free" />
            <p className="wc-fine">No card needed.</p>
          </div>
        </div>
      </section>

      <div className="wc-wrap">
        <footer className="wc-foot">
          <span>CoachFlow</span>
          <span>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/login">Log in</Link>
          </span>
        </footer>
      </div>
    </div>
  );
}
