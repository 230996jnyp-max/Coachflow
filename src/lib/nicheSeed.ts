import { useSyncExternalStore } from "react";
import { api, refreshTraining } from "./store";

/*
 * Builds each niche's shared library up to about 300 drills in the background, one batch of ~25 at a time, while a coach has the app
 * open. Nothing waits for it: new drills simply appear in the library as each batch lands. Then it makes sure the coach has the
 * starter routines for each niche.
 */

export interface SeedState {
  /** Building drills right now. */
  active: boolean;
  niche: string;
  count: number;
  target: number;
  /** Writing the starter routines. */
  routines: boolean;
}

const IDLE: SeedState = { active: false, niche: "", count: 0, target: 300, routines: false };
let current: SeedState = IDLE;
const listeners = new Set<() => void>();
const set = (next: Partial<SeedState>) => {
  current = { ...current, ...next };
  listeners.forEach((l) => l());
};

export function useNicheSeed(): SeedState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => IDLE,
  );
}

interface Status {
  niche: string;
  count: number;
  target: number;
  done: boolean;
}

let running: Promise<void> | null = null;
let queued: string[] | null = null;
const failed = new Map<string, number>();
const routinesDone = new Set<string>();

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Makes sure these niches have their drills and starter routines. Safe to call again at any time; only one run happens at once. */
export function ensureNiches(niches: string[]): Promise<void> {
  if (running) {
    queued = niches;
    return running;
  }
  running = run(niches).finally(() => {
    running = null;
    if (queued) {
      const next = queued;
      queued = null;
      void ensureNiches(next);
    }
  });
  return running;
}

async function run(niches: string[]): Promise<void> {
  for (const niche of niches) {
    if ((failed.get(niche) ?? 0) >= 3) continue;
    // 1) drills
    let busyTries = 0;
    for (let guard = 0; guard < 40; guard++) {
      const r = await api<{ niche: string; added: number; count: number; target: number; done: boolean; busy?: boolean }>("/api/ai/seed-niche-batch", { body: { niche } });
      if (r.status === 429) {
        // The AI is at its limit for a moment (many coaches, or a big niche): wait and carry on, this is not a failure.
        if (++busyTries > 12) break;
        await wait(20000);
        continue;
      }
      if (!r.ok || !r.data) {
        failed.set(niche, (failed.get(niche) ?? 0) + 1);
        set({ active: false });
        if (r.status === 401 || r.status === 403 || r.status === 503) return; // signed out / no AI: stop quietly
        await wait(6000);
        if ((failed.get(niche) ?? 0) >= 3) break;
        continue;
      }
      const d = r.data;
      if (d.busy) {
        if (++busyTries > 6) break; // someone else is building it; their drills arrive with the next sync
        set({ active: true, niche: d.niche, count: d.count, target: d.target });
        await wait(8000);
        continue;
      }
      if (d.done) {
        if (d.added) await refreshTraining();
        break;
      }
      set({ active: true, niche: d.niche, count: d.count, target: d.target });
      if (d.added) await refreshTraining(); // streams the new drills into the library
    }
    set({ active: false });

    // 2) starter routines (once per niche)
    if (!routinesDone.has(niche)) {
      set({ routines: true, niche });
      const rt = await api("/api/niche/routines", { body: { niche } });
      if (rt.ok) {
        routinesDone.add(niche);
        await refreshTraining(true);
      }
      set({ routines: false });
    }
  }
  set({ active: false, routines: false });
}

export const nicheStatus = async (): Promise<Status[]> => (await api<{ status: Status[] }>("/api/niche")).data?.status ?? [];
