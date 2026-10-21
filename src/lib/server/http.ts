import "server-only";
import { NextResponse } from "next/server";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const unauthorized = (m = "Please log in.") => new HttpError(401, m);
export const forbidden = (m = "You don't have access to this.") => new HttpError(403, m);
export const notFound = (m = "Not found.") => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);
export const tooMany = (m = "Too many attempts. Try again later.") => new HttpError(429, m);

/** Wraps a handler so thrown HttpErrors become JSON errors and anything else becomes a generic 500 (never leaking details). */
export function route<Ctx = unknown>(handler: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error("API error:", e);
      return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
  };
}

/** Reject cross-site state-changing requests (cookies are SameSite=Lax; this is defence in depth). */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients (curl) don't send Origin; they can't ride a victim's cookie
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    throw forbidden("Bad origin.");
  }
  if (host && originHost !== host) throw forbidden("Cross-site request blocked.");
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  assertSameOrigin(req);
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) throw badRequest("Expected JSON.");
  const text = await req.text();
  if (text.length > 100_000) throw badRequest("Request too large.");
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw badRequest("Invalid JSON.");
  }
}

export function str(v: unknown, name: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string {
  const { min = 1, max = 200, optional = false } = opts;
  if (v === undefined || v === null || v === "") {
    if (optional) return "";
    throw badRequest(`${name} is required.`);
  }
  if (typeof v !== "string") throw badRequest(`${name} must be text.`);
  const s = v.trim();
  if (s.length < min) throw badRequest(`${name} is too short.`);
  if (s.length > max) throw badRequest(`${name} is too long.`);
  return s;
}

export function int(v: unknown, name: string, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`${name} must be a whole number between ${min} and ${max}.`);
  return n;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function email(v: unknown, name = "Email", optional = false): string {
  const s = str(v, name, { optional, max: 200 });
  if (!s) return "";
  if (!EMAIL_RE.test(s)) throw badRequest(`${name} doesn't look valid.`);
  return s.toLowerCase();
}

export function checkPassword(p: unknown, name = "Password"): string {
  if (typeof p !== "string") throw badRequest(`${name} is required.`);
  if (p.length < 8) throw badRequest(`${name} must be at least 8 characters.`);
  if (p.length > 128) throw badRequest(`${name} is too long.`);
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) throw badRequest(`${name} must include a letter and a number.`);
  return p;
}

/** Postgres unique-constraint violation, however deeply the driver wrapped it. */
export function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    if ((cur as { code?: string }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
