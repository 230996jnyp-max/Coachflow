"use client";

import { useSyncExternalStore } from "react";

/*
 * Guided spotlight tour. A step names the page it belongs to and one or more `data-tour="…"` targets (the first one
 * that is visible is highlighted; a visible one is chosen because the sidebar and the mobile bar both exist in the page).
 */

export interface TourStep {
  route: string;
  targets: string[];
  title: string;
  text: string;
}

export const COACH_STEPS: TourStep[] = [
  {
    route: "/schedule",
    targets: ["schedule-board"],
    title: "Your master schedule",
    text: "Manage your schedule, book 1-on-1 sessions and group classes, and mark attendance at the start and end of class. Credits settle automatically — Present takes one, a No-Show gives it back.",
  },
  {
    route: "/schedule",
    targets: ["book-client", "schedule-board"],
    title: "Gyms, Google Maps & travel buffers",
    text: "Pick a preset gym or search any Singapore address on Google Maps when you book. Back-to-back sessions at the same gym need no travel time, while different gyms automatically protect your transit time.",
  },
  {
    route: "/clients",
    targets: ["clients-list", "clients-search"],
    title: "Clients & credits",
    text: "Add clients, copy their login details in one tap, and manage both 1-on-1 and Group Class credits. Open a client to see their training score, attendance rate and full credit log.",
  },
  {
    route: "/clients",
    targets: ["clients-groups"],
    title: "Who needs you",
    text: "Tap a group to see who is behind their weekly target, has gone quiet, missed a session or is low on credits. Each client shows a 7-day and 30-day training score, and Nudge clients messages several people privately in one go.",
  },
  {
    route: "/trainer",
    targets: ["coach-code"],
    title: "Your coach code",
    text: "Share this 6-digit code with a client. They type it when they sign up (or in their Profile) and you accept them here with one tap. Requests show up on your dashboard and Clients page.",
  },
  {
    route: "/workout",
    targets: ["workout-start"],
    title: "Workout logger",
    text: "Log sets with automatic PR detection and previous-set references. For group classes, push one workout to everyone and follow every client live from the class page.",
  },
  {
    route: "/workout",
    targets: ["workout-import"],
    title: "Import from your notes",
    text: "Paste messy notes from Notepad or WhatsApp, or upload a PDF, Word, Excel file or photo. AI reads the exercises, sets and reps and turns them into reusable routines.",
  },
  {
    route: "/schedule",
    targets: ["bell"],
    title: "Notifications",
    text: "Partner-session requests, waitlist changes, class updates, workout comments and new client requests land here. Open See all to find everything sorted into tabs, or approve a request in one tap.",
  },
];

export const CLIENT_STEPS: TourStep[] = [
  {
    route: "/home",
    targets: ["home-credits"],
    title: "Your home base",
    text: "See your remaining 1-on-1 and group class credits and your next session at a glance. When your coach starts a group workout, a banner takes you straight into it.",
  },
  {
    route: "/book",
    targets: ["schedule-board", "book-tabs"],
    title: "Tap to book",
    text: "Tap any open slot to book a 1-on-1 session at your gym, or switch to Group classes to grab a spot before they fill up. The times you can pick already respect your coach's travel time.",
  },
  {
    route: "/workout",
    targets: ["workout-start"],
    title: "Log your workouts",
    text: "Log your solo workouts or follow your coach's group workout. The app shows your previous weights, starts your rest timer automatically, and celebrates new PRs.",
  },
  {
    route: "/progress",
    targets: ["progress-hub"],
    title: "See your progress",
    text: "Track strength curves, volume and body measurements. Add check-in photos to your Photo vault for side-by-side before-and-after comparisons.",
  },
  {
    route: "/messages",
    targets: ["nav-messages"],
    title: "Chat with your coach",
    text: "Message your coach about form checks, training questions or schedule changes — all in one place.",
  },
];

/** Someone training on their own: no coach, so nothing about booking, credits or chat. */
export const PERSONAL_STEPS: TourStep[] = [
  {
    route: "/home",
    targets: ["home-goal"],
    title: "Your home base",
    text: "See this week's goal, your streak, your latest personal records and your starter routines at a glance. Change the goal's days in your profile any time.",
  },
  {
    route: "/workout",
    targets: ["workout-start"],
    title: "Log your workouts",
    text: "Start an empty workout or a routine. The app shows your previous weights, starts your rest timer automatically, suggests what to aim for today and celebrates new PRs.",
  },
  {
    route: "/workout",
    targets: ["workout-import"],
    title: "Bring in your plan",
    text: "Paste a plan from your notes or WhatsApp, or upload a file or photo, and turn it into a routine or a logged workout.",
  },
  {
    route: "/progress",
    targets: ["progress-hub"],
    title: "See your progress",
    text: "Track strength curves, volume and body measurements. Add check-in photos to your Photo vault for side-by-side before-and-after comparisons.",
  },
];

/* ---------------- Tiny store ---------------- */
interface TourState {
  active: boolean;
  step: number;
}

let state: TourState = { active: false, step: 0 };
const listeners = new Set<() => void>();
const set = (next: TourState) => {
  state = next;
  listeners.forEach((l) => l());
};

/** Starts (or restarts) the tour from step 1. */
export function startTour() {
  set({ active: true, step: 0 });
}
export function closeTour() {
  set({ active: false, step: 0 });
}
export function goToStep(step: number) {
  set({ active: true, step });
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
