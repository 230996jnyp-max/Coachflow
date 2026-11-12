"use client";

import { useEffect, useState } from "react";

const COLORS = ["#f59e0b", "#3b82f6", "#10b981", "#ec4899", "#8b5cf6", "#ef4444"];

/** A short burst of confetti (about two seconds), then it removes itself. Skipped for people who asked for less motion. */
export function Confetti({ count = 36 }: { count?: number }) {
  const [on, setOn] = useState(true);
  const [pieces] = useState(() =>
    Array.from({ length: count }, (_, i) => ({
      left: Math.round(Math.random() * 100),
      delay: Math.round(Math.random() * 400),
      dur: 1400 + Math.round(Math.random() * 900),
      drift: Math.round((Math.random() - 0.5) * 120),
      spin: Math.round(Math.random() * 720),
      color: COLORS[i % COLORS.length],
      size: 6 + Math.round(Math.random() * 6),
    })),
  );
  useEffect(() => {
    const t = setTimeout(() => setOn(false), 2800);
    return () => clearTimeout(t);
  }, []);
  if (!on) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[80] overflow-hidden motion-reduce:hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="cf-confetti absolute top-0 block rounded-[2px]"
          style={{ left: `${p.left}%`, width: p.size, height: p.size * 0.6, background: p.color, animationDelay: `${p.delay}ms`, animationDuration: `${p.dur}ms`, ["--drift" as string]: `${p.drift}px`, ["--spin" as string]: `${p.spin}deg` }}
        />
      ))}
    </div>
  );
}
