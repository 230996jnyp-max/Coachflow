"use client";

import { useEffect, useSyncExternalStore } from "react";

/*
 * Photos and step-by-step instructions come from the public-domain "free-exercise-db"
 * (https://github.com/yuhonas/free-exercise-db, Unlicense). `public/exercise-media.json` maps our exercise ids to
 * that dataset; photos are served from the jsDelivr CDN. Exercises without a match (custom ones, some cardio
 * machines) fall back to the generated muscle diagram.
 */

export interface MediaEntry {
  /** free-exercise-db folder id */
  d: string;
  /** number of photos (frames) */
  n: number;
  /** difficulty level */
  lv: string;
  /** instruction steps */
  s: string[];
}

const CDN = "https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises";
export const mediaImage = (e: MediaEntry, frame: number) => `${CDN}/${e.d}/${frame}.jpg`;

interface MediaState {
  map: Record<string, MediaEntry> | null;
  failed: boolean;
}

let state: MediaState = { map: null, failed: false };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load() {
  if (state.map || inflight) return;
  inflight = fetch("/exercise-media.json")
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<Record<string, MediaEntry>>;
    })
    .then((map) => {
      state = { map, failed: false };
    })
    .catch(() => {
      state = { map: null, failed: true };
      inflight = null; // allow a retry next time a detail screen opens
    })
    .finally(() => listeners.forEach((l) => l()));
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Media for one exercise: `loading` until the (cached) lookup file arrives, then the entry or null. */
export function useExerciseMedia(exerciseId: string): { entry: MediaEntry | null; loading: boolean } {
  const s = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => {
    load();
  }, []);
  return { entry: s.map?.[exerciseId] ?? null, loading: !s.map && !s.failed };
}
