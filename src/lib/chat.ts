"use client";

import { useSyncExternalStore } from "react";
import type { ChatMessage } from "./types";

/*
 * Client side of the chat. Messages live encrypted in Postgres and are served by /api/chat, which only returns
 * conversations the signed-in user belongs to. This module polls for new messages, tracks what has been read,
 * and raises in-app toasts + browser notifications for incoming ones.
 *
 * Threads: `c:<clientId>` (coach ↔ client) and `o:<coachId>` (owner ↔ coach).
 */

export const clientThread = (clientId: string) => `c:${clientId}`;
export const coachThread = (coachId: string) => `o:${coachId}`;

export interface LocalMessage extends ChatMessage {
  pending?: boolean;
  failed?: boolean;
}

export interface Toast {
  id: string;
  thread: string;
  title: string;
  body: string;
}

interface ChatState {
  loaded: boolean;
  online: boolean;
  messages: Record<string, LocalMessage[]>;
  lastRead: Record<string, string>;
  toasts: Toast[];
}

const INITIAL: ChatState = { loaded: false, online: true, messages: {}, lastRead: {}, toasts: [] };
let state: ChatState = INITIAL;
const listeners = new Set<() => void>();
const set = (next: ChatState) => {
  state = next;
  listeners.forEach((l) => l());
};

let meId: string | null = null;
let activeThread: string | null = null;
let requestedThread: string | null = null;
let cursor = "";
let initial = true;
let timer: ReturnType<typeof setInterval> | undefined;
let polling = false;
let generation = 0;

const readKey = (uid: string) => `coachflow-chatread-${uid}`;

function loadRead(uid: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(readKey(uid)) ?? "{}");
  } catch {
    return {};
  }
}
function saveRead(uid: string, v: Record<string, string>) {
  try {
    localStorage.setItem(readKey(uid), JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

function merge(incoming: ChatMessage[], advance = true): { added: ChatMessage[] } {
  const messages = { ...state.messages };
  const added: ChatMessage[] = [];
  for (const m of incoming) {
    const list = messages[m.thread] ?? [];
    const i = list.findIndex((x) => x.id === m.id);
    if (i >= 0) {
      const copy = [...list];
      copy[i] = { ...list[i], ...m, pending: false, failed: false };
      messages[m.thread] = copy;
    } else {
      const withoutTmp = list.filter((x) => !(x.pending && x.fromId === m.fromId && x.text === m.text));
      messages[m.thread] = [...withoutTmp, m].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      added.push(m);
    }
    if (advance && m.createdAt > cursor) cursor = m.createdAt;
  }
  set({ ...state, messages });
  return { added };
}

export function showBrowserNotification(title: string, body: string, tag: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const opts: NotificationOptions = { body, tag, icon: "/pwa-icon/192", data: { url: "/messages" } };
  const fallback = () => {
    try {
      const n = new Notification(title, opts);
      n.onclick = () => {
        window.focus();
        window.open("/messages", "_self");
      };
    } catch {
      /* some mobile browsers only allow service-worker notifications */
    }
  };
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => (reg ? reg.showNotification(title, opts) : fallback()))
      .catch(fallback);
  } else fallback();
}

function onIncoming(added: ChatMessage[]) {
  if (!meId || initial) return;
  for (const m of added) {
    if (m.fromId === meId) continue;
    const viewing = activeThread === m.thread && typeof document !== "undefined" && document.visibilityState === "visible";
    if (viewing) {
      markRead(m.thread);
      continue;
    }
    const who = m.fromRole === "OWNER" ? `${m.fromName} • App Owner` : m.fromName;
    const toast: Toast = { id: m.id, thread: m.thread, title: who, body: m.text.length > 120 ? m.text.slice(0, 117) + "…" : m.text };
    set({ ...state, toasts: [...state.toasts.filter((t) => t.id !== toast.id), toast].slice(-3) });
    showBrowserNotification(`New message from ${who}`, toast.body, m.thread);
  }
}

async function poll(threads: string[], gen: number) {
  if (polling || threads.length === 0) return;
  polling = true;
  try {
    const q = new URLSearchParams({ threads: threads.join(",") });
    // Re-read a few seconds of overlap so a message committed slightly out of order is never skipped (merge de-dupes by id).
    if (cursor) q.set("after", new Date(new Date(cursor).getTime() - 3000).toISOString());
    const res = await fetch(`/api/chat?${q.toString()}`, { cache: "no-store", credentials: "same-origin" });
    if (gen !== generation) return;
    if (!res.ok) throw new Error(String(res.status));
    const { messages } = (await res.json()) as { messages: ChatMessage[] };
    const { added } = merge(messages);
    if (initial) {
      initial = false;
      set({ ...state, loaded: true, online: true });
    } else {
      onIncoming(added);
      if (!state.online) set({ ...state, online: true });
    }
  } catch {
    if (gen === generation && (state.online || !state.loaded)) set({ ...state, online: false, loaded: true });
  } finally {
    polling = false;
  }
}

/** Starts polling for the given conversations. Returns a stop function. */
export function startChatSync(userId: string, threads: string[]): () => void {
  meId = userId;
  initial = true;
  cursor = "";
  const gen = ++generation;
  set({ loaded: false, online: true, messages: {}, lastRead: loadRead(userId), toasts: [] });
  // Adaptive polling keeps server load low: 4s on the Messages screen, 20s elsewhere, 120s in a background tab.
  let waited = 0;
  const tick = () => {
    waited++;
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    const every = hidden ? 120 : activeThread ? 4 : 20;
    if (waited < every) return;
    waited = 0;
    void poll(threads, gen);
  };
  void poll(threads, gen);
  timer = setInterval(tick, 1000);
  const onVis = () => document.visibilityState === "visible" && void poll(threads, gen);
  document.addEventListener("visibilitychange", onVis);
  return () => {
    if (timer) clearInterval(timer);
    document.removeEventListener("visibilitychange", onVis);
  };
}

export function setActiveThread(thread: string | null) {
  activeThread = thread;
  if (thread) markRead(thread);
}

/** Lets another screen (e.g. the admin page) open Messages on a specific conversation. */
export function requestThread(thread: string) {
  requestedThread = thread;
}
export function takeRequestedThread(): string | null {
  const t = requestedThread;
  requestedThread = null;
  return t;
}

export function markRead(thread: string) {
  if (!meId) return;
  const list = state.messages[thread] ?? [];
  const latest = list.length ? list[list.length - 1].createdAt : "";
  if (!latest || state.lastRead[thread] === latest) return;
  const lastRead = { ...state.lastRead, [thread]: latest };
  saveRead(meId, lastRead);
  set({ ...state, lastRead });
}

export function dismissToast(id: string) {
  set({ ...state, toasts: state.toasts.filter((t) => t.id !== id) });
}

export function unreadFor(s: ChatState, userId: string, thread: string): number {
  const readAt = s.lastRead[thread] ?? "";
  return (s.messages[thread] ?? []).filter((m) => m.fromId !== userId && m.createdAt > readAt).length;
}

export interface SendArgs {
  thread: string;
  text: string;
  notifyEmail: boolean;
  /** Needed only for the optimistic bubble; the server decides the real sender. */
  me: { id: string; name: string; role: ChatMessage["fromRole"] };
}

export async function sendChat(args: SendArgs, retryId?: string): Promise<void> {
  const tmpId = retryId ?? `tmp_${Math.random().toString(36).slice(2, 10)}`;
  const tmp: LocalMessage = {
    id: tmpId,
    thread: args.thread,
    fromId: args.me.id,
    fromRole: args.me.role,
    fromName: args.me.name,
    text: args.text,
    createdAt: new Date().toISOString(),
    pending: true,
  };
  const withTmp = (list: LocalMessage[]) => (list.some((m) => m.id === tmpId) ? list.map((m) => (m.id === tmpId ? tmp : m)) : [...list, tmp]);
  set({ ...state, messages: { ...state.messages, [args.thread]: withTmp(state.messages[args.thread] ?? []) } });
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ thread: args.thread, text: args.text, notifyEmail: args.notifyEmail }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const { message } = (await res.json()) as { message: ChatMessage };
    const list = (state.messages[args.thread] ?? []).filter((m) => m.id !== tmpId);
    set({ ...state, messages: { ...state.messages, [args.thread]: list } });
    merge([message], false);
  } catch {
    const list = (state.messages[args.thread] ?? []).map((m) => (m.id === tmpId ? { ...m, pending: false, failed: true } : m));
    set({ ...state, messages: { ...state.messages, [args.thread]: list } });
  }
}

/** Owner → every active coach. Returns an error message or null. */
export async function broadcastChat(text: string): Promise<string | null> {
  try {
    const res = await fetch("/api/chat/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(60_000),
    });
    const data = (await res.json()) as { messages?: ChatMessage[]; error?: string };
    if (!res.ok) return data.error ?? "Could not send the announcement.";
    merge(data.messages ?? [], false);
    return null;
  } catch {
    return "Could not reach the server.";
  }
}

export function discardFailed(thread: string, id: string) {
  set({ ...state, messages: { ...state.messages, [thread]: (state.messages[thread] ?? []).filter((m) => m.id !== id) } });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useChat(): ChatState {
  return useSyncExternalStore(subscribe, () => state, () => INITIAL);
}
