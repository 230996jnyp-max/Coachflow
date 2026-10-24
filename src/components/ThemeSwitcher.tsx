"use client";

import { Check, Palette } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { saveThemePreference } from "@/lib/store";
import { applyTheme, THEMES, useTheme, type ThemeId, type ThemeInfo } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** Applies a theme now, remembers it on the device and (when signed in) on the account. */
export function chooseTheme(id: ThemeId) {
  applyTheme(id);
  saveThemePreference(id);
}

/** Three-colour preview of a theme. */
export function Swatch({ t, size = 28 }: { t: ThemeInfo; size?: number }) {
  return (
    <span className="inline-flex overflow-hidden rounded-lg border border-line" style={{ width: size * 1.9, height: size, background: t.swatch.bg }} aria-hidden>
      <span className="m-auto flex items-center gap-1">
        <span className="rounded-sm" style={{ width: size * 0.5, height: size * 0.5, background: t.swatch.surface, outline: `1px solid ${t.swatch.ink}33` }} />
        <span className="rounded-full" style={{ width: size * 0.34, height: size * 0.34, background: t.swatch.accent }} />
      </span>
    </span>
  );
}

/** Settings card: pick Black, White or Navy Blue. */
export function ThemePicker() {
  const theme = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2 sm:gap-3">
      {THEMES.map((t) => {
        const on = t.id === theme;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => chooseTheme(t.id)}
            className={cn("flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-2xl border p-3 text-sm font-semibold transition-colors", on ? "border-accent bg-accent/10 text-ink" : "border-line bg-field text-muted hover:text-ink")}
          >
            <Swatch t={t} size={34} />
            <span className="flex items-center gap-1">
              {on && <Check size={14} className="text-accent" />} {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Quick toggle: a palette button that opens a small menu with the three themes. */
export function ThemeMenu({ className, align = "right", up = false }: { className?: string; align?: "left" | "right"; up?: boolean }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Change theme"
        aria-expanded={open}
        className={cn("flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-field text-ink", className)}
      >
        <Palette size={20} />
      </button>
      {open && (
        <div role="menu" className={cn("absolute z-50 w-44 rounded-2xl border border-line bg-surface p-1.5 shadow-2xl", up ? "bottom-full mb-2" : "top-full mt-2", align === "right" ? "right-0" : "left-0")}>
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitemradio"
              aria-checked={t.id === theme}
              onClick={() => {
                chooseTheme(t.id);
                setOpen(false);
              }}
              className={cn("flex min-h-11 w-full items-center gap-3 rounded-xl px-2 text-sm font-semibold hover:bg-field", t.id === theme ? "text-accent" : "text-ink")}
            >
              <Swatch t={t} size={22} />
              <span className="flex-1 text-left">{t.label}</span>
              {t.id === theme && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
