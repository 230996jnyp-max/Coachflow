"use client";

import { useSyncExternalStore } from "react";

/*
 * Whether the server can be reached, and how many changes are waiting on this device to be sent. Every part of the app that keeps
 * unsent changes (workouts, food diary, check-ins) reports its count here, so one banner can say "Offline" and "N waiting to sync".
 * No data lives here, only numbers.
 */

export interface SyncStatus {
  /** The browser says it has a network AND the last request to the server got an answer. */
  online: boolean;
  /** The app was opened with no signal, from the copy kept on this phone. */
  offlineOpen: boolean;
  /** Changes made on this device that the server does not have yet. */
  pending: number;
  /** True for a few seconds after waiting changes finished sending. */
  justSynced: boolean;
}

const JUST_SYNCED_MS = 4000;

let reachable = true;
let offlineOpen = false;
const counts = new Map<string, number>();
let syncedAt = 0;
/** When changes started waiting, and whether the phone was offline while any waited (a short wait while online is not worth announcing). */
let unsentSince = 0;
let sawOffline = false;
let current: SyncStatus = { online: true, offlineOpen: false, pending: 0, justSynced: false };
const listeners = new Set<() => void>();
const backOnline = new Set<() => void>();
let syncedTimer: ReturnType<typeof setTimeout> | undefined;
let wired = false;

const browserOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

function recompute() {
  const pending = [...counts.values()].reduce((a, b) => a + b, 0);
  if (pending > 0 && (!reachable || !browserOnline())) sawOffline = true;
  const next: SyncStatus = { online: reachable && browserOnline(), offlineOpen, pending, justSynced: Date.now() - syncedAt < JUST_SYNCED_MS };
  if (next.online === current.online && next.offlineOpen === current.offlineOpen && next.pending === current.pending && next.justSynced === current.justSynced) return;
  current = next;
  listeners.forEach((l) => l());
}

function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("online", recompute);
  window.addEventListener("offline", recompute);
}

/** Called after every request to the server: whether it answered (any answer, even an error) or the network failed. */
export function reportReachable(ok: boolean) {
  if (ok === reachable) return;
  reachable = ok;
  recompute();
  if (ok) backOnline.forEach((cb) => cb());
}

/** One kind of unsent change reports how many it holds (0 when none). */
export function setPending(source: string, n: number) {
  const before = [...counts.values()].reduce((a, b) => a + b, 0);
  if (n > 0) counts.set(source, n);
  else counts.delete(source);
  const after = [...counts.values()].reduce((a, b) => a + b, 0);
  if (before === 0 && after > 0) unsentSince = Date.now();
  if (before > 0 && after === 0) {
    const worthSaying = sawOffline || offlineOpen || Date.now() - unsentSince > 6000;
    sawOffline = false;
    if (worthSaying) syncedAt = Date.now();
    if (worthSaying) {
      if (syncedTimer) clearTimeout(syncedTimer);
      syncedTimer = setTimeout(recompute, JUST_SYNCED_MS + 50);
    }
  }
  recompute();
}

export function setOfflineOpen(on: boolean) {
  if (on === offlineOpen) return;
  offlineOpen = on;
  recompute();
}

/** Runs `cb` each time the server becomes reachable again after a failed request. Returns the function that stops it. */
export function onBackOnline(cb: () => void): () => void {
  backOnline.add(cb);
  return () => {
    backOnline.delete(cb);
  };
}

export const isReachable = () => reachable && browserOnline();

/** Forgets everything (signing out). */
export function resetSyncStatus() {
  counts.clear();
  offlineOpen = false;
  syncedAt = 0;
  unsentSince = 0;
  sawOffline = false;
  recompute();
}

function subscribe(l: () => void) {
  wire();
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, () => current, () => current);
}

/** For tests: the numbers as they stand. */
export const __syncStatusNow = () => current;
