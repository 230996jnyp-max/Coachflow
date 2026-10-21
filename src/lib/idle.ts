/*
 * Inactivity helpers (browser only). Real activity is timestamped in localStorage so it is shared between tabs and
 * survives the app being closed; the server enforces the same 4-hour limit on the session cookie.
 * The saved username is the ONLY credential-related value kept on the device — never a password.
 */

export const IDLE_MS = 4 * 60 * 60 * 1000;
export const IDLE_NOTICE = "Signed out after 4 hours of inactivity for your security. Please re-enter your password.";

const ACTIVE_KEY = "coachflow-last-active";
const NOTICE_KEY = "coachflow-idle-notice";
const USER_KEY = "coachflow-last-username";

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function set(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) — the server-side limit still applies */
  }
}
function del(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function readLastActive(): number | null {
  const v = Number(get(ACTIVE_KEY));
  return Number.isFinite(v) && v > 0 ? v : null;
}
export const markActive = (now = Date.now()) => set(ACTIVE_KEY, String(now));
export const clearActive = () => del(ACTIVE_KEY);

/** True when the device last saw activity more than 4 hours ago. */
export function isIdleStale(now = Date.now()): boolean {
  const last = readLastActive();
  return last !== null && now - last > IDLE_MS;
}

export const setIdleNotice = () => set(NOTICE_KEY, "1");
/** Returns true once (and clears the flag) if the user was just signed out for inactivity. */
export function takeIdleNotice(): boolean {
  const had = get(NOTICE_KEY) === "1";
  if (had) del(NOTICE_KEY);
  return had;
}

export const rememberUsername = (u: string) => {
  const v = u.trim();
  if (v) set(USER_KEY, v.slice(0, 200));
};
export const savedUsername = (): string => get(USER_KEY) ?? "";
