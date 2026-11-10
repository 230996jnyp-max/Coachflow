"use client";

import Link from "next/link";
import { useState } from "react";
import { BookingDemo, CodeDemo, CoachFeed, ProgressChart, SetLogger } from "./Demos";
import { saira } from "./fonts";
import "./welcome.css";

type Who = "train" | "coach";

const HERO: Record<Who, { head: string; lede: string; signup: string }> = {
  train: { head: "Train smarter. Beat last week.", lede: "Log every lift, book your coach and watch your numbers climb.", signup: "/signup?role=personal" },
  coach: { head: "Coach more. Chase less.", lede: "Track every client, take bookings and see who needs a nudge.", signup: "/signup?role=coach" },
};

/** The page logged-out visitors see first: what CoachFlow is, shown by using it. */
export function Welcome() {
  const [who, setWho] = useState<Who>("train");
  const h = HERO[who];
  return (
    <div className={`wc ${saira.variable}`}>
      <div className="wc-wrap">
        <header className="wc-nav">
          <Link href="/" className="wc-mark">
            CoachFlow
          </Link>
          <nav className="wc-nav-links" aria-label="Account">
            <Link href="/login">Log in</Link>
            <Link href={h.signup} className="wc-btn wc-btn-primary wc-btn-small">
              Start free
            </Link>
          </nav>
        </header>

        <main>
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
              <h1 id="wc-h1">{h.head}</h1>
              <p className="wc-lede">{h.lede}</p>
              <div className="wc-actions">
                <Link href={h.signup} className="wc-btn wc-btn-primary">
                  Start free for 30 days
                </Link>
                <Link href="/login" className="wc-btn wc-btn-ghost">
                  Log in
                </Link>
              </div>
            </div>
            {who === "train" ? <SetLogger /> : <CoachFeed />}
          </section>

          <section className="wc-sec" aria-labelledby="wc-book">
            <div>
              <h2 id="wc-book">Book in a tap.</h2>
              <p>Pick a day and a time. Your coach sees the request and answers in one tap.</p>
            </div>
            <BookingDemo />
          </section>

          <section className="wc-sec" aria-labelledby="wc-code">
            <div>
              <h2 id="wc-code">Join a coach with six digits.</h2>
              <p>Every coach gets a code. Enter it and they accept you. Nothing is shared until they do.</p>
            </div>
            <CodeDemo />
          </section>

          <section className="wc-sec" aria-labelledby="wc-climb">
            <div>
              <h2 id="wc-climb">See the climb.</h2>
              <p>Every logged set builds your progress chart, week after week.</p>
            </div>
            <ProgressChart />
          </section>

          <section className="wc-two" aria-label="Who CoachFlow is for">
            <div>
              <h2>On your own</h2>
              <ul>
                <li>Log workouts and build routines</li>
                <li>Track nutrition and calories (adults)</li>
                <li>Import a workout with AI</li>
                <li>Add a coach any time</li>
              </ul>
            </div>
            <div>
              <h2>For coaches</h2>
              <ul>
                <li>A roster with every client&apos;s progress</li>
                <li>Availability, bookings and group classes</li>
                <li>Attendance and chat in one place</li>
                <li>Your own six-digit coach code</li>
              </ul>
            </div>
          </section>

          <section className="wc-end" aria-labelledby="wc-free">
            <h2 id="wc-free">Free for your first 30 days.</h2>
            <div className="wc-actions">
              <Link href="/signup" className="wc-btn wc-btn-primary">
                Start free
              </Link>
              <Link href="/login" className="wc-btn wc-btn-ghost">
                Log in
              </Link>
            </div>
          </section>
        </main>

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
