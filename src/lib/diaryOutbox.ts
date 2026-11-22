"use client";

import { del, get, set } from "idb-keyval";
import type { Candidate, DietaryProfile, FoodComment, FoodEntry, MealType, NutritionTargets } from "./nutrition";
import { setPending } from "./syncStatus";

/*
 * Food diary with no signal. A change (add, edit, delete) is first kept on this phone and then sent; when the server can't be reached
 * it waits here and goes out as soon as the signal is back. An added food carries an id picked on the phone, so if the signal drops
 * after the server saved it but before the answer arrived, sending it again stores it once (see addEntry on the server).
 * The last diary days the person looked at are also kept, so the diary can be read offline. Both are this person's own food only,
 * and the copy is removed when they sign out on purpose.
 */

export type DiaryOp = { id: string; op: "add" | "update" | "delete"; entry?: FoodEntry; at: number };

type ApiFn = (path: string, init?: { method?: string; body?: unknown }) => Promise<{ ok: boolean; status: number; error?: string }>;

const outboxKey = (userId: string) => `coachflow-diary-outbox-v1:${userId}`;
const cacheKey = (userId: string) => `coachflow-diary-cache-v1:${userId}`;

/** What the server wants for one food in a diary day. */
export function foodBody(c: Omit<Candidate, "key"> | FoodEntry, day: string, meal: MealType, loggedAt?: string) {
  return {
    day,
    meal,
    ...(loggedAt ? { loggedAt } : {}),
    name: c.name,
    ...(c.brand ? { brand: c.brand } : {}),
    amountText: c.amountText,
    ...(c.grams ? { grams: c.grams } : {}),
    kcal: c.kcal,
    protein: c.protein,
    carbs: c.carbs,
    fat: c.fat,
    ...(c.per100 ? { per100: c.per100 } : {}),
    source: c.source,
    approx: c.approx,
    ...(c.confidence ? { confidence: c.confidence } : {}),
    ...(c.contains ? { contains: c.contains } : {}),
  };
}

/** An id for a food added on the phone: 24 hex characters, the shape the server accepts. */
export function newFoodId(): string {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `fe_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Folds a new change into the waiting ones for the same food: add+edit stays one add, add+delete cancels out, edit+delete is a delete. */
export function mergeOp(ops: DiaryOp[], next: DiaryOp): DiaryOp[] {
  const prev = ops.find((o) => o.id === next.id);
  const rest = ops.filter((o) => o.id !== next.id);
  if (!prev) return [...rest, next];
  if (prev.op === "add") return next.op === "delete" ? rest : [...rest, { ...prev, entry: next.entry ?? prev.entry, at: next.at }];
  return [...rest, next];
}

/** The server's entries for a range of days with the waiting changes applied on top, so the diary shows what the person just did. */
export function overlayEntries(entries: FoodEntry[], ops: DiaryOp[], from: string, to: string): FoodEntry[] {
  if (!ops.length) return entries;
  const gone = new Set(ops.filter((o) => o.op === "delete").map((o) => o.id));
  const edited = new Map(ops.filter((o) => o.op === "update" && o.entry).map((o) => [o.id, o.entry as FoodEntry]));
  const out = entries.filter((e) => !gone.has(e.id)).map((e) => edited.get(e.id) ?? e);
  const have = new Set(out.map((e) => e.id));
  for (const o of ops) if (o.op === "add" && o.entry && !have.has(o.entry.id)) out.push(o.entry);
  return out.filter((e) => e.day >= from && e.day <= to).sort((a, b) => a.day.localeCompare(b.day) || a.loggedAt.localeCompare(b.loggedAt));
}

/** Every yyyy-MM-dd from `from` to `to` (inclusive). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end && out.length < 400; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

interface DiaryCache {
  days: Record<string, FoodEntry[]>;
  targets: NutritionTargets | null;
  settings: DietaryProfile;
  comments: FoodComment[];
}

const KEEP_DAYS = 60;

/** The diary pieces the person last looked at, as a Bundle-shaped object (or null when nothing was kept). Pure: takes the stored copy. */
export function bundleFromCache(c: DiaryCache | undefined, from: string, to: string) {
  if (!c) return null;
  const entries = daysBetween(from, to).flatMap((d) => c.days[d] ?? []);
  return { entries, targets: c.targets, settings: c.settings, comments: c.comments.filter((x) => x.day >= from && x.day <= to), self: true };
}

/** Merges a freshly loaded range into the kept copy: the days in the range are replaced, older ones beyond 60 days are dropped. Pure. */
export function mergeIntoCache(c: DiaryCache | undefined, today: string, from: string, to: string, b: { entries: FoodEntry[]; targets: NutritionTargets | null; settings: DietaryProfile; comments: FoodComment[] }): DiaryCache {
  const days: Record<string, FoodEntry[]> = { ...(c?.days ?? {}) };
  for (const d of daysBetween(from, to)) days[d] = [];
  for (const e of b.entries) (days[e.day] ??= []).push(e);
  const oldest = new Date(Date.parse(`${today}T00:00:00Z`) - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  for (const d of Object.keys(days)) if (d < oldest) delete days[d];
  const kept = (c?.comments ?? []).filter((x) => x.day < from || x.day > to);
  return { days, targets: b.targets, settings: b.settings, comments: [...kept, ...b.comments].filter((x) => x.day >= oldest) };
}

class DiaryOutbox {
  private userId: string | null = null;
  private call: ApiFn | null = null;
  private ops: DiaryOp[] = [];
  private flushing = false;
  private again = false;
  private refused = new Map<string, string>();
  private listeners = new Set<() => void>();
  /** Bumped whenever the waiting list or the server's view changed, so screens reload. */
  version = 0;

  /** After sign-in: remembers who this is and how to reach the server, brings back what an earlier visit left unsent, and sends it. */
  async bind(call: ApiFn, userId: string): Promise<void> {
    this.call = call;
    if (this.userId !== userId) {
      this.userId = userId;
      this.ops = [];
    }
    try {
      const saved = await get<DiaryOp[]>(outboxKey(userId));
      if (Array.isArray(saved) && this.userId === userId) for (const o of saved) if (!this.ops.some((x) => x.id === o.id)) this.ops.push(o);
    } catch {
      /* private window or storage blocked: the in-memory list still retries */
    }
    this.count();
    void this.flush();
  }

  /** Signing out: stops using this person's list (the unsent changes stay on the device for their next sign-in). */
  unbind(): void {
    this.userId = null;
    this.call = null;
    this.ops = [];
    this.count();
  }

  get waiting(): DiaryOp[] {
    return this.ops;
  }

  pendingIds(): Set<string> {
    return new Set(this.ops.map((o) => o.id));
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  private changed() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  private count() {
    setPending("diary", this.ops.length);
  }

  private async persist(): Promise<void> {
    const me = this.userId;
    if (!me) return;
    try {
      if (this.ops.length) await set(outboxKey(me), this.ops);
      else await del(outboxKey(me));
    } catch {
      /* ignore */
    }
  }

  /** Keeps a change and sends it. Resolves with `queued: true` when it is waiting on the phone, or an error when the server refused it. */
  async submit(op: Omit<DiaryOp, "at">): Promise<{ error: string | null; queued: boolean }> {
    if (!this.userId || !this.call) return { error: "Sign in to use the food diary.", queued: false };
    this.refused.delete(op.id);
    this.ops = mergeOp(this.ops, { ...op, at: Date.now() });
    this.count();
    this.changed();
    await this.persist();
    await this.flush();
    const refused = this.refused.get(op.id);
    if (refused) {
      this.refused.delete(op.id);
      return { error: refused, queued: false };
    }
    return { error: null, queued: this.ops.some((o) => o.id === op.id) };
  }

  /** Sends what is waiting, oldest first. Stops at the first one the signal can't carry; the next try is on the next signal. */
  async flush(): Promise<void> {
    const call = this.call;
    const me = this.userId;
    if (!call || !me) return;
    if (this.flushing) {
      this.again = true;
      return;
    }
    this.flushing = true;
    let sent = false;
    try {
      do {
        this.again = false;
        for (const op of [...this.ops].sort((a, b) => a.at - b.at)) {
          if (this.userId !== me) return;
          const r =
            op.op === "add" && op.entry
              ? await call("/api/nutrition", { body: { entry: { id: op.id, ...foodBody(op.entry, op.entry.day, op.entry.meal, op.entry.loggedAt) } } })
              : op.op === "update" && op.entry
                ? await call(`/api/nutrition/${op.id}`, { method: "PUT", body: { entry: foodBody(op.entry, op.entry.day, op.entry.meal, op.entry.loggedAt) } })
                : await call(`/api/nutrition/${op.id}`, { method: "DELETE" });
          const retry = !r.ok && (r.status === 0 || r.status >= 500 || r.status === 429);
          if (retry) return; // no signal: keep everything, try again later
          // Saved, or refused for good (the server said no): either way it leaves the list; a refusal is told to whoever just made it.
          this.ops = this.ops.filter((o) => !(o.id === op.id && o.at === op.at));
          if (!r.ok) this.refused.set(op.id, r.error ?? "That couldn't be saved.");
          else sent = true;
          this.count();
          await this.persist();
        }
      } while (this.again);
    } finally {
      this.flushing = false;
      if (sent || this.ops.length === 0) this.changed();
    }
  }

  /* ---- the kept copy of the days the person looked at ---- */
  async remember(today: string, from: string, to: string, b: { entries: FoodEntry[]; targets: NutritionTargets | null; settings: DietaryProfile; comments: FoodComment[] }): Promise<void> {
    const me = this.userId;
    if (!me) return;
    try {
      const prev = await get<DiaryCache>(cacheKey(me));
      await set(cacheKey(me), mergeIntoCache(prev, today, from, to, b));
    } catch {
      /* ignore */
    }
  }

  async recall(from: string, to: string) {
    const me = this.userId;
    if (!me) return null;
    try {
      return bundleFromCache(await get<DiaryCache>(cacheKey(me)), from, to);
    } catch {
      return null;
    }
  }

  /** Signing out on purpose: the kept copy of the diary goes. (Anything still unsent stays, so it is not lost.) */
  async forget(userId: string): Promise<void> {
    try {
      await del(cacheKey(userId));
    } catch {
      /* ignore */
    }
  }
}

export const diaryOutbox = new DiaryOutbox();
