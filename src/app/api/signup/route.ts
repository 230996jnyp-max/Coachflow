import { NextResponse } from "next/server";
import { readJson, route } from "@/lib/server/http";
import { ipTag } from "@/lib/server/rateLimit";
import { createAccount, parseSignup, verifyCaptcha } from "@/lib/server/signup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** POST — public: makes a Coach, Client or Personal account (it can sign in once the emailed link is opened). */
export const POST = route(async (req) => {
  const body = await readJson(req);
  // A hidden field real people never fill in: bots do. They get the same "thanks" and nothing is stored.
  if (typeof body.website === "string" && body.website.trim()) return NextResponse.json({ ok: true });
  const input = parseSignup(body);
  const ip = ipTag(req);
  await verifyCaptcha(body.captcha, (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim());
  const out = await createAccount(input, ip, process.env.APP_URL || new URL(req.url).origin);
  return NextResponse.json({ ok: true, ...out });
});
