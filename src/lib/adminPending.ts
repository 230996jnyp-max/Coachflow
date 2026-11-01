import { useSyncExternalStore } from "react";
import { api } from "./store";

/** How many coach sign-up requests are waiting for the owner (shown as a badge on Admin and on the Pending Approvals tab). */
let count = 0;
const listeners = new Set<() => void>();

export function setPendingCount(n: number) {
  if (n === count) return;
  count = n;
  listeners.forEach((l) => l());
}

/** Owner only: re-reads the number from the server. */
export async function refreshPendingCount(): Promise<void> {
  const r = await api<{ pending: number }>("/api/admin/requests?count=1");
  if (r.ok && r.data) setPendingCount(r.data.pending);
}

export function usePendingCoachRequests(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => count,
    () => 0,
  );
}
