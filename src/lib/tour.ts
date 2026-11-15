"use client";

import { useSyncExternalStore } from "react";
import type { TourId } from "./tourSteps";

/*
 * The guided tour's small store (is it open, which step, which parts are being played) and the helper that finds what a step points at.
 * What the steps say, and who gets which part, is in tourSteps.ts. A step names the page it belongs to and one or more
 * `data-tour="…"` targets (the first one that is visible is highlighted; a visible one is chosen because the sidebar and the mobile bar
 * both exist in the page).
 */

export type { PlayedStep, TourId, TourSection, TourStep } from "./tourSteps";

interface TourState {
  active: boolean;
  step: number;
  /** The parts being played, in order; the steps of all of them run as one tour. */
  ids: TourId[];
}

let state: TourState = { active: false, step: 0, ids: ["basics"] };
const listeners = new Set<() => void>();
const set = (next: TourState) => {
  state = next;
  listeners.forEach((l) => l());
};

/** Starts (or restarts) a tour from step 1 with these parts (the basics by default). */
export function startTour(ids: TourId[] = ["basics"]) {
  set({ active: true, step: 0, ids: ids.length ? ids : ["basics"] });
}
export function closeTour() {
  set({ ...state, active: false, step: 0 });
}
export function goToStep(step: number) {
  set({ ...state, active: true, step });
}

export function useTour(): TourState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => state,
    () => state,
  );
}

/** First element for one of the targets that is actually on screen. */
export function findTarget(targets: string[]): HTMLElement | null {
  for (const t of targets) {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${t}"]`)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}
