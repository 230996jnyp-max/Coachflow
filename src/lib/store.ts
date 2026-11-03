"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { requestNicheStep } from "./nicheGate";
import { del, get, set } from "idb-keyval";
import { parseISO } from "date-fns";
import { SEED_EXERCISES } from "@/data/exercises";
import { DB_VERSION, DEFAULT_SETTINGS, createEmptyDB } from "./seed";
import { annotatePRs } from "./stats";
import { sendInvite } from "./notify";
import { clearActive, isIdleStale, markActive, readLastActive, rememberUsername, setIdleNotice } from "./idle";
import { SyncQueue, type SyncResult } from "./syncQueue";
import type { TravelNeighbor } from "./travel";
import { uid } from "./utils";
import type {
  AppNotification,
  AppSettings,
  AttendanceStats,
  AvailabilitySlot,
  BodyMetricLog,
  Booking,
  BookingStatus,
  ClientGoal,
  ClientProfile,
  CreditLogEntry,
  DB,
  Exercise,
  GroupRequest,
  GroupSession,
  GymLocation,
  PlaceInfo,
  ProgressPhoto,
  Role,
  RoutineTemplate,
  SessionFocus,
  SetType,
  TrackingSchema,
  UnitSystem,
  User,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from "./types";

/*
 * Data layer.
 *  - Accounts, client profiles (encrypted at rest) and chat live on the server (Neon Postgres) and are fetched after
 *    login; the signed-in session is an httpOnly cookie, so the browser never holds a password or a token.
 *  - Bookings, availability, gyms, workouts, routine templates and custom exercises also live in the database (workouts
 *    and routines are encrypted). The browser edits its copy instantly and a write-behind queue (SyncQueue) saves each
 *    change; a poll brings in changes made on other devices.
 *  - Body logs, progress photos and personal settings are still stored per device (IndexedDB), in a separate dataset
 *    for each signed-in user.
 */

const localKey = (userId: string) => `coachflow-local-v2:${userId}`;

interface State {
  ready: boolean;
  db: DB;
  sessionUserId: string | null;
}

const INITIAL: State = { ready: false, db: createEmptyDB(), sessionUserId: null };
let state: State = INITIAL;
const listeners = new Set<() => void>();
let initStarted = false;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
/** True after this device's old local data has been uploaded and the server copy loaded. */
let cloudSafe = false;
/** Server time of the last successful training sync (workouts are fetched incrementally from here). */
let trainingSince: string | undefined;
/** The first load only brought recent workouts; the next refresh must read everything. */
let trainingPartial = false;
/** Set once the first server load finished, so changes made before it are not mistaken for edits. */
let trainingLoaded = false;

function emit() {
  listeners.forEach((l) => l());
}
function setState(next: State) {
  state = next;
  emit();
}

/** Writes this user's device-local data. Account data (users/clients) is never written to the browser. */
function flush() {
  const uidNow = state.sessionUserId;
  if (!uidNow) return;
  // Once workouts/routines/custom exercises are safely in the database, the device keeps no copy of them.
  const cloud = cloudSafe ? { workouts: [], templates: [], exercises: SEED_EXERCISES } : {};
  set(localKey(uidNow), { ...state.db, ...cloud, users: [], clients: [], gyms: [], slots: [], bookings: [], groups: [], groupRequests: [], notifications: [] }).catch(() => undefined);
}

function persist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(flush, 350);
}

function mutate(fn: (db: DB) => DB) {
  const prev = state.db;
  const next = fn(prev);
  setState({ ...state, db: next });
  track(prev, next);
  persist();
}

/* ---------------- Training data sync (workouts, routine templates, custom exercises) ---------------- */
function classify(r: ApiResult<unknown>): SyncResult {
  if (r.ok) return "ok";
  if (r.status === 0 || r.status >= 500 || r.status === 429) return "retry";
  return "drop";
}

const workoutQ = new SyncQueue({
  delay: 900,
  save: async (id, o) => {
    const w = state.db.workouts.find((x) => x.id === id);
    if (!w) return "ok";
    return classify(await api(`/api/training/workouts/${id}`, { method: "PUT", body: { workout: w }, keepalive: o.keepalive }));
  },
  remove: async (id, o) => classify(await api(`/api/training/workouts/${id}`, { method: "DELETE", keepalive: o.keepalive })),
  onDrop: () => void refreshTraining(true),
  onSettled: () => persistOutbox(),
});

const templateQ = new SyncQueue({
  delay: 400,
  save: async (id, o) => {
    const t = state.db.templates.find((x) => x.id === id);
    if (!t) return "ok";
    return classify(await api(`/api/training/templates/${id}`, { method: "PUT", body: { template: t }, keepalive: o.keepalive }));
  },
  remove: async (id, o) => classify(await api(`/api/training/templates/${id}`, { method: "DELETE", keepalive: o.keepalive })),
  onDrop: () => void refreshTraining(true),
});

const exerciseQ = new SyncQueue({
  delay: 300,
  save: async (id, o) => {
    const x = state.db.exercises.find((e) => e.id === id);
    if (!x) return "ok";
    return classify(await api(`/api/training/exercises/${id}`, { method: "PUT", body: { exercise: x }, keepalive: o.keepalive }));
  },
  remove: async () => "ok",
  onDrop: () => void refreshTraining(true),
});

function diffById<T extends { id: string }>(before: T[], after: T[], q: SyncQueue, removals = true) {
  if (before === after) return;
  const old = new Map(before.map((x) => [x.id, x]));
  const seen = new Set<string>();
  for (const x of after) {
    seen.add(x.id);
    if (old.get(x.id) !== x) q.save(x.id);
  }
  if (removals) for (const id of old.keys()) if (!seen.has(id)) q.remove(id);
}

/** Queues a save/delete for every workout, routine or custom exercise that this mutation changed. */
function track(prev: DB, next: DB) {
  if (!state.sessionUserId || !trainingLoaded) return;
  diffById(prev.workouts, next.workouts, workoutQ);
  diffById(prev.templates, next.templates, templateQ);
  if (prev.exercises !== next.exercises) diffById(prev.exercises.filter((e) => e.custom), next.exercises.filter((e) => e.custom), exerciseQ, false);
  if (prev.workouts !== next.workouts) persistOutbox();
}

/** Sends every pending change now (used when the tab is hidden or closed). */
function flushTraining(keepalive: boolean) {
  void exerciseQ.flush(keepalive).then(() => templateQ.flush(keepalive)).then(() => workoutQ.flush(keepalive));
}

/* ---------------- Unsent changes survive a closed tab or a dead connection ---------------- */
/*
 * Workout changes are sent in the background. While they have not reached the server (no signal in a basement gym), a copy of
 * the unsent workouts, and of any "end session" call still waiting to go out, is kept on this device and sent after the next
 * sign-in if the tab was closed in between.
 */
const outboxKey = (userId: string) => `coachflow-outbox-v1:${userId}`;

export interface PendingEnd {
  kind: "BOOKING" | "GROUP";
  id: string;
  marks: { clientId: string; mark: "PRESENT" | "NO_SHOW"; deduct?: boolean }[];
  workoutIds: string[];
}
let pendingEnds: PendingEnd[] = [];
let outboxTimer: ReturnType<typeof setTimeout> | undefined;
/** Set while signing out so a late timer can't delete what was just kept for the next sign-in. */
let outboxFrozen = false;
let sendingEnds = false;

let unsentN = 0;
const unsentListeners = new Set<() => void>();
function refreshUnsent() {
  const u = workoutQ.unsent();
  const n = u.save.length + u.remove.length + pendingEnds.length + (workoutQ.settled || u.save.length + u.remove.length ? 0 : 1);
  if (n === unsentN) return;
  unsentN = n;
  unsentListeners.forEach((l) => l());
}
/** How many changes (workouts, or a finished session) have not reached the server yet. */
export function useUnsent(): number {
  return useSyncExternalStore(
    (l) => {
      unsentListeners.add(l);
      return () => {
        unsentListeners.delete(l);
      };
    },
    () => unsentN,
    () => 0,
  );
}

async function writeOutbox(): Promise<void> {
  const me = state.sessionUserId;
  if (!me || outboxFrozen) return;
  const u = workoutQ.unsent();
  const ws = state.db.workouts.filter((w) => u.save.includes(w.id));
  try {
    if (!ws.length && !u.remove.length && !pendingEnds.length) await del(outboxKey(me));
    else await set(outboxKey(me), { workouts: ws, removed: u.remove, ends: pendingEnds });
  } catch {
    /* private window or storage blocked: the in-memory queue still retries */
  }
}

function persistOutbox() {
  refreshUnsent();
  if (outboxTimer) clearTimeout(outboxTimer);
  outboxTimer = setTimeout(() => void writeOutbox(), 250);
}

/** After sign-in: puts back whatever this device still had unsent, then sends it. */
async function restoreOutbox(userId: string): Promise<void> {
  let box: { workouts?: Workout[]; removed?: string[]; ends?: PendingEnd[] } | undefined;
  try {
    box = await get(outboxKey(userId));
  } catch {
    return;
  }
  if (!box || state.sessionUserId !== userId) return;
  const ws = Array.isArray(box.workouts) ? box.workouts : [];
  const gone = new Set(Array.isArray(box.removed) ? box.removed : []);
  if (ws.length || gone.size) {
    const byId = new Map(ws.map((w) => [w.id, w]));
    mutate((db) => {
      const kept = db.workouts.filter((w) => !gone.has(w.id)).map((w) => byId.get(w.id) ?? w);
      const have = new Set(kept.map((w) => w.id));
      return { ...db, workouts: [...kept, ...ws.filter((w) => !have.has(w.id) && !gone.has(w.id))] };
    });
    for (const id of gone) workoutQ.remove(id);
  }
  pendingEnds = Array.isArray(box.ends) ? box.ends : [];
  persistOutbox();
  if (pendingEnds.length) void sendPendingEnds();
}

interface TrainingData {
  /** The coach's own tracking formats by exercise id. */
  tracking?: Record<string, TrackingSchema>;
  workouts: Workout[];
  ids: string[];
  templates: RoutineTemplate[];
  exercises: Exercise[];
  /** Shared niche drills; every one on a full load, only the new ones after that. */
  global?: Exercise[];
  globalFull?: boolean;
  now: string;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Folds a server response into local state without disturbing anything with unsent changes. */
function applyTraining(data: TrainingData) {
  const cur = state.db;
  let changed = false;

  const wMap = new Map(cur.workouts.map((w) => [w.id, w]));
  for (const w of data.workouts) {
    if (workoutQ.busy(w.id)) continue;
    if (!sameJson(wMap.get(w.id), w)) {
      wMap.set(w.id, w);
      changed = true;
    }
  }
  const ids = new Set(data.ids);
  for (const id of [...wMap.keys()]) {
    if (!ids.has(id) && !workoutQ.busy(id)) {
      wMap.delete(id);
      changed = true;
    }
  }

  const tMap = new Map(data.templates.filter((t) => !templateQ.busy(t.id)).map((t) => [t.id, t]));
  for (const t of cur.templates) if (templateQ.busy(t.id)) tMap.set(t.id, t);
  const tChanged = tMap.size !== cur.templates.length || cur.templates.some((t) => !sameJson(tMap.get(t.id), t));

  const customNow = cur.exercises.filter((e) => e.custom);
  const xMap = new Map(data.exercises.filter((x) => !exerciseQ.busy(x.id)).map((x) => [x.id, x]));
  for (const x of customNow) if (exerciseQ.busy(x.id)) xMap.set(x.id, x);
  const xChanged = xMap.size !== customNow.length || customNow.some((x) => !sameJson(xMap.get(x.id), x));

  // Shared niche drills: a full load replaces them, later loads only add the new ones.
  const sharedNow = cur.exercises.filter((e) => e.global);
  const gMap = new Map((data.globalFull ? [] : sharedNow).map((e) => [e.id, e]));
  for (const g of data.global ?? []) gMap.set(g.id, g);
  const gChanged = gMap.size !== sharedNow.length || sharedNow.some((e) => !gMap.has(e.id));

  const trChanged = !sameJson(cur.tracking ?? {}, data.tracking ?? {});
  if (!changed && !tChanged && !xChanged && !trChanged && !gChanged) return;
  setState({
    ...state,
    db: {
      ...cur,
      tracking: trChanged ? (data.tracking ?? {}) : cur.tracking,
      workouts: changed ? [...wMap.values()] : cur.workouts,
      templates: tChanged ? [...tMap.values()] : cur.templates,
      exercises: xChanged || gChanged ? [...SEED_EXERCISES, ...gMap.values(), ...xMap.values()] : cur.exercises,
    },
  });
}

/** Loads (or re-loads) workouts, routines and custom exercises from the server. `full` re-reads every workout. */
export async function refreshTraining(full = false): Promise<boolean> {
  const forUser = state.sessionUserId;
  if (!forUser) return false;
  const q = !full && !trainingPartial && trainingSince ? `?since=${encodeURIComponent(trainingSince)}` : "";
  const r = await api<TrainingData>(`/api/training${q}`);
  if (state.sessionUserId !== forUser) return false;
  if (r.status === 401) {
    setState({ ready: true, db: createEmptyDB(), sessionUserId: null });
    return false;
  }
  if (!r.ok || !r.data) return false;
  applyTraining(r.data);
  trainingSince = new Date(Date.parse(r.data.now) - 10_000).toISOString();
  trainingPartial = false;
  return true;
}

/* ---------------- Server API helper ---------------- */
interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

export async function api<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown; keepalive?: boolean } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
      keepalive: init.keepalive,
    });
    let data: (T & { error?: string }) | null = null;
    try {
      data = (await res.json()) as T & { error?: string };
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data: res.ok ? data : null, error: res.ok ? undefined : (data?.error ?? `Request failed (${res.status})`) };
  } catch {
    return { ok: false, status: 0, data: null, error: "Can not reach the server. Check your connection." };
  }
}

interface BootstrapData {
  user: User | null;
  users: User[];
  clients: ClientProfile[];
}

/** Loads the session (if any) and this user's device-local data. Returns true when signed in. */
async function establishSession(): Promise<boolean> {
  // A device that was active recently (or has just signed in) is almost certainly still signed in, so everything the first screen
  // needs is requested at once instead of one after another. Recent workouts come first; the full history follows in the background.
  const likely = readLastActive() !== null && !isIdleStale();
  const early = likely ? { training: api<TrainingData>("/api/training?recent=1"), schedule: api<ScheduleData>("/api/schedule"), groups: api<GroupsData>("/api/groups") } : null;
  const r = await api<BootstrapData>("/api/bootstrap");
  if (!r.ok || !r.data?.user) {
    // Re-opened after more than 4 hours away: the session has timed out, so say why on the login page.
    if (isIdleStale()) setIdleNotice();
    if (isIdleStale()) clearActive();
    setState({ ready: true, db: createEmptyDB(), sessionUserId: null });
    return false;
  }
  const me = r.data.user;
  const trainingReq = early?.training ?? api<TrainingData>("/api/training?recent=1");
  const scheduleReq = early?.schedule ?? api<ScheduleData>("/api/schedule");
  const groupsReq = early?.groups ?? api<GroupsData>("/api/groups");
  let local: DB | undefined;
  try {
    local = await get<DB>(localKey(me.id));
  } catch {
    local = undefined;
  }
  if (!local || local.version !== DB_VERSION) local = createEmptyDB();

  // Switching accounts: drop anything queued for the previous one.
  outboxFrozen = false;
  pendingEnds = [];
  if (outboxTimer) clearTimeout(outboxTimer);
  workoutQ.clear();
  templateQ.clear();
  exerciseQ.clear();
  trainingSince = undefined;
  trainingLoaded = false;
  trainingPartial = false;
  cloudSafe = false;

  // A device that has not uploaded its old local data yet does so first, then reads what the server has.
  let migrated = true;
  let training = await trainingReq;
  try {
    if (!(await get(`coachflow-cloud-v1:${me.id}`))) {
      migrated = await migrateLocalData(me, local);
      training = await api<TrainingData>("/api/training?recent=1");
    }
  } catch {
    migrated = await migrateLocalData(me, local);
  }
  const serverOk = training.ok && !!training.data;
  cloudSafe = migrated && serverOk;
  const server = training.data;
  const [sched, grp] = await Promise.all([scheduleReq, groupsReq]);

  const base: DB = {
    ...local,
    settings: { ...DEFAULT_SETTINGS, ...local.settings },
    users: r.data.users,
    clients: r.data.clients,
    gyms: [],
    slots: [],
    bookings: [],
    groups: [],
    groupRequests: [],
    notifications: [],
    // If the server could not be reached, keep showing what this device has; it is re-synced on the next poll.
    workouts: server ? server.workouts : local.workouts,
    templates: server ? server.templates : local.templates.filter((t) => t.ownerId === me.id),
    exercises: server ? [...SEED_EXERCISES, ...(server.global ?? []), ...server.exercises] : local.exercises,
    tracking: server?.tracking ?? local.tracking ?? {},
  };
  // The schedule (with the coach's niches) and the classes are in before the app appears, so nothing pops in afterwards.
  const withSchedule = sched.ok && sched.data ? { ...base, ...scheduleSlice(base, sched.data) } : base;
  const withGroups = grp.ok && grp.data ? { ...withSchedule, groups: grp.data.groups, groupRequests: grp.data.requests, notifications: grp.data.notifications } : withSchedule;
  setState({ ready: true, sessionUserId: me.id, db: withGroups });
  if (server) trainingSince = new Date(Date.parse(server.now) - 10_000).toISOString();
  trainingLoaded = serverOk;
  if (serverOk) await restoreOutbox(me.id);
  if (serverOk) {
    trainingPartial = true;
    void refreshTraining(true); // the rest of the workout history, quietly
  }
  if (!(sched.ok && sched.data)) await refreshSchedule();
  if (!(grp.ok && grp.data)) await refreshGroups();
  return true;
}

/** One-time: upload what this browser kept locally before workouts moved to the database. Returns true when nothing is left to upload. */
async function migrateLocalData(me: User, local: DB): Promise<boolean> {
  const key = `coachflow-cloud-v1:${me.id}`;
  try {
    if (await get(key)) return true;
  } catch {
    /* treat as not migrated */
  }
  const staff = me.role === "TRAINER";
  const exercises = local.exercises.filter((e) => e.custom);
  const templates = local.templates.filter((t) => t.ownerId === me.id);
  const batches: { exercises?: Exercise[]; templates?: RoutineTemplate[]; workouts?: Workout[]; starters?: boolean }[] = [];
  if (staff || exercises.length || templates.length) batches.push({ exercises, templates, starters: staff });
  let cur: Workout[] = [];
  let size = 0;
  for (const w of local.workouts) {
    const n = JSON.stringify(w).length;
    if (n > 60_000) continue;
    if (cur.length && size + n > 60_000) {
      batches.push({ workouts: cur });
      cur = [];
      size = 0;
    }
    cur.push(w);
    size += n;
  }
  if (cur.length) batches.push({ workouts: cur });
  for (const b of batches) {
    const res = await api("/api/training/migrate", { body: b });
    if (!res.ok) return false;
  }
  try {
    await set(key, true);
  } catch {
    /* ignore */
  }
  return true;
}

/** Re-reads accounts/clients from the server (e.g. after the coach changes something, or on a timer). */
export async function refreshAccounts(): Promise<void> {
  if (!state.sessionUserId) return;
  const r = await api<BootstrapData>("/api/bootstrap");
  if (r.status === 401) {
    setState({ ready: true, db: createEmptyDB(), sessionUserId: null });
    return;
  }
  if (r.ok && r.data?.user) setState({ ...state, db: { ...state.db, users: r.data.users, clients: r.data.clients } });
}

export async function initStore() {
  if (initStarted) return;
  initStarted = true;
  // Remove the old demo dataset / local login that earlier versions kept in this browser.
  void del("coachflow-db-v1").catch(() => undefined);
  try {
    localStorage.removeItem("coachflow-session");
  } catch {
    /* ignore */
  }
  await establishSession();
  setInterval(() => {
    if (typeof document === "undefined" || document.visibilityState === "visible") {
      void refreshAccounts();
      void refreshSchedule();
      void refreshTraining();
      void refreshGroups();
    }
    if (pendingEnds.length) void sendPendingEnds();
  }, 45_000);
  // Live group classes: every 3 seconds while a live grid / group workout is open, and a little slower around class time.
  let fastN = 0;
  setInterval(() => {
    if (typeof document === "undefined" || document.visibilityState !== "visible" || !state.sessionUserId) return;
    if (liveCount > 0) {
      void refreshTraining();
      void refreshGroups();
    } else if (inClassWindow() && ++fastN % 3 === 0) void refreshGroups();
  }, 3000);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void refreshAccounts();
        void refreshSchedule();
        void refreshTraining();
        void refreshGroups();
      } else {
        flushTraining(true);
      }
    });
    window.addEventListener("pagehide", () => flushTraining(true));
    // The signal is back: send what waited (workouts first, then a finished session).
    window.addEventListener("online", () => {
      flushTraining(false);
      void sendPendingEnds();
    });
  }
}

/* ---------------- Hooks ---------------- */
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getSnapshot = () => state;
const getServerSnapshot = () => INITIAL;

export function useStore(): State {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useDB(): DB {
  return useStore().db;
}

export function useCurrentUser(): User | null {
  const { db, sessionUserId } = useStore();
  return db.users.find((u) => u.id === sessionUserId) ?? null;
}

/** Ticking "now" for components that depend on the current time (avoids impure renders). */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/* ---------------- Auth ---------------- */
/** Returns an error message, or null on success. */
export async function login(username: string, password: string): Promise<string | null> {
  const r = await api("/api/auth/login", { body: { username, password } });
  if (!r.ok) return r.error ?? "Login failed.";
  markActive(); // tells establishSession that this device is signed in, so it can load everything at once
  const ok = await establishSession();
  if (ok) {
    rememberUsername(username); // only the username is remembered on this device, never the password
    requestNicheStep(); // a coach chooses their niche after every sign-in (clients never see it)
  }
  if (!ok) clearActive();
  return ok ? null : "Signed in, but your account could not be loaded. Please try again.";
}

export async function logout() {
  if (persistTimer) clearTimeout(persistTimer);
  // Make sure nothing typed in the last moment is lost before the session ends.
  await Promise.all([exerciseQ.flush(), templateQ.flush()]);
  await workoutQ.flush();
  flush();
  await writeOutbox(); // anything still unsent waits on this device for the next sign-in
  outboxFrozen = true;
  clearActive();
  workoutQ.clear();
  templateQ.clear();
  exerciseQ.clear();
  trainingLoaded = false;
  cloudSafe = false;
  trainingSince = undefined;
  await api("/api/auth/logout", { method: "POST", body: {} });
  setState({ ready: true, db: createEmptyDB(), sessionUserId: null });
}

/** Changes the signed-in person's own username (coaches may also keep signing in with their email). Returns an error message or null. */
export async function changeUsername(username: string): Promise<string | null> {
  const r = await api<{ username?: string }>("/api/me", { method: "PATCH", body: { username } });
  if (!r.ok) return r.error ?? "Could not change the username.";
  const me = state.sessionUserId;
  const next = r.data?.username ?? username.trim().toLowerCase();
  mutate((db) => ({ ...db, users: db.users.map((u) => (u.id === me ? { ...u, username: next } : u)) }));
  return null;
}

export async function changePassword(current: string, next: string): Promise<string | null> {
  const r = await api("/api/auth/password", { body: { current, next } });
  if (!r.ok) return r.error ?? "Could not change password.";
  await refreshAccounts();
  return null;
}

const onboardKey = (userId: string) => `coachflow-onboarded:${userId}`;

/** Has this device already seen / finished the guided tour for this user? */
export function deviceOnboarded(userId: string): boolean {
  try {
    return localStorage.getItem(onboardKey(userId)) === "1";
  } catch {
    return false;
  }
}

/** The tour was finished or skipped: remember it on this device and on the account, so it never interrupts again. */
export function completeOnboarding() {
  const uid = state.sessionUserId;
  if (!uid) return;
  try {
    localStorage.setItem(onboardKey(uid), "1");
  } catch {
    /* ignore */
  }
  mutate((db) => ({ ...db, users: db.users.map((u) => (u.id === uid ? { ...u, hasCompletedOnboarding: true } : u)) }));
  void api("/api/me", { method: "PATCH", body: { hasCompletedOnboarding: true } });
}

/** Saves the chosen theme on the account (the device copy is written by applyTheme). */
export function saveThemePreference(id: "black" | "white" | "navy") {
  const uid = state.sessionUserId;
  if (!uid) return;
  mutate((db) => ({ ...db, users: db.users.map((u) => (u.id === uid ? { ...u, themePreference: id } : u)) }));
  void api("/api/me", { method: "PATCH", body: { themePreference: id } });
}

export function setUnit(userId: string, unit: UnitSystem) {
  mutate((db) => ({ ...db, users: db.users.map((u) => (u.id === userId ? { ...u, unit } : u)) }));
  void api("/api/me", { method: "PATCH", body: { unit } });
}

/* ---------------- Clients (server-backed, encrypted at rest) ---------------- */
export interface NewClientInput {
  name: string;
  username: string;
  password: string;
  phone: string;
  email: string;
  goal: ClientGoal;
  credits: number;
  groupClassCredits?: number;
  defaultGymId: string | null;
  medicalNotes: string;
}

interface ClientResponse {
  user: User;
  profile: ClientProfile;
}

function applyClient(res: ClientResponse) {
  mutate((db) => ({
    ...db,
    users: db.users.some((u) => u.id === res.user.id) ? db.users.map((u) => (u.id === res.user.id ? res.user : u)) : [...db.users, res.user],
    clients: db.clients.some((c) => c.id === res.profile.id) ? db.clients.map((c) => (c.id === res.profile.id ? res.profile : c)) : [...db.clients, res.profile],
  }));
}

export async function createClient(input: NewClientInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const r = await api<ClientResponse>("/api/clients", { body: input });
  if (!r.ok || !r.data) return { ok: false, error: r.error ?? "Could not create the client." };
  applyClient(r.data);
  return { ok: true, id: r.data.user.id };
}

export async function updateClient(id: string, patch: { user?: Partial<User>; profile?: Partial<ClientProfile> }): Promise<string | null> {
  const body: Record<string, unknown> = { ...(patch.profile ?? {}) };
  if (patch.user?.name !== undefined) body.name = patch.user.name;
  if (patch.user?.username !== undefined) body.username = patch.user.username;
  delete body.coachId;
  delete body.startDate;
  const r = await api<ClientResponse>(`/api/clients/${id}`, { method: "PATCH", body });
  if (!r.ok || !r.data) return r.error ?? "Could not save changes.";
  applyClient(r.data);
  return null;
}

/** Saves where a client trains at home (their own profile, or the coach editing a client). Private to the client and their coach. */
export async function saveHomeAddress(clientId: string, home: { place?: PlaceInfo | null; text?: string } | null): Promise<string | null> {
  const body = { homeAddress: home === null ? null : home.place ? { place: home.place } : { text: home.text ?? "" } };
  const self = state.sessionUserId === clientId;
  const r = self ? await api("/api/me", { method: "PATCH", body }) : await api<ClientResponse>(`/api/clients/${clientId}`, { method: "PATCH", body });
  if (!r.ok) return r.error ?? "Could not save the home address.";
  mutate((db) => ({
    ...db,
    clients: db.clients.map((c) => {
      if (c.id !== clientId) return c;
      const { homePlace: _p, homeText: _t, ...rest } = c;
      void _p;
      void _t;
      if (home === null) return rest;
      return home.place ? { ...rest, homePlace: { ...home.place, home: true } } : { ...rest, homeText: home.text ?? "" };
    }),
  }));
  return null;
}

export async function resetClientPassword(id: string, password: string): Promise<string | null> {
  const r = await api(`/api/clients/${id}/password`, { body: { password } });
  return r.ok ? null : (r.error ?? "Could not reset the password.");
}

export async function deleteClient(id: string): Promise<string | null> {
  const r = await api(`/api/clients/${id}`, { method: "DELETE" });
  if (!r.ok) return r.error ?? "Could not delete the client.";
  mutate((db) => ({
    ...db,
    users: db.users.filter((u) => u.id !== id),
    clients: db.clients.filter((c) => c.id !== id),
    workouts: db.workouts.filter((w) => w.clientId !== id),
    metrics: db.metrics.filter((m) => m.clientId !== id),
    photos: db.photos.filter((p) => p.clientId !== id),
    bookings: db.bookings.filter((b) => b.clientId !== id),
    templates: db.templates.filter((t) => t.ownerId !== id),
  }));
  return null;
}

/** Changes a client's 1-on-1 package by `delta` on the server (relative, so attendance changes made meanwhile are never overwritten). */
export function adjustCredits(id: string, delta: number, setPackage = false) {
  mutate((db) => ({
    ...db,
    clients: db.clients.map((c) =>
      c.id === id
        ? {
            ...c,
            credits: Math.max(0, c.credits + delta),
            packageSize: setPackage ? Math.max(0, c.credits + delta) : c.packageSize,
          }
        : c,
    ),
  }));
  if (state.db.users.find((u) => u.id === state.sessionUserId)?.role !== "TRAINER") return;
  void api(`/api/clients/${id}`, { method: "PATCH", body: { creditsDelta: delta, ...(setPackage ? { setPackageToBalance: true } : {}) } }).then((r) => {
    if (r.ok) void refreshAccounts();
  });
}

/** Same for the group class credits. Returns an error message, or null. */
export async function adjustGroupCreditsBy(id: string, delta: number): Promise<string | null> {
  const r = await api(`/api/clients/${id}`, { method: "PATCH", body: { groupCreditsDelta: delta } });
  if (!r.ok) return r.error ?? "Could not change the credits.";
  await refreshAccounts();
  return null;
}

/* ---------------- Exercises & templates ---------------- */
export function addExercise(ex: Omit<Exercise, "id" | "custom">): Exercise {
  const full: Exercise = { ...ex, id: uid("ex"), custom: true, createdBy: state.sessionUserId ?? undefined };
  mutate((db) => ({ ...db, exercises: [...db.exercises, full] }));
  return full;
}

/** The coach sets their own tracking format (set columns + chart metric) for an exercise; their clients get it too. */
export async function saveTrackingFormat(exerciseId: string, tracking: TrackingSchema): Promise<string | null> {
  const r = await api<{ tracking: TrackingSchema }>(`/api/training/tracking/${exerciseId}`, { method: "PUT", body: { tracking } });
  if (!r.ok || !r.data) return r.error ?? "Could not save the tracking format.";
  mutate((db) => ({ ...db, tracking: { ...(db.tracking ?? {}), [exerciseId]: r.data!.tracking } }));
  return null;
}

/** Back to the exercise's default tracking format. */
export async function resetTrackingFormat(exerciseId: string): Promise<string | null> {
  const r = await api(`/api/training/tracking/${exerciseId}`, { method: "DELETE" });
  if (!r.ok) return r.error ?? "Could not reset the tracking format.";
  mutate((db) => {
    const { [exerciseId]: _gone, ...rest } = db.tracking ?? {};
    void _gone;
    return { ...db, tracking: rest };
  });
  return null;
}

/** Coach: assign what a client trains (single or several focuses). The client's exercise pickers follow it. */
export async function saveClientFocuses(clientId: string, focuses: string[]): Promise<string | null> {
  return updateClient(clientId, { profile: { focuses } });
}

export function saveTemplate(t: RoutineTemplate) {
  mutate((db) => ({
    ...db,
    templates: db.templates.some((x) => x.id === t.id)
      ? db.templates.map((x) => (x.id === t.id ? t : x))
      : [...db.templates, t],
  }));
}

/** A client saved imported routines: tells their coach (how many and the names, never the contents). */
export function notifyRoutineImport(titles: string[], exercises: number) {
  void api("/api/notify/import", { body: { titles, exercises } });
}

export function deleteTemplate(id: string) {
  mutate((db) => ({ ...db, templates: db.templates.filter((t) => t.id !== id) }));
}

/* ---------------- Workouts ---------------- */
export function blankSet(partial: Partial<WorkoutSet> = {}): WorkoutSet {
  return { id: uid("s"), type: "N", done: false, ...partial };
}

export function newWorkoutExercise(exerciseId: string, sets = 3): WorkoutExercise {
  return { id: uid("we"), exerciseId, sets: Array.from({ length: sets }, () => blankSet()) };
}

export interface StartWorkoutInput {
  clientId: string;
  loggedBy: Role;
  loggedById: string;
  title?: string;
  templateId?: string;
  backfill?: boolean;
  gymId?: string | null;
}

export function startWorkout(input: StartWorkoutInput): string {
  const { db } = state;
  const tpl = input.templateId ? db.templates.find((t) => t.id === input.templateId) : undefined;
  const profile = db.clients.find((c) => c.id === input.clientId);
  const now = new Date();
  const w: Workout = {
    id: uid("w"),
    clientId: input.clientId,
    title: input.title ?? tpl?.name ?? "New Workout",
    startedAt: now.toISOString(),
    liveStartedAt: input.backfill ? undefined : now.toISOString(),
    durationSec: 0,
    status: "ACTIVE",
    gymId: input.gymId ?? profile?.defaultGymId ?? null,
    notes: "",
    loggedBy: input.loggedBy,
    loggedById: input.loggedById,
    templateId: tpl?.id,
    exercises:
      tpl?.exercises.map((te) => {
        const ex = db.exercises.find((e) => e.id === te.exerciseId);
        const timed = ex?.type === "DURATION_DISTANCE" || ex?.type === "DURATION_ONLY";
        const we = newWorkoutExercise(te.exerciseId, ex?.type === "DURATION_DISTANCE" ? 1 : te.sets);
        if (te.notes) we.notes = te.notes;
        // Targets written into the routine (e.g. by an import) are pre-filled; plain routines start blank as before.
        we.sets = we.sets.map((st) => {
          if (timed) return { ...st, ...(te.durationSec ? { durationSec: te.durationSec } : {}), ...(te.distanceKm ? { distanceKm: te.distanceKm } : {}) };
          if (te.weight) return { ...st, weight: te.weight, reps: te.repMax || te.repMin || undefined };
          return st;
        });
        return we;
      }) ?? [],
  };
  mutate((d) => ({ ...d, workouts: [...d.workouts, w] }));
  return w.id;
}

export function updateWorkout(id: string, fn: (w: Workout) => Workout) {
  mutate((db) => ({ ...db, workouts: db.workouts.map((w) => (w.id === id ? fn(w) : w)) }));
}

function withPRs(db: DB, clientId: string): DB {
  const exMap = new Map(db.exercises.map((e) => [e.id, e]));
  const mine = db.workouts.filter((w) => w.clientId === clientId && w.status === "DONE");
  const prs = annotatePRs(mine, exMap);
  const samePr = (a?: string[], b?: string[]) => (a?.join() ?? "") === (b?.join() ?? "");
  return {
    ...db,
    // Only workouts whose PR badges actually changed get a new object (so only those are re-saved).
    workouts: db.workouts.map((w) => {
      if (w.clientId !== clientId || w.status !== "DONE") return w;
      const dirty = w.exercises.some((we) => we.sets.some((st) => !samePr(st.pr, prs.get(st.id))));
      if (!dirty) return w;
      return {
        ...w,
        exercises: w.exercises.map((we) => ({
          ...we,
          sets: we.sets.map((st) => {
            const f = prs.get(st.id);
            if (f) return { ...st, pr: f };
            if (st.pr) {
              const { pr: _pr, ...rest } = st;
              void _pr;
              return rest;
            }
            return st;
          }),
        })),
      };
    }),
  };
}

export function finishWorkout(id: string) {
  const w = state.db.workouts.find((x) => x.id === id);
  if (!w) return;
  mutate((db) => {
    const next = db.workouts.map((x) => {
      if (x.id !== id) return x;
      const live = x.liveStartedAt ? Math.round((Date.now() - parseISO(x.liveStartedAt).getTime()) / 1000) : x.durationSec;
      return {
        ...x,
        status: "DONE" as const,
        liveStartedAt: undefined,
        durationSec: Math.max(60, live),
        // Drop empty (never completed) sets and exercises with no completed sets.
        exercises: x.exercises
          .map((we) => ({ ...we, sets: we.sets.filter((s) => s.done) }))
          .filter((we) => we.sets.length > 0),
      };
    });
    return withPRs({ ...db, workouts: next }, w.clientId);
  });
}

export function deleteWorkout(id: string) {
  const w = state.db.workouts.find((x) => x.id === id);
  mutate((db) => {
    const next = { ...db, workouts: db.workouts.filter((x) => x.id !== id) };
    return w ? withPRs(next, w.clientId) : next;
  });
}

export interface CompletedWorkoutInput {
  clientId: string;
  title: string;
  /** yyyy-MM-dd — the day the workout actually took place. */
  date: string;
  /** Orders several workouts logged for the same day. */
  slot: number;
  notes?: string;
  exercises: {
    exerciseId: string;
    notes?: string;
    sets: { type?: SetType; reps?: number; weight?: number; durationSec?: number; distanceKm?: number }[];
  }[];
}

/** Logs already-finished workouts (e.g. imported from text) on the date they really happened, then refreshes PR badges. */
export function logCompletedWorkouts(inputs: CompletedWorkoutInput[]): string[] {
  const me = state.db.users.find((u) => u.id === state.sessionUserId);
  if (!me) return [];
  const ids: string[] = [];
  mutate((db) => {
    let next = db;
    const clients = new Set<string>();
    for (const inp of inputs) {
      const [y, m, d] = inp.date.split("-").map(Number);
      const when = new Date(y, (m || 1) - 1, d || 1, 12, Math.min(inp.slot, 59));
      const profile = db.clients.find((c) => c.id === inp.clientId);
      const sets = inp.exercises.reduce((n, e) => n + e.sets.length, 0);
      const timed = inp.exercises.reduce((n, e) => n + e.sets.reduce((a, s) => a + (s.durationSec ?? 0), 0), 0);
      const w: Workout = {
        id: uid("w"),
        clientId: inp.clientId,
        title: inp.title,
        startedAt: Number.isNaN(when.getTime()) ? new Date().toISOString() : when.toISOString(),
        durationSec: Math.max(600, timed + sets * 150),
        status: "DONE",
        gymId: profile?.defaultGymId ?? null,
        notes: inp.notes ?? "",
        loggedBy: me.role,
        loggedById: me.id,
        imported: true,
        exercises: inp.exercises.map((e) => ({
          id: uid("we"),
          exerciseId: e.exerciseId,
          ...(e.notes ? { notes: e.notes } : {}),
          sets: e.sets.map((s) => ({ id: uid("s"), type: "N" as const, done: true, ...s })),
        })),
      };
      ids.push(w.id);
      clients.add(inp.clientId);
      next = { ...next, workouts: [...next.workouts, w] };
    }
    for (const c of clients) next = withPRs(next, c);
    return next;
  });
  return ids;
}

export function templateFromWorkout(workoutId: string, name: string, ownerId: string, shared: boolean) {
  const w = state.db.workouts.find((x) => x.id === workoutId);
  if (!w) return;
  const t: RoutineTemplate = {
    id: uid("t"),
    ownerId,
    name,
    shared,
    exercises: w.exercises.map((we) => {
      const working = we.sets.filter((s) => s.type !== "W");
      const reps = working.map((s) => s.reps ?? 0).filter(Boolean);
      return {
        exerciseId: we.exerciseId,
        sets: Math.max(1, working.length),
        repMin: reps.length ? Math.min(...reps) : 8,
        repMax: reps.length ? Math.max(...reps) : 12,
      };
    }),
  };
  saveTemplate(t);
}

/* ---------------- Body metrics & photos ---------------- */
export function addMetric(m: Omit<BodyMetricLog, "id">) {
  mutate((db) => ({ ...db, metrics: [...db.metrics, { ...m, id: uid("m") }] }));
}
export function deleteMetric(id: string) {
  mutate((db) => ({ ...db, metrics: db.metrics.filter((m) => m.id !== id) }));
}
export function addPhoto(p: Omit<ProgressPhoto, "id">) {
  mutate((db) => ({ ...db, photos: [...db.photos, { ...p, id: uid("p") }] }));
}
export function deletePhoto(id: string) {
  mutate((db) => ({ ...db, photos: db.photos.filter((p) => p.id !== id) }));
}

/* ---------------- Scheduling (server-backed: gyms, availability, bookings, booking rules) ---------------- */
interface RulesData {
  sessionMinutes: number;
  noticeHours: number;
  autoConfirm: boolean;
  allowCustomGym: boolean;
  utcOffsetMin?: number;
  travelEnabled: boolean;
  travelDefaultMin: number;
  travelParkingMin: number;
  travelMaxMin: number;
  specialties?: string[];
  sports?: string[];
}

interface ScheduleData {
  settings: RulesData;
  gyms: GymLocation[];
  slots: AvailabilitySlot[];
  bookings: Booking[];
}

/** The parts of the local database that come from the schedule endpoint. */
function scheduleSlice(db: DB, data: ScheduleData): Pick<DB, "gyms" | "slots" | "bookings" | "settings"> {
  const { sessionMinutes, noticeHours, autoConfirm, allowCustomGym, travelEnabled, travelDefaultMin, travelParkingMin, travelMaxMin, specialties = [], sports = [] } = data.settings;
  return {
    gyms: data.gyms,
    slots: data.slots,
    bookings: data.bookings,
    settings: { ...db.settings, sessionMinutes, noticeHours, autoConfirm, allowCustomGym, travelEnabled, travelDefaultMin, travelParkingMin, travelMaxMin, specialties, sports },
  };
}

function applySchedule(data: ScheduleData) {
  setState({ ...state, db: { ...state.db, ...scheduleSlice(state.db, data) } });
}

/** Re-reads the coach's rules, gyms, availability and bookings (a client sees their own coach's, with other clients' sessions shown only as "booked"). */
export async function refreshSchedule(): Promise<void> {
  if (!state.sessionUserId) return;
  const r = await api<ScheduleData>("/api/schedule");
  if (r.ok && r.data) applySchedule(r.data);
}

/** For a location being considered, the coach's sessions with the travel buffer each would need (times only). Null when travel rules are off. */
export async function fetchTravelNeighbors(loc: { gymId: string | null; customGym?: string; place?: PlaceInfo | null }): Promise<TravelNeighbor[] | null> {
  const r = await api<{ enabled: boolean; neighbors: TravelNeighbor[] }>("/api/schedule/travel", { body: { gymId: loc.gymId, customGym: loc.customGym, place: loc.place ?? undefined } });
  return r.ok && r.data?.enabled ? r.data.neighbors : null;
}

export async function saveGym(g: Omit<GymLocation, "id"> & { id?: string }): Promise<string | null> {
  const r = await api<{ gym: GymLocation }>("/api/schedule/gyms", { body: g });
  if (!r.ok || !r.data) return r.error ?? "Could not save the gym.";
  const gym = r.data.gym;
  mutate((db) => ({ ...db, gyms: db.gyms.some((x) => x.id === gym.id) ? db.gyms.map((x) => (x.id === gym.id ? gym : x)) : [...db.gyms, gym] }));
  return null;
}

export async function deleteGym(id: string): Promise<string | null> {
  const r = await api(`/api/schedule/gyms/${id}`, { method: "DELETE" });
  if (!r.ok) return r.error ?? "Could not delete the gym.";
  mutate((db) => ({
    ...db,
    gyms: db.gyms.filter((g) => g.id !== id),
    clients: db.clients.map((c) => (c.defaultGymId === id || c.defaultGymId === `gym:${id}` ? { ...c, defaultGymId: null } : c)),
  }));
  return null;
}

export async function addSlot(s: Omit<AvailabilitySlot, "id">): Promise<string | null> {
  const r = await api<{ slot: AvailabilitySlot }>("/api/schedule/slots", { body: s });
  if (!r.ok || !r.data) return r.error ?? "Could not add the slot.";
  const slot = r.data.slot;
  mutate((db) => ({ ...db, slots: [...db.slots, slot] }));
  return null;
}

export async function deleteSlot(id: string): Promise<string | null> {
  const r = await api(`/api/schedule/slots/${id}`, { method: "DELETE" });
  if (!r.ok) return r.error ?? "Could not remove the slot.";
  mutate((db) => ({ ...db, slots: db.slots.filter((s) => s.id !== id) }));
  return null;
}

/* ---------------- Bookings ---------------- */
export interface NewBookingInput {
  clientId: string;
  start: Date;
  gymId: string | null;
  customGym?: string;
  place?: PlaceInfo | null;
  /** Coach only: book even though there is not enough travel time from another location. */
  waiveTravel?: boolean;
  focus: SessionFocus;
  notes: string;
  createdBy: Role;
}

function replaceBooking(b: Booking, credits?: number) {
  mutate((db) => ({
    ...db,
    bookings: db.bookings.some((x) => x.id === b.id) ? db.bookings.map((x) => (x.id === b.id ? b : x)) : [...db.bookings, b],
    clients: credits === undefined ? db.clients : db.clients.map((c) => (c.id === b.clientId ? { ...c, credits } : c)),
  }));
}

/** Books a session on the server (it re-checks notice, open slots, credits and clashes) and then emails a calendar invite to the other party. */
export async function createBooking(input: NewBookingInput): Promise<{ ok: true; booking: Booking } | { ok: false; error: string }> {
  const r = await api<{ booking: Booking }>("/api/bookings", {
    body: {
      clientId: input.clientId,
      start: input.start.toISOString(),
      gymId: input.gymId,
      customGym: input.customGym,
      place: input.place ?? undefined,
      waiveTravel: input.waiveTravel === true ? true : undefined,
      focus: input.focus,
      notes: input.notes,
    },
  });
  if (!r.ok || !r.data) return { ok: false, error: r.error ?? "Could not book the session." };
  const booking = r.data.booking;
  replaceBooking(booking);
  if (state.db.settings.emailInvites !== false) void sendInvite(booking, state.db, "REQUEST", input.createdBy === "CLIENT" ? "TRAINER" : "CLIENT");
  return { ok: true, booking };
}

/** Coach: change a session's status. Completing / no-show deducts a package credit on the server; undoing restores it. */
export async function setBookingStatus(id: string, status: BookingStatus): Promise<string | null> {
  const r = await api<{ booking: Booking; credits?: number }>(`/api/bookings/${id}`, { method: "PATCH", body: { action: "status", status } });
  if (!r.ok || !r.data) return r.error ?? "Could not update the session.";
  replaceBooking(r.data.booking, r.data.credits);
  if ((status === "CANCELLED" || status === "DECLINED") && state.db.settings.emailInvites !== false) void sendInvite(r.data.booking, state.db, "CANCEL", "CLIENT");
  return null;
}

export async function cancelBookingAs(id: string, role: Role): Promise<string | null> {
  const r = await api<{ booking: Booking }>(`/api/bookings/${id}`, { method: "PATCH", body: { action: "cancel" } });
  if (!r.ok || !r.data) return r.error ?? "Could not cancel the session.";
  replaceBooking(r.data.booking);
  if (state.db.settings.emailInvites !== false) void sendInvite(r.data.booking, state.db, "CANCEL", role === "CLIENT" ? "TRAINER" : "CLIENT");
  return null;
}

export async function rescheduleBooking(id: string, start: Date, gymId: string | null, customGym?: string, place?: PlaceInfo | null, waiveTravel = false): Promise<string | null> {
  const r = await api<{ booking: Booking }>(`/api/bookings/${id}`, { method: "PATCH", body: { action: "reschedule", start: start.toISOString(), gymId, customGym, place: place ?? undefined, waiveTravel: waiveTravel || undefined } });
  if (!r.ok || !r.data) return r.error ?? "Could not reschedule.";
  replaceBooking(r.data.booking);
  if (state.db.settings.emailInvites !== false) void sendInvite(r.data.booking, state.db, "REQUEST", "CLIENT");
  return null;
}

/** Changes a session's date/time, place, focus and comments. The coach may do all of it; a client may too, within the notice rules and open slots. */
export async function editBooking(id: string, patch: { start?: Date; gymId?: string | null; customGym?: string; place?: PlaceInfo | null; focus?: SessionFocus; notes?: string; waiveTravel?: boolean }, role: Role): Promise<string | null> {
  const r = await api<{ booking: Booking; moved?: boolean }>(`/api/bookings/${id}`, {
    method: "PATCH",
    body: { action: "edit", ...patch, start: patch.start?.toISOString(), place: patch.place ?? undefined, waiveTravel: patch.waiveTravel || undefined },
  });
  if (!r.ok || !r.data) return r.error ?? "Could not save the changes.";
  replaceBooking(r.data.booking);
  if (r.data.moved && state.db.settings.emailInvites !== false) void sendInvite(r.data.booking, state.db, "REQUEST", role === "CLIENT" ? "TRAINER" : "CLIENT");
  return null;
}

/* ---------------- Group classes, shared sessions & notifications ---------------- */
interface GroupsData {
  groups: GroupSession[];
  requests: GroupRequest[];
  notifications: AppNotification[];
  unread: number;
}

/** How many open screens want fast (3 s) updates: the coach's live grid and a client's group workout. */
let liveCount = 0;

export function useLivePolling(on: boolean) {
  useEffect(() => {
    if (!on) return;
    liveCount++;
    void refreshTraining();
    void refreshGroups();
    return () => {
      liveCount = Math.max(0, liveCount - 1);
    };
  }, [on]);
}

function inClassWindow(): boolean {
  const meId = state.sessionUserId;
  if (!meId) return false;
  const staff = state.db.users.find((u) => u.id === meId)?.role === "TRAINER";
  const now = Date.now();
  return state.db.groups.some((g) => g.status === "OPEN" && (staff || g.mine?.status === "CONFIRMED") && Date.parse(g.start) - 30 * 60000 < now && Date.parse(g.end) + 120 * 60000 > now);
}

function applyGroups(data: GroupsData) {
  const cur = state.db;
  if (sameJson(cur.groups, data.groups) && sameJson(cur.groupRequests, data.requests) && sameJson(cur.notifications, data.notifications)) return;
  setState({ ...state, db: { ...cur, groups: data.groups, groupRequests: data.requests, notifications: data.notifications } });
}

/** Re-reads the classes, join requests and notifications. If a group workout was pushed to me, pulls it in straight away. */
export async function refreshGroups(): Promise<void> {
  const forUser = state.sessionUserId;
  if (!forUser) return;
  const r = await api<GroupsData>("/api/groups");
  if (state.sessionUserId !== forUser || !r.ok || !r.data) return;
  applyGroups(r.data);
  const me = state.db.users.find((u) => u.id === forUser);
  if (me?.role === "CLIENT") {
    const waiting = r.data.groups.some((g) => g.status === "OPEN" && g.workoutStartedAt && g.mine?.status === "CONFIRMED" && !state.db.workouts.some((w) => w.groupId === g.id));
    if (waiting) void refreshTraining();
  }
}

async function groupCall<T extends object = Record<string, never>>(path: string, body: unknown, method = "PATCH"): Promise<{ error: string | null; data: (GroupsData & T) | null }> {
  const r = await api<GroupsData & T>(path, { method, body });
  if (!r.ok || !r.data) return { error: r.error ?? "That didn't work. Please try again.", data: null };
  applyGroups(r.data);
  return { error: null, data: r.data };
}

/** Takes a spot in a class, or joins its waitlist. Returns an error message, or null (with the outcome). */
export async function bookClass(id: string): Promise<{ error: string | null; result?: "CONFIRMED" | "WAITLIST" }> {
  const r = await groupCall<{ result: "CONFIRMED" | "WAITLIST" }>(`/api/groups/${id}`, { action: "book" });
  return { error: r.error, result: r.data?.result };
}
export async function leaveClass(id: string): Promise<string | null> {
  return (await groupCall(`/api/groups/${id}`, { action: "leave" })).error;
}
export async function requestToJoin(id: string): Promise<string | null> {
  return (await groupCall(`/api/groups/${id}`, { action: "request" })).error;
}
export async function withdrawRequest(requestId: string): Promise<string | null> {
  return (await groupCall(`/api/groups/requests/${requestId}`, { decision: "cancel" })).error;
}
export async function decideJoinRequest(requestId: string, approve: boolean): Promise<string | null> {
  const r = await groupCall(`/api/groups/requests/${requestId}`, { decision: approve ? "approve" : "decline" });
  if (!r.error) void refreshSchedule();
  return r.error;
}
/** A client opens one of their own sessions to a group / partner. */
export async function shareSession(bookingId: string, capacity: number): Promise<string | null> {
  return (await groupCall("/api/groups", { shareBookingId: bookingId, capacity }, "POST")).error;
}
export async function unshareSession(groupId: string): Promise<string | null> {
  return (await groupCall(`/api/groups/${groupId}`, { action: "unshare" })).error;
}

export interface NewClassInput {
  title: string;
  start: Date;
  durationMin: number;
  capacity: number;
  repeatWeeks: number;
  gymId: string | null;
  customGym?: string;
  place?: PlaceInfo | null;
  templateId?: string;
  notes: string;
  waiveTravel?: boolean;
}
export async function createClass(i: NewClassInput): Promise<{ error: string | null; skipped: string[] }> {
  const r = await groupCall<{ skipped: string[] }>(
    "/api/groups",
    { title: i.title, start: i.start.toISOString(), durationMin: i.durationMin, capacity: i.capacity, repeatWeeks: i.repeatWeeks, gymId: i.gymId, customGym: i.customGym, place: i.place ?? undefined, templateId: i.templateId || undefined, notes: i.notes, waiveTravel: i.waiveTravel || undefined },
    "POST",
  );
  return { error: r.error, skipped: r.data?.skipped ?? [] };
}
export async function editClass(id: string, patch: Record<string, unknown>): Promise<string | null> {
  return (await groupCall(`/api/groups/${id}`, { action: "edit", ...patch })).error;
}
export async function cancelClass(id: string, reason: string): Promise<string | null> {
  return (await groupCall(`/api/groups/${id}`, { action: "cancel", reason })).error;
}
export async function addClassMember(id: string, clientId: string): Promise<string | null> {
  return (await groupCall(`/api/groups/${id}`, { action: "addMember", clientId })).error;
}
export async function removeClassMember(id: string, clientId: string): Promise<string | null> {
  return (await groupCall(`/api/groups/${id}`, { action: "removeMember", clientId })).error;
}
/** Pushes one workout to every confirmed attendee (a routine, or an exercise list built on the spot). */
export async function startClassWorkout(id: string, input: { templateId?: string; plan?: { exerciseId: string; sets: number; repMin: number; repMax: number }[]; title?: string }): Promise<string | null> {
  const r = await groupCall<{ pushed: number }>(`/api/groups/${id}`, { action: "start", ...input });
  if (!r.error) await refreshTraining(true);
  return r.error;
}
export async function markNotificationsRead(ids: string[] | "all"): Promise<void> {
  await groupCall("/api/notifications", { ids }, "POST");
}

/**
 * Coach, live grid: change values of one set in an attendee's workout. Shown at once, then saved as a field-level change
 * on the server (so it merges with whatever the client is logging at the same moment).
 */
export async function coachEditSet(workoutId: string, entryId: string, setId: string, change: { weight?: number | null; reps?: number | null; durationSec?: number | null; distanceKm?: number | null; done?: boolean }): Promise<string | null> {
  const apply = (fn: (w: Workout) => Workout) => setState({ ...state, db: { ...state.db, workouts: state.db.workouts.map((w) => (w.id === workoutId ? fn(w) : w)) } });
  apply((w) => ({
    ...w,
    exercises: w.exercises.map((we) =>
      we.id !== entryId
        ? we
        : {
            ...we,
            sets: we.sets.map((s) => {
              if (s.id !== setId) return s;
              const next: Record<string, unknown> = { ...s };
              for (const [k, v] of Object.entries(change)) {
                if (v === null || v === undefined) delete next[k];
                else next[k] = v;
              }
              return next as unknown as WorkoutSet;
            }),
          },
    ),
  }));
  const r = await api<{ workout: Workout }>(`/api/training/workouts/${workoutId}`, { method: "PATCH", body: { entryId, setId, change } });
  if (!r.ok || !r.data) {
    void refreshTraining(true);
    return r.error ?? "Couldn't save that change.";
  }
  const saved = r.data.workout;
  apply(() => saved);
  return null;
}

/* ---------------- Attendance ---------------- */
export type AttendanceTarget = { kind: "BOOKING" | "GROUP"; id: string };
export interface MarkChange {
  clientId: string;
  mark: "PRESENT" | "NO_SHOW" | "CLEAR";
  /** No-show only: take the credit anyway. */
  deduct?: boolean;
}

async function afterAttendance() {
  await Promise.all([refreshSchedule(), refreshGroups(), refreshAccounts()]);
}

/** Marks people present / no-show (and optionally finalises the session). Credits are settled on the server. */
export async function saveAttendance(t: AttendanceTarget, marks: MarkChange[], finalize = false): Promise<string | null> {
  const r = await api("/api/attendance", { body: { kind: t.kind, id: t.id, marks, finalize } });
  await afterAttendance();
  return r.ok ? null : (r.error ?? "Could not save attendance.");
}

export async function reopenSession(t: AttendanceTarget): Promise<string | null> {
  const r = await api("/api/attendance", { body: { kind: t.kind, id: t.id, reopen: true } });
  await afterAttendance();
  return r.ok ? null : (r.error ?? "Could not reopen the session.");
}

/* ---------------- Gym floor ---------------- */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Adds workouts that don't exist yet. It never replaces one: another device may already have logged sets in it. */
export function addWorkouts(list: Workout[]) {
  mutate((db) => {
    const have = new Set(db.workouts.map((w) => w.id));
    const add = list.filter((w) => !have.has(w.id));
    return add.length ? { ...db, workouts: [...db.workouts, ...add] } : db;
  });
}

/** Waits until every workout change has reached the server, or gives up (no signal). */
export async function flushWorkouts(timeoutMs = 6000): Promise<boolean> {
  const t0 = Date.now();
  await workoutQ.flush();
  while (!workoutQ.settled && Date.now() - t0 < timeoutMs) await sleep(200);
  return workoutQ.settled;
}

export interface FloorEndRow {
  clientId: string;
  workoutId?: string;
  mark: "PRESENT" | "NO_SHOW";
  /** No-show only: take the credit anyway. */
  deduct?: boolean;
}
export type FloorEndResult = { ok: true; recaps: number } | { ok: false; queued: boolean; error?: string };

const refused = (status: number) => status !== 0 && status < 500 && status !== 429;

async function sendEnd(end: PendingEnd): Promise<FloorEndResult> {
  if (await flushWorkouts()) {
    const r = await api<{ recaps: number }>("/api/floor/end", { body: end });
    if (r.ok) {
      await afterAttendance();
      return { ok: true, recaps: r.data?.recaps ?? 0 };
    }
    if (refused(r.status)) return { ok: false, queued: false, error: r.error ?? "Couldn't end the session." };
  }
  // No signal: it waits on this device and goes out as soon as the connection is back.
  pendingEnds = [...pendingEnds.filter((e) => !(e.kind === end.kind && e.id === end.id)), end];
  persistOutbox();
  return { ok: false, queued: true };
}

async function sendPendingEnds(): Promise<void> {
  if (sendingEnds || !pendingEnds.length) return;
  sendingEnds = true;
  try {
    for (const end of [...pendingEnds]) {
      if (!(await flushWorkouts(3000))) break;
      const r = await api("/api/floor/end", { body: end });
      if (!r.ok && !refused(r.status)) break;
      pendingEnds = pendingEnds.filter((e) => e !== end);
      persistOutbox();
      if (r.ok) await afterAttendance();
    }
  } finally {
    sendingEnds = false;
  }
}

/**
 * Gym floor, "End session". Everyone who logged sets keeps their finished workout; a workout with nothing logged is removed.
 * Attendance and credits are then settled for the whole session in one call (see /api/floor/end), with recaps going to the clients.
 */
export async function endFloorSession(target: AttendanceTarget, rows: FloorEndRow[]): Promise<FloorEndResult> {
  const workoutIds: string[] = [];
  for (const r of rows) {
    const w = r.workoutId ? state.db.workouts.find((x) => x.id === r.workoutId) : undefined;
    if (!w) continue;
    if (r.mark === "PRESENT" && w.exercises.some((we) => we.sets.some((s) => s.done))) {
      finishWorkout(w.id);
      workoutIds.push(w.id);
    } else deleteWorkout(w.id);
  }
  return sendEnd({ kind: target.kind, id: target.id, marks: rows.map((r) => ({ clientId: r.clientId, mark: r.mark, ...(r.deduct ? { deduct: true } : {}) })), workoutIds });
}

/** Coach, gym floor: another of the coach's clients joins the session on the spot. Returns the group they joined, or an error. */
export async function addWalkIn(target: { groupId?: string; bookingId?: string }, clientId: string): Promise<{ groupId: string } | { error: string }> {
  const r = await api<GroupsData & { groupId: string }>("/api/floor/walk-in", { body: { ...target, clientId } });
  if (!r.ok || !r.data) return { error: r.error ?? "Couldn't add them. Please try again." };
  applyGroups(r.data);
  void refreshSchedule();
  void refreshAccounts();
  return { groupId: r.data.groupId };
}

/** Attendance rate and credit log for one client (the coach picks the client; a client always gets their own). */
export async function fetchCreditLog(clientId?: string): Promise<{ stats: AttendanceStats; log: CreditLogEntry[] } | null> {
  const r = await api<{ stats: AttendanceStats; log: CreditLogEntry[] }>(`/api/credits/log${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ""}`);
  return r.ok && r.data ? r.data : null;
}

/* ---------------- Settings ---------------- */
let rulesTimer: ReturnType<typeof setTimeout> | undefined;
const RULE_KEYS: (keyof AppSettings)[] = ["sessionMinutes", "noticeHours", "autoConfirm", "allowCustomGym", "travelEnabled", "travelDefaultMin", "travelParkingMin", "travelMaxMin", "specialties", "sports"];

/** Booking rules live on the server (shared with clients); everything else (brand, rest timer, email toggles) stays on this device. */
function pushRules() {
  const s = state.db.settings;
  return api("/api/schedule/settings", {
    method: "PUT",
    body: {
      sessionMinutes: s.sessionMinutes,
      noticeHours: s.noticeHours,
      autoConfirm: s.autoConfirm,
      allowCustomGym: s.allowCustomGym,
      travelEnabled: s.travelEnabled,
      travelDefaultMin: s.travelDefaultMin,
      travelParkingMin: s.travelParkingMin,
      travelMaxMin: s.travelMaxMin,
      specialties: s.specialties ?? [],
      sports: s.sports ?? [],
      utcOffsetMin: -new Date().getTimezoneOffset(),
    },
  });
}

export function updateSettings(patch: Partial<AppSettings>) {
  mutate((db) => ({ ...db, settings: { ...db.settings, ...patch } }));
  if (RULE_KEYS.some((k) => k in patch)) {
    if (rulesTimer) clearTimeout(rulesTimer);
    rulesTimer = setTimeout(() => void pushRules(), 600);
  }
}

/** Saves settings to the server right away (the niche step needs the server to know the niches before it loads their drills). */
export async function updateSettingsNow(patch: Partial<AppSettings>): Promise<boolean> {
  mutate((db) => ({ ...db, settings: { ...db.settings, ...patch } }));
  if (rulesTimer) clearTimeout(rulesTimer);
  return (await pushRules()).ok;
}

/** Browsing other niches: pulls in every shared drill (not just the coach's own niches). */
export async function loadAllNicheExercises(): Promise<void> {
  const r = await api<{ exercises: Exercise[] }>("/api/training/global");
  if (!r.ok || !r.data) return;
  const have = new Set(state.db.exercises.map((e) => e.id));
  const fresh = r.data.exercises.filter((e) => !have.has(e.id));
  if (fresh.length === 0) return;
  const custom = state.db.exercises.filter((e) => e.custom);
  const rest = state.db.exercises.filter((e) => !e.custom);
  setState({ ...state, db: { ...state.db, exercises: [...rest, ...fresh, ...custom] } });
}

/** Hides a shared-library drill for this coach (and their clients). Custom exercises are deleted instead. */
export async function hideSharedExercise(id: string, hide = true): Promise<void> {
  if (hide) setState({ ...state, db: { ...state.db, exercises: state.db.exercises.filter((e) => e.id !== id) } });
  await api("/api/training/hidden", { method: "PUT", body: { id, hide } });
  if (!hide) await refreshTraining(true);
}
