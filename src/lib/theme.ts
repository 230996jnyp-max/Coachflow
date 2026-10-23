"use client";

import { useSyncExternalStore } from "react";

export type ThemeId = "black" | "white" | "navy";

export interface ThemeInfo {
  id: ThemeId;
  label: string;
  /** Page background, card, accent: for the swatch preview. */
  swatch: { bg: string; surface: string; accent: string; ink: string };
  /** Browser / status-bar colour on phones. */
  meta: string;
}

export const THEMES: ThemeInfo[] = [
  { id: "black", label: "Black", swatch: { bg: "#090B10", surface: "#121620", accent: "#3B82F6", ink: "#F8FAFC" }, meta: "#090B10" },
  { id: "white", label: "White", swatch: { bg: "#F8FAFC", surface: "#FFFFFF", accent: "#2563EB", ink: "#0F172A" }, meta: "#F8FAFC" },
  { id: "navy", label: "Navy Blue", swatch: { bg: "#0A1128", surface: "#111D3B", accent: "#38BDF8", ink: "#F0F6FC" }, meta: "#0A1128" },
];

export const DEFAULT_THEME: ThemeId = "black";
const KEY = "coachflow_theme";
const listeners = new Set<() => void>();

export const isTheme = (v: unknown): v is ThemeId => v === "black" || v === "white" || v === "navy";

/** The theme saved on this device (Black when nothing is saved). */
export function storedTheme(): ThemeId {
  try {
    const t = localStorage.getItem(KEY);
    return isTheme(t) ? t : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Switches the page to a theme straight away, remembers it on this device and updates the browser's theme colour. */
export function applyTheme(id: ThemeId) {
  const info = THEMES.find((t) => t.id === id) ?? THEMES[0];
  const root = document.documentElement;
  root.setAttribute("data-theme", info.id);
  root.style.colorScheme = info.id === "white" ? "light" : "dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", info.meta);
  try {
    localStorage.setItem(KEY, info.id);
  } catch {
    /* private mode: the theme still applies for this visit */
  }
  listeners.forEach((l) => l());
}

export function useTheme(): ThemeId {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      window.addEventListener("storage", l);
      return () => {
        listeners.delete(l);
        window.removeEventListener("storage", l);
      };
    },
    () => (document.documentElement.getAttribute("data-theme") as ThemeId | null) ?? DEFAULT_THEME,
    () => DEFAULT_THEME,
  );
}
