"use client";

import Link from "next/link";
import { useState } from "react";
import { BookingDemo, CodeDemo, ProgressChart, SetLogger } from "./Demos";
import { saira } from "./fonts";
import { Marquee, PhoneStack, Showcase, StartForm } from "./Showcase";
import "./welcome.css";

type Who = "train" | "coach";

const HERO: Record<Who, { head: string; lede: string; signup: string }> = {
  train: { head: "Train smarter. Beat last week.", lede: "Log every lift, book your coach and watch your numbers climb.", signup: "/signup?role=personal" },
  coach: { head: "Coach more. Chase less.", lede: "Track every client, take bookings and see who needs a nudge.", signup: "/signup?role=coach" },
};

const FAQ: { q: string; a: string }[] = [
  { q: "Do I need a coach to use it?", a: "No. You can train on your own and add a coach later with their six-digit code." },
  { q: "What does it cost?", a: "Your first 30 days are free and you don't need a card to start. We'll show pricing before anything is charged." },
  { q: "Do I install anything?", a: "No. It runs in your browser, and you can add it to your phone's home screen like an app." },
  { q: "Can coaches run groups?", a: "Yes. Group classes have spots, waitlists and attendance, next to one-to-one sessions." },
  { q: "Who can see my data?", a: "You, and the coach you accept. A coach never sees another coach's clients." },
];

/** The page logged-out visitors see first: what CoachFlow is, shown by using it. */
export function Welcome() {
  const [who, setWho] = useState<Who>("train");
  const h = HERO[who];

  return (
    <div className={`wc ${saira.variable}`}>
      <div className="wc-band">
        <div className="wc-wrap">
          <header className="wc-nav">
            <Link href="/" className="wc-mark">
              CoachFlow
            </Link>
            <nav className="wc-nav-links" aria-label="Main">
              <a href="#features" className="wc-hide-s">
                Features
              </a>
              <a href="#try" className="wc-hide-s">
                Try it
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
              </div>
              <PhoneStack who={who} />
            </section>
          </main>
        </div>
      </div>

      <Marquee />

      <div id="features">
        <Showcase />
      </div>

      <div className="wc-wrap">
        <section className="wc-try" id="try" aria-labelledby="wc-try-h">
          <h2 id="wc-try-h" className="wc-rv">
            Try it yourself.
          </h2>
          <p className="wc-try-note">Tap around. Everything here is a sample, so nothing is saved.</p>
          <div className="wc-try-grid">
            <div className="wc-rv">
              <SetLogger />
            </div>
            <div className="wc-rv">
              <BookingDemo />
            </div>
            <div className="wc-rv">
              <CodeDemo />
            </div>
            <div className="wc-rv">
              <ProgressChart />
            </div>
          </div>
        </section>

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
