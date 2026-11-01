import { useSyncExternalStore } from "react";

/*
 * "Choose your niche" step. It comes right after every sign-in (after the set-your-password screen, if there is one) and before the
 * dashboard, and can be opened again from Settings. It is a step in the sign-in sequence, not a page of its own, so this is just a
 * flag that survives a refresh: set at sign-in, cleared when the coach continues.
 */
const KEY = "coachflow-niche-pending";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function requestNicheStep() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* private mode: the step simply doesn't repeat */
  }
  emit();
}

export function finishNicheStep() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  emit();
}

export function useNicheStepPending(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      window.addEventListener("storage", cb);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", cb);
      };
    },
    read,
    () => false,
  );
}
