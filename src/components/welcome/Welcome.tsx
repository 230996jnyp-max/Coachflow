"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BookingDemo, CodeDemo, ProgressChart, SetLogger } from "./Demos";
import { saira } from "./fonts";
import "./welcome.css";

type Who = "train" | "coach";

const HERO: Record<Who, { head: string; lede: string; signup: string }> = {
  train: { head: "Train smarter. Beat last week.", lede: "Log every lift, book your coach and watch your numbers climb.", signup: "/signup?role=personal" },
  coach: { head: "Coach more. Chase less.", lede: "Track every client, take bookings and see who needs a nudge.", signup: "/signup?role=coach" },
};

const FEATURES: { title: string; text: string }[] = [
  { title: "Workout logger", text: "Last time's weights sit beside every set, so you know what to beat." },
  { title: "Routines", text: "Build routines once and use them again, or share them with clients." },
  { title: "Nutrition", text: "Search foods, scan barcodes and keep calories and macros in view." },
  { title: "Bookings", text: "Set your open hours. Clients request a slot and you answer in a tap." },
  { title: "Group classes", text: "Run classes with waitlists, repeats and attendance." },
  { title: "Messages", text: "Chat with your coach or your clients without leaving the app." },
  { title: "AI import", text: "Paste a workout from your notes and it becomes a logged session." },
  { title: "Private by design", text: "Client profiles are encrypted, and coaches only see their own clients." },
];

const FAQ: { q: string; a: string }[] = [
  { q: "Do I need a coach to use it?", a: "No. You can train on your own and add a coach later with their six-digit code." },
  { q: "What does it cost?", a: "Your first 30 days are free and you don't need a card to start. We'll show pricing before anything is charged." },
  { q: "Do I install anything?", a: "No. It runs in your browser, and you can add it to your phone's home screen like an app." },
  { q: "Can coaches run groups?", a: "Yes. Group classes have spots, waitlists and attendance, next to one-to-one sessions." },
  { q: "Who can see my data?", a: "You, and the coach you accept. A coach never sees another coach's clients." },
];

/** The page logged-out visitors see first: what CoachFlow is, shown by using it. */
export function Welcome() {
  const router = useRouter();
  const [who, setWho] = useState<Who>("train");
  const [email, setEmail] = useState("");
  const h = HERO[who];

  /** The email is carried to the sign-up form through the tab's session storage, never the address bar. */
  const start = (e: React.FormEvent) => {
    e.preventDefault();
    const v = email.trim();
    try {
      if (v) sessionStorage.setItem("cf_signup_email", v);
    } catch {
      /* private mode: they just type it again */
    }
    router.push(h.signup);
  };

  return (
    <div className={`wc ${saira.variable}`}>
      <div className="wc-wrap">
        <header className="wc-nav">
          <Link href="/" className="wc-mark">
            CoachFlow
          </Link>
          <nav className="wc-nav-links" aria-label="Main">
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
              <form className="wc-start" onSubmit={start}>
                <label htmlFor="wc-email" className="wc-sr">
                  Email address
                </label>
                <input id="wc-email" type="email" autoComplete="email" inputMode="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                <button type="submit" className="wc-btn wc-btn-primary">
                  Start free for 30 days
                </button>
              </form>
              <p className="wc-fine">
                No card needed. Already have an account? <Link href="/login">Log in</Link>
              </p>
            </div>
            <figure className="wc-shot">
              {who === "train" ? (
                <Image src="/welcome/app-train.jpg" width={600} height={600} priority alt="The CoachFlow workout screen: a bench press with sets, weights, reps and a suggested deload." />
              ) : (
                <Image src="/welcome/app-coach.jpg" width={598} height={600} priority alt="The CoachFlow coach screen: your six-digit coach code and a roster of clients with credits and next sessions." />
              )}
              <figcaption>The real app, with demo clients.</figcaption>
            </figure>
          </section>

          <section className="wc-sec" aria-labelledby="wc-log">
            <div>
              <h2 id="wc-log">Log a set. Beat it.</h2>
              <p>Try it: change the weight and log a set. Your best gets flagged as you go.</p>
            </div>
            <SetLogger />
          </section>

          <section className="wc-feat" id="features" aria-labelledby="wc-all">
            <h2 id="wc-all">Everything in one place.</h2>
            <ul>
              {FEATURES.map((f) => (
                <li key={f.title}>
                  <strong>{f.title}</strong>
                  <span>{f.text}</span>
                </li>
              ))}
            </ul>
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

          <section className="wc-faq" id="faq" aria-labelledby="wc-q">
            <h2 id="wc-q">Questions</h2>
            <div>
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </section>

          <section className="wc-end" aria-labelledby="wc-free">
            <h2 id="wc-free">Free for your first 30 days.</h2>
            <div className="wc-actions">
              <Link href={h.signup} className="wc-btn wc-btn-primary">
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
