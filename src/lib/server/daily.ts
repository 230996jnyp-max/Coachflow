import "server-only";
import { isLocalTestMode } from "./db";
import { HttpError } from "./http";

/*
 * Video calls for consults, through Daily (daily.co). Each consult gets one private room for two people that Daily closes by itself when
 * the hour is up (everyone is removed at that moment), and each person joins with their own short-lived meeting token, so the room
 * address alone lets nobody in. Needs DAILY_API_KEY. Local tests can point DAILY_API_BASE at a stand-in.
 */

export const dailyReady = (): boolean => !!process.env.DAILY_API_KEY;

function base(): string {
  const fake = process.env.DAILY_API_BASE;
  return fake && isLocalTestMode() ? fake.replace(/\/$/, "") : "https://api.daily.co/v1";
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const key = process.env.DAILY_API_KEY;
  if (!key) throw new HttpError(503, "Video calls aren't set up on this server yet.");
  const res = await fetch(base() + path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    if (init.method === "DELETE" && res.status === 404) return {} as T;
    throw new HttpError(502, "The video service didn't answer. Please try again.");
  }
  return (await res.json()) as T;
}

/** A private two-person room that closes (and removes everyone) at `exp`. Returns its name and address. */
export async function createRoom(name: string, exp: Date): Promise<{ name: string; url: string }> {
  const r = await call<{ name: string; url: string }>("/rooms", {
    body: {
      name,
      privacy: "private",
      properties: {
        exp: Math.floor(exp.getTime() / 1000),
        eject_at_room_exp: true,
        max_participants: 2,
        enable_chat: true,
        enable_screenshare: true,
        enable_prejoin_ui: true,
        enable_recording: false,
      },
    },
  });
  return { name: r.name, url: r.url };
}

/** A token that lets one person into one room until `exp` (the trainer's is the room owner's). */
export async function meetingToken(room: string, userName: string, owner: boolean, exp: Date): Promise<string> {
  const r = await call<{ token: string }>("/meeting-tokens", {
    body: { properties: { room_name: room, user_name: userName.slice(0, 60), is_owner: owner, exp: Math.floor(exp.getTime() / 1000), eject_at_token_exp: true } },
  });
  return r.token;
}

/** Closes a room straight away (a consult ended early). Never throws. */
export async function deleteRoom(name: string): Promise<void> {
  try {
    await call(`/rooms/${encodeURIComponent(name)}`, { method: "DELETE" });
  } catch {
    /* it closes by itself at the end of the hour anyway */
  }
}
