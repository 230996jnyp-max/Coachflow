import { NextResponse } from "next/server";
import { email, readJson, route, str } from "@/lib/server/http";
import { parsePhone, submitRequest } from "@/lib/server/signup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** POST { fullName, email, phone } — public: someone asks for a coach account. Nothing is created until the owner approves. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  // A hidden field real people never fill in: bots do. They get the same "thanks" and nothing is stored.
  if (typeof body.website === "string" && body.website.trim()) return NextResponse.json({ ok: true });
  const fullName = str(body.fullName, "Full name", { min: 2, max: 100 });
  const address = email(body.email, "Email address");
  const phone = parsePhone(body.phone);
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  await submitRequest({ fullName, email: address, phone, ip }, process.env.APP_URL || new URL(req.url).origin);
  return NextResponse.json({ ok: true });
});
