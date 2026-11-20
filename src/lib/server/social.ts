import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import { usernameTaken } from "./accounts";
import { db, isLocalTestMode } from "./db";
import { users, type UserRow } from "./schema";
import { afterConfirmed } from "./signup";
import { findIdentity, isProvider, linkIdentity, unlinkIdentity, type ProviderId } from "./socialStore";

/*
 * "Continue with Google / Facebook / Microsoft", by hand: the OAuth authorization-code flow (with PKCE where the provider supports it).
 *  - A signed, short-lived cookie remembers the state and the PKCE secret between leaving for the provider and coming back.
 *  - Only the provider's id for the person, their email and their name are read. No token is stored.
 *  - Google confirms the address, so it can sign someone into an account with that email or create one that needs no confirmation email.
 *    Facebook and Microsoft do not promise their emails are confirmed (anyone could claim an address on a work tenant), so their address is
 *    never trusted: it can't sign in to an existing account, and a new account made with it still gets the confirmation email.
 */

export type Mode = "login" | "signup" | "link";

export class SocialError extends Error {
  constructor(public code: "unavailable" | "state" | "exchange" | "profile" | "denied") {
    super(code);
  }
}

interface Def {
  id: ProviderId;
  label: string;
  authUrl: string;
  tokenUrl: string;
  profileUrl: string;
  scope: string;
  pkce: boolean;
  idEnv: string;
  secretEnv: string;
  extraAuth?: Record<string, string>;
}

const DEFS: Record<ProviderId, Def> = {
  google: {
    id: "google",
    label: "Google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    profileUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
    pkce: true,
    idEnv: "GOOGLE_CLIENT_ID",
    secretEnv: "GOOGLE_CLIENT_SECRET",
    extraAuth: { prompt: "select_account" },
  },
  facebook: {
    id: "facebook",
    label: "Facebook",
    authUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
    profileUrl: "https://graph.facebook.com/v19.0/me",
    scope: "email,public_profile",
    pkce: false,
    idEnv: "FACEBOOK_APP_ID",
    secretEnv: "FACEBOOK_APP_SECRET",
  },
  microsoft: {
    id: "microsoft",
    label: "Microsoft",
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    profileUrl: "https://graph.microsoft.com/oidc/userinfo",
    scope: "openid profile email",
    pkce: true,
    idEnv: "MICROSOFT_CLIENT_ID",
    secretEnv: "MICROSOFT_CLIENT_SECRET",
    extraAuth: { prompt: "select_account", response_mode: "query" },
  },
};

/** Local tests only: a stand-in provider (host:port) replaces all three, so the whole flow can be tried without any real keys. */
const fakeBase = (): string => (isLocalTestMode() ? process.env.OAUTH_FAKE_BASE || "" : "");

function endpoints(def: Def) {
  const f = fakeBase();
  return f ? { authUrl: `${f}/authorize`, tokenUrl: `${f}/token`, profileUrl: `${f}/userinfo` } : { authUrl: def.authUrl, tokenUrl: def.tokenUrl, profileUrl: def.profileUrl };
}

function credentials(def: Def): { id: string; secret: string } | null {
  if (fakeBase()) return { id: "fake-id", secret: "fake-secret" };
  const id = process.env[def.idEnv];
  const secret = process.env[def.secretEnv];
  return id && secret ? { id, secret } : null;
}

/** The buttons to show: only the providers whose keys are set. */
export function enabledProviders(): { id: ProviderId; label: string }[] {
  return (Object.values(DEFS) as Def[]).filter((d) => credentials(d)).map((d) => ({ id: d.id, label: d.label }));
}

/** Which flow the person started (read from the signed cookie), so an error on the way back can be shown on the right page. */
export async function modeOf(cookie: string | undefined): Promise<Mode | null> {
  const st = await open<StatePayload>("oauth", cookie);
  return st && (st.m === "login" || st.m === "signup" || st.m === "link") ? st.m : null;
}

export const redirectUri = (origin: string, provider: ProviderId) => `${origin}/api/auth/social/${provider}/callback`;

/* ---------------- Signed cookies ---------------- */
const key = () => {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
};
async function seal(aud: string, payload: Record<string, unknown>, seconds: number): Promise<string> {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setAudience(aud).setIssuedAt().setExpirationTime(`${seconds}s`).sign(key());
}
async function open<T>(aud: string, token: string | undefined): Promise<(T & JWTPayload) | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"], audience: aud });
    return payload as T & JWTPayload;
  } catch {
    return null;
  }
}
const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const OAUTH_COOKIE = "cf_oauth";
const PENDING_COOKIE = "cf_social";
const secure = () => process.env.NODE_ENV === "production";

export async function setStateCookie(value: string) {
  (await cookies()).set(OAUTH_COOKIE, value, { httpOnly: true, secure: secure(), sameSite: "lax", path: "/api/auth/social", maxAge: 600 });
}
export async function readStateCookie(): Promise<string | undefined> {
  return (await cookies()).get(OAUTH_COOKIE)?.value;
}
export async function clearStateCookie() {
  (await cookies()).set(OAUTH_COOKIE, "", { httpOnly: true, secure: secure(), sameSite: "lax", path: "/api/auth/social", maxAge: 0 });
}

/* ---------------- Leaving for the provider, and coming back ---------------- */
export interface SocialProfile {
  provider: ProviderId;
  subject: string;
  email: string;
  /** The provider has confirmed this address belongs to this person (Google only). */
  emailTrusted: boolean;
  name: string;
}

interface StatePayload {
  p: ProviderId;
  s: string;
  v: string;
  m: Mode;
  u?: string;
}

export async function beginOAuth(provider: ProviderId, mode: Mode, origin: string, userId?: string): Promise<{ url: string; cookie: string }> {
  const def = DEFS[provider];
  const cred = credentials(def);
  if (!cred) throw new SocialError("unavailable");
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const q = new URLSearchParams({
    client_id: cred.id,
    redirect_uri: redirectUri(origin, provider),
    response_type: "code",
    scope: def.scope,
    state,
    ...(def.pkce ? { code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" } : {}),
    ...(def.extraAuth ?? {}),
  });
  const cookie = await seal("oauth", { p: provider, s: state, v: verifier, m: mode, ...(userId ? { u: userId } : {}) } satisfies StatePayload, 600);
  return { url: `${endpoints(def).authUrl}?${q.toString()}`, cookie };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function normalize(provider: ProviderId, j: Record<string, unknown>): SocialProfile | null {
  const subject = text(provider === "facebook" ? (j.id ?? j.sub) : j.sub, 200);
  if (!subject) return null;
  const rawEmail = text(j.email, 200).toLowerCase();
  const email = EMAIL_RE.test(rawEmail) ? rawEmail : "";
  const googleConfirmed = provider === "google" && (j.email_verified === true || j.email_verified === "true");
  return { provider, subject, email, emailTrusted: googleConfirmed && !!email, name: text(j.name, 100) };
}

/** Checks the way back (state, PKCE), swaps the code for the person's basic profile and says which flow they started. */
export async function completeOAuth(provider: ProviderId, input: { code: string; state: string; cookie: string | undefined; origin: string }): Promise<{ profile: SocialProfile; mode: Mode; userId?: string }> {
  const st = await open<StatePayload>("oauth", input.cookie);
  if (!st || st.p !== provider || !input.state || !same(st.s, input.state)) throw new SocialError("state");
  const def = DEFS[provider];
  const cred = credentials(def);
  if (!cred) throw new SocialError("unavailable");
  const ep = endpoints(def);
  let access = "";
  try {
    const res = await fetch(ep.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: input.code, client_id: cred.id, client_secret: cred.secret, redirect_uri: redirectUri(input.origin, provider), ...(def.pkce ? { code_verifier: st.v } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new SocialError("exchange");
    const j = (await res.json()) as Record<string, unknown>;
    access = typeof j.access_token === "string" ? j.access_token : "";
  } catch (e) {
    throw e instanceof SocialError ? e : new SocialError("exchange");
  }
  if (!access) throw new SocialError("exchange");
  try {
    const useQuery = provider === "facebook" && !fakeBase();
    const url = useQuery ? `${ep.profileUrl}?${new URLSearchParams({ fields: "id,name,email", access_token: access })}` : ep.profileUrl;
    const res = await fetch(url, { headers: useQuery ? { Accept: "application/json" } : { Authorization: `Bearer ${access}`, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new SocialError("profile");
    const profile = normalize(provider, (await res.json()) as Record<string, unknown>);
    if (!profile) throw new SocialError("profile");
    return { profile, mode: st.m, userId: st.u };
  } catch (e) {
    throw e instanceof SocialError ? e : new SocialError("profile");
  }
}

/* ---------------- What the sign-in means ---------------- */
export interface Pending {
  provider: ProviderId;
  subject: string;
  email: string;
  name: string;
  trusted: boolean;
}

export type Outcome =
  | { kind: "signin"; user: UserRow }
  | { kind: "new"; pending: Pending }
  | { kind: "exists" }
  | { kind: "conflict" }
  | { kind: "disabled" }
  | { kind: "unverified" }
  | { kind: "no_email" }
  | { kind: "linked" }
  | { kind: "link_taken" };

async function userById(id: string): Promise<UserRow | null> {
  const d = await db();
  const [row] = await d.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}
async function userByEmail(email: string): Promise<UserRow | null> {
  const d = await db();
  const [row] = await d.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`).limit(1);
  return row ?? null;
}

/**
 * The rules:
 *  - login: a provider account already connected signs in. Otherwise, if Google confirms the address and an account has it, that account
 *    is connected and signed in. Facebook and Microsoft can't do that (their address isn't trusted): they are told to sign in the usual
 *    way and connect from Settings. No account at all: they are taken on to finish signing up.
 *  - signup: an account that already exists (this provider account, or the same address) is told so and asked to sign in instead.
 *  - link: a signed-in person connects the provider account, unless it already belongs to someone else.
 */
export async function resolveSocial(mode: Mode, profile: SocialProfile, linkUserId?: string): Promise<Outcome> {
  const known = await findIdentity(profile.provider, profile.subject);

  if (mode === "link") {
    if (!linkUserId || !(await userById(linkUserId))) return { kind: "link_taken" };
    if (known) return known.userId === linkUserId ? { kind: "linked" } : { kind: "link_taken" };
    await linkIdentity(profile.provider, profile.subject, linkUserId, profile.email);
    return { kind: "linked" };
  }

  if (known) {
    const user = await userById(known.userId);
    if (!user) {
      await unlinkIdentity(profile.provider, profile.subject); // the account was deleted
    } else if (mode === "signup") {
      return { kind: "exists" };
    } else {
      if (!user.active) return { kind: "disabled" };
      if (!user.emailVerified) return { kind: "unverified" };
      return { kind: "signin", user };
    }
  }

  if (!profile.email) return { kind: "no_email" };
  const existing = await userByEmail(profile.email);
  if (existing) {
    if (mode === "signup") return { kind: "exists" };
    if (!profile.emailTrusted) return { kind: "conflict" };
    if (!existing.active) return { kind: "disabled" };
    let user = existing;
    if (!existing.emailVerified) {
      // Google confirmed this address, so it counts as confirmed here too.
      const d = await db();
      const [row] = await d.update(users).set({ emailVerified: true, updatedAt: new Date() }).where(eq(users.id, existing.id)).returning();
      if (row) {
        user = row;
        await afterConfirmed(row);
      }
    }
    await linkIdentity(profile.provider, profile.subject, user.id, profile.email);
    return { kind: "signin", user };
  }
  return { kind: "new", pending: { provider: profile.provider, subject: profile.subject, email: profile.email, name: profile.name, trusted: profile.emailTrusted } };
}

/* ---------------- Finishing a sign-up ---------------- */
export async function setPendingCookie(p: Pending) {
  (await cookies()).set(PENDING_COOKIE, await seal("social-pending", { ...p }, 1800), { httpOnly: true, secure: secure(), sameSite: "lax", path: "/", maxAge: 1800 });
}
export async function clearPendingCookie() {
  (await cookies()).set(PENDING_COOKIE, "", { httpOnly: true, secure: secure(), sameSite: "lax", path: "/", maxAge: 0 });
}
export async function readPending(): Promise<Pending | null> {
  const p = await open<Pending>("social-pending", (await cookies()).get(PENDING_COOKIE)?.value);
  if (!p || !isProvider(p.provider) || typeof p.subject !== "string" || typeof p.email !== "string" || !p.subject || !p.email) return null;
  return { provider: p.provider, subject: p.subject, email: p.email, name: typeof p.name === "string" ? p.name : "", trusted: p.trusted === true };
}

/** A starting username from the address, made unique (they can change it before they finish). */
export async function suggestUsername(email: string, name: string): Promise<string> {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9_.-]+/g, "").replace(/^[._-]+/, "");
  let base = clean(email.split("@")[0]).slice(0, 20);
  if (base.length < 3) base = clean(name.replace(/\s+/g, "")).slice(0, 20);
  if (base.length < 3) base = "member";
  if (!(await usernameTaken(base, ""))) return base;
  for (let i = 0; i < 12; i++) {
    const c = `${base.slice(0, 26)}${Math.floor(1000 + Math.random() * 9000)}`;
    if (!(await usernameTaken(c, ""))) return c;
  }
  return `${base.slice(0, 20)}${randomBytes(4).toString("hex")}`;
}
