"use client";

import { useSyncExternalStore } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
let wired = false;

function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    listeners.forEach((l) => l());
  });
}

function subscribe(l: () => void) {
  wire();
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export interface PwaInfo {
  canPrompt: boolean;
  isIOS: boolean;
  standalone: boolean;
}

let cache: PwaInfo = { canPrompt: false, isIOS: false, standalone: false };
const SERVER: PwaInfo = cache;

function snapshot(): PwaInfo {
  if (typeof window === "undefined") return SERVER;
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 1);
  const standalone =
    installed ||
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const canPrompt = deferred !== null;
  if (cache.canPrompt !== canPrompt || cache.isIOS !== isIOS || cache.standalone !== standalone) {
    cache = { canPrompt, isIOS, standalone };
  }
  return cache;
}

export function usePwa(): PwaInfo & { promptInstall: () => Promise<boolean> } {
  const info = useSyncExternalStore(subscribe, snapshot, () => SERVER);
  return {
    ...info,
    promptInstall: async () => {
      if (!deferred) return false;
      await deferred.prompt();
      const choice = await deferred.userChoice;
      deferred = null;
      listeners.forEach((l) => l());
      return choice.outcome === "accepted";
    },
  };
}
