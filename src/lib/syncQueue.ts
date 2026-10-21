/**
 * Debounced, retrying write-behind queue for one kind of record (workouts, routines…).
 * The store changes local state instantly; this sends the latest version of each changed record to the server.
 */
export type SyncResult = "ok" | "retry" | "drop";

export interface SyncOptions {
  /** Wait this long after the last change before sending (keystroke-heavy workout logging). */
  delay: number;
  save: (id: string, opts: { keepalive: boolean }) => Promise<SyncResult>;
  remove: (id: string, opts: { keepalive: boolean }) => Promise<SyncResult>;
  /** Called when the server refused a change (so the screen can re-sync with what the server has). */
  onDrop?: () => void;
}

/** How long a just-sent record is protected from being overwritten by an older server response. */
const SETTLE_MS = 20_000;

export class SyncQueue {
  private dirty = new Set<string>();
  private removed = new Set<string>();
  private touched = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private again = false;
  private failures = 0;

  constructor(private o: SyncOptions) {}

  save(id: string) {
    this.removed.delete(id);
    this.dirty.add(id);
    this.touched.set(id, Date.now());
    this.schedule(this.o.delay);
  }

  remove(id: string) {
    this.dirty.delete(id);
    this.removed.add(id);
    this.touched.set(id, Date.now());
    this.schedule(0);
  }

  /** True while a record has unsent changes or was sent so recently that a slower server response could be older than it. */
  busy(id: string): boolean {
    if (this.dirty.has(id) || this.removed.has(id)) return true;
    const t = this.touched.get(id);
    return t !== undefined && Date.now() - t < SETTLE_MS;
  }

  get pending(): boolean {
    return this.dirty.size > 0 || this.removed.size > 0;
  }

  clear() {
    if (this.timer) clearTimeout(this.timer);
    this.dirty.clear();
    this.removed.clear();
    this.touched.clear();
    this.failures = 0;
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  /** Sends everything pending. With `keepalive` the requests survive the page being closed. */
  async flush(keepalive = false): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    let dropped = false;
    let retry = false;
    try {
      for (const id of [...this.removed]) {
        const r = await this.o.remove(id, { keepalive });
        if (r === "retry") retry = true;
        else {
          this.removed.delete(id);
          this.touched.set(id, Date.now());
          if (r === "drop") dropped = true;
        }
      }
      for (const id of [...this.dirty]) {
        this.dirty.delete(id); // edits made while this request is in flight re-add the id
        const r = await this.o.save(id, { keepalive });
        if (r === "retry") {
          this.dirty.add(id);
          retry = true;
        } else {
          this.touched.set(id, Date.now());
          if (r === "drop") dropped = true;
        }
      }
    } finally {
      this.running = false;
    }
    if (dropped) this.o.onDrop?.();
    if (retry) {
      this.failures++;
      this.schedule(Math.min(30_000, 2_000 * 2 ** Math.min(this.failures, 4)));
    } else {
      this.failures = 0;
      if (this.again || this.pending) {
        this.again = false;
        this.schedule(this.o.delay);
      }
    }
  }
}
