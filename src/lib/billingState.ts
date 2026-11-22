import { useEffect, useSyncExternalStore } from "react";
import type { BillingInfo } from "./billing";
import { api } from "./store";

/** The signed-in person's billing (trial badge, paywall, payment warning). Loaded once the app opens and refreshed now and then. */
let info: BillingInfo | null = null;
const listeners = new Set<() => void>();

const set = (next: BillingInfo | null) => {
  info = next;
  listeners.forEach((l) => l());
};

export async function refreshBilling(): Promise<void> {
  const r = await api<BillingInfo>("/api/billing");
  if (r.ok && r.data) set(r.data);
  else if (r.status === 401) set(null);
}

export function clearBilling() {
  set(null);
}

/** Starts Stripe Checkout (subscribe) or the customer portal (manage). Returns an error message, or null after sending the browser away. */
export async function openStripe(kind: "checkout" | "portal"): Promise<string | null> {
  const r = await api<{ url: string }>(`/api/stripe/${kind}`, { body: {} });
  if (!r.ok || !r.data?.url) return r.error ?? "Couldn't open Stripe. Please try again.";
  window.location.assign(r.data.url);
  return null;
}

/** A gym owner starts Stripe Checkout (subscribe) or the customer portal (manage the card) for the gym. Returns an error message, or null after sending the browser away. */
export async function openGymStripe(kind: "checkout" | "portal"): Promise<string | null> {
  const r = await api<{ url: string }>("/api/gym/billing", { body: { action: kind } });
  if (!r.ok || !r.data?.url) return r.error ?? "Couldn't open Stripe. Please try again.";
  window.location.assign(r.data.url);
  return null;
}

/** Keeps the billing info fresh for a signed-in person. `userId` changes when someone signs in or out. */
export function useBillingLoader(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;
    void refreshBilling();
    const t = setInterval(() => void refreshBilling(), 5 * 60_000);
    const onBlocked = () => void refreshBilling();
    window.addEventListener("coachflow-billing", onBlocked);
    return () => {
      clearInterval(t);
      window.removeEventListener("coachflow-billing", onBlocked);
      set(null); // someone else may sign in next: never show the previous person's billing
    };
  }, [userId]);
}

export function useBilling(): BillingInfo | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => info,
    () => null,
  );
}
