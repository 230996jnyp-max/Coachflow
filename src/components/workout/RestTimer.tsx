"use client";

import { Minus, Plus, SkipForward, Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fmtClock } from "@/lib/utils";

export interface RestState {
  endsAt: number;
  total: number;
}

export function makeRest(seconds: number): RestState {
  return { endsAt: Date.now() + seconds * 1000, total: seconds };
}

function beep() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    o.start();
    o.stop(ctx.currentTime + 0.55);
  } catch {
    /* audio unavailable */
  }
  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    /* ignore */
  }
}

export function RestTimerBar({ rest, onChange, onDismiss }: { rest: RestState; onChange: (r: RestState) => void; onDismiss: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const firedRef = useRef(false);
  const dismissRef = useRef(onDismiss);

  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const left = Math.max(0, Math.ceil((rest.endsAt - now) / 1000));

  useEffect(() => {
    if (left === 0 && !firedRef.current) {
      firedRef.current = true;
      beep();
      setTimeout(() => dismissRef.current(), 2500);
    }
    if (left > 0) firedRef.current = false;
  }, [left]);

  const pct = Math.min(100, Math.max(0, (1 - left / Math.max(1, rest.total)) * 100));
  const adjust = (sec: number) => {
    firedRef.current = false;
    onChange({ endsAt: Math.max(Date.now() + 1000, rest.endsAt + sec * 1000), total: Math.max(15, rest.total + sec) });
  };

  return (
    <div className="pb-safe fixed inset-x-0 bottom-[60px] z-40 px-3 md:bottom-0 md:left-64 md:px-6">
      <div className="mx-auto mb-2 max-w-2xl overflow-hidden rounded-2xl border border-accent/40 bg-surface shadow-2xl">
        <div className="h-1 bg-line">
          <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center gap-2 p-2">
          <div className="flex items-center gap-2 pl-2">
            <Timer size={18} className="text-accent" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted">{left === 0 ? "Rest over" : "Rest"}</div>
              <div className="text-xl font-bold tabular-nums leading-none">{fmtClock(left)}</div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => adjust(-15)} className="flex h-11 min-w-[56px] items-center justify-center gap-1 rounded-xl bg-field text-xs font-bold hover:bg-line" aria-label="Subtract 15 seconds">
              <Minus size={12} /> 15s
            </button>
            <button onClick={() => adjust(15)} className="flex h-11 min-w-[56px] items-center justify-center gap-1 rounded-xl bg-field text-xs font-bold hover:bg-line" aria-label="Add 15 seconds">
              <Plus size={12} /> 15s
            </button>
            <button onClick={onDismiss} className="flex h-11 items-center gap-1 rounded-xl bg-accent px-3 text-xs font-bold text-white" aria-label="Skip rest">
              <SkipForward size={14} /> Skip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
