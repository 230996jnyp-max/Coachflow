import { useSyncExternalStore } from "react";

/** A short billing message shown as a toast (for example after a client is added: what the roster will cost on the next renewal). */
let message: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showBillingNotice(text: string | null | undefined) {
  if (!text) return;
  message = text;
  emit();
  clearTimeout(timer);
  timer = setTimeout(dismissBillingNotice, 12_000);
}

export function dismissBillingNotice() {
  message = null;
  clearTimeout(timer);
  emit();
}

export function useBillingNotice(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => message,
    () => null,
  );
}
