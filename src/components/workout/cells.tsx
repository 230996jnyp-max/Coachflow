"use client";

import { useState } from "react";
import { cn, fmtClock, parseClock } from "@/lib/utils";

export const cellBase =
  "h-11 w-full min-w-0 rounded-lg border border-transparent bg-field text-center text-sm font-semibold tabular-nums text-ink outline-none placeholder:font-normal placeholder:text-muted/50 focus:border-accent disabled:opacity-60";

function fmtNum(v: number | undefined): string {
  return v === undefined || Number.isNaN(v) ? "" : String(v);
}

/** Numeric input that keeps its own text while typing but re-syncs when the value changes externally. */
export function NumberCell({
  value,
  onChange,
  placeholder,
  decimals = true,
  done,
  max,
  className,
  label,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  decimals?: boolean;
  done?: boolean;
  max?: number;
  className?: string;
  label: string;
}) {
  const [text, setText] = useState(fmtNum(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    const parsed = text === "" ? undefined : Number(text);
    if (parsed !== value) setText(fmtNum(value));
  }
  return (
    <input
      aria-label={label}
      inputMode={decimals ? "decimal" : "numeric"}
      type="text"
      value={text}
      placeholder={placeholder}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        const raw = e.target.value.replace(",", ".");
        const re = decimals ? /^-?\d*\.?\d{0,2}$/ : /^\d*$/;
        if (!re.test(raw)) return;
        setText(raw);
        if (raw === "" || raw === "-" || raw === ".") {
          onChange(undefined);
          setSeen(undefined);
          return;
        }
        let n = Number(raw);
        if (Number.isNaN(n)) return;
        if (max !== undefined) n = Math.min(max, n);
        setSeen(n);
        onChange(n);
      }}
      className={cn(cellBase, done && "bg-success/15 text-ink", className)}
    />
  );
}

/** mm:ss input; commits on blur so partial typing never fights the formatter. */
export function ClockCell({
  value,
  onChange,
  done,
  placeholder = "mm:ss",
  label,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  done?: boolean;
  placeholder?: string;
  label: string;
}) {
  const fmt = (v: number | undefined) => (v === undefined ? "" : fmtClock(v));
  const [text, setText] = useState(fmt(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(fmt(value));
  }
  const commit = () => {
    const parsed = parseClock(text);
    setSeen(parsed);
    onChange(parsed);
    setText(fmt(parsed));
  };
  return (
    <input
      aria-label={label}
      inputMode="numeric"
      value={text}
      placeholder={placeholder}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value.replace(/[^\d:]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className={cn(cellBase, done && "bg-success/15 text-ink")}
    />
  );
}
