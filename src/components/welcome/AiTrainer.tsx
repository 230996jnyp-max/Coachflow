"use client";

import { useState } from "react";
import { api } from "@/lib/store";

/*
 * The AI personal trainer is not built yet. This card says so, shows an idea of how it could look (a scripted example, clearly a concept),
 * states the safety line, and lets people ask to be told when it is ready.
 */

const MODES: { key: string; label: string; you: string; ai: string }[] = [
  { key: "plan", label: "Plan my weeks", you: "I can train three days a week. Plan my next month.", ai: "Three full-body days a week, one heavier day each, and a lighter week every fourth." },
  { key: "coach", label: "Coach me live", you: "Set 3 felt heavy.", ai: "Drop to 72.5 kg for your last set and rest two minutes first." },
  { key: "ask", label: "Ask me anything", you: "Can I swap lunges? My knee feels sore.", ai: "Try a box squat to a height that feels fine. If the knee keeps hurting, see a physio." },
];

/** The concept chat, the safety line and the waitlist. `side` only changes the wording for a coach. */
export function AiTrainerCard({ side }: { side: "train" | "coach" }) {
  const [mode, setMode] = useState(0);
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "busy" | "done" | "error"; text?: string }>({ kind: "idle" });
  const m = MODES[mode];

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = email.trim();
    if (!v) return setState({ kind: "error", text: "Enter your email first." });
    setState({ kind: "busy" });
    const r = await api("/api/waitlist", { body: { email: v, interest: side, website } });
    if (!r.ok) return setState({ kind: "error", text: r.error ?? "Something went wrong. Please try again." });
    setState({ kind: "done", text: "You're on the list. We'll email you once, when it's ready." });
  };

  return (
    <div>
      <div className="wc-chips" role="group" aria-label="What it could do">
        {MODES.map((x, n) => (
          <button key={x.key} type="button" className="wc-day" aria-pressed={n === mode} onClick={() => setMode(n)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="wc-chat" key={m.key} aria-live="polite" aria-label="A concept of the AI personal trainer chat">
        <div className="wc-bubble wc-bubble-you">{m.you}</div>
        <div className="wc-bubble wc-bubble-ai">{m.ai}</div>
      </div>
      <p className="wc-footnote">A concept of how it could look, not live yet. General fitness guidance, not medical advice. For injuries or health conditions, check with a doctor.</p>

      {state.kind === "done" ? (
        <div className="wc-joined" role="status">
          {state.text}
        </div>
      ) : (
        <form className="wc-waitlist" onSubmit={join}>
          <label htmlFor={`wc-wl-${side}`}>{side === "coach" ? "Hear when it's ready for your clients" : "Hear when it's ready"}</label>
          <div className="wc-waitlist-row">
            <input id={`wc-wl-${side}`} type="email" autoComplete="email" inputMode="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            {/* A field real people never see: bots that fill it in are ignored. */}
            <input className="wc-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} />
            <button type="submit" className="wc-btn wc-btn-primary wc-btn-small" disabled={state.kind === "busy"}>
              {state.kind === "busy" ? "Joining" : "Join the waitlist"}
            </button>
          </div>
          {state.kind === "error" && (
            <p className="wc-err" role="alert">
              {state.text}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
