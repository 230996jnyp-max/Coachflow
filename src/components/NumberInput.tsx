"use client";

import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "./ui";

const fmt = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? "" : String(v));
const round = (n: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

/**
 * Number box that is easy to edit: the whole number is selected when you tap it, it can be cleared and retyped freely
 * (no stuck "0" or "08"), and − / + buttons (or the arrow keys) nudge it. The value is tidied up when you leave the box:
 * clamped to `min`/`max`, and put back to the last good number when the box is left empty (unless `allowEmpty`).
 */
export function NumberInput({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  decimals = 0,
  allowEmpty = false,
  placeholder,
  label,
  className,
  compact,
  disabled,
  commitOnBlur,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  /** How many decimal places may be typed (0 = whole numbers). */
  decimals?: number;
  /** An empty box means "no value" (e.g. an optional weight) instead of snapping back. */
  allowEmpty?: boolean;
  placeholder?: string;
  label: string;
  className?: string;
  /** Smaller buttons, for narrow columns. */
  compact?: boolean;
  disabled?: boolean;
  /** Only report the number when the box is left (for settings that save on every change). */
  commitOnBlur?: boolean;
}) {
  const [text, setText] = useState(fmt(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    // The number changed from outside (a button, another field, a reload): show it, unless it is just what was typed.
    setSeen(value);
    const parsed = text === "" ? undefined : Number(text);
    if (parsed !== value) setText(fmt(value));
  }

  const clamp = (n: number) => round(Math.min(max ?? Infinity, Math.max(min, n)), decimals);
  const set = (n: number | undefined) => {
    setSeen(n);
    setText(fmt(n));
    onChange(n);
  };
  const nudge = (dir: 1 | -1) => {
    if (value === undefined) return set(clamp(dir === 1 ? Math.max(min, step) : min));
    set(clamp(value + dir * step));
  };
  const re = decimals > 0 ? new RegExp(`^\\d*\\.?\\d{0,${decimals}}$`) : /^\d*$/;
  const btn = cn(
    "flex shrink-0 items-center justify-center rounded-xl border border-line bg-field text-muted transition-colors hover:text-ink active:scale-95 disabled:opacity-40",
    compact ? "h-10 w-7" : "h-11 w-10",
  );

  return (
    <div className={cn("flex items-stretch gap-1", className)}>
      <Input
        aria-label={label}
        inputMode={decimals > 0 ? "decimal" : "numeric"}
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const raw = e.target.value.replace(",", ".");
          if (!re.test(raw)) return;
          setText(raw);
          if (commitOnBlur) return;
          if (raw === "" || raw === ".") {
            if (allowEmpty) {
              setSeen(undefined);
              onChange(undefined);
            }
            return;
          }
          const n = Math.min(max ?? Infinity, Number(raw));
          setSeen(n);
          onChange(n);
        }}
        onBlur={() => {
          if (text === "" || text === ".") {
            if (allowEmpty) return set(undefined);
            return set(value === undefined ? clamp(min) : clamp(value));
          }
          if (commitOnBlur && clamp(Number(text)) === value) return setText(fmt(value));
          set(clamp(Number(text)));
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            nudge(1);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            nudge(-1);
          }
        }}
        className={cn("order-2 min-w-0 flex-1 px-1 text-center font-semibold tabular-nums", compact ? "h-10" : "h-11")}
      />
      <button type="button" tabIndex={-1} aria-label={`Decrease ${label}`} disabled={disabled || (value !== undefined && value <= min)} onClick={() => nudge(-1)} className={cn(btn, "order-1")}>
        <Minus size={14} />
      </button>
      <button type="button" tabIndex={-1} aria-label={`Increase ${label}`} disabled={disabled || (max !== undefined && value !== undefined && value >= max)} onClick={() => nudge(1)} className={cn(btn, "order-3")}>
        <Plus size={14} />
      </button>
    </div>
  );
}
