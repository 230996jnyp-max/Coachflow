import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { assertSameOrigin, HttpError, route } from "@/lib/server/http";
import { extractFile, MAX_UPLOAD_BYTES } from "@/lib/server/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** POST <raw file bytes>, header X-File-Name — returns the readable text of a PDF / Word / Excel / CSV / text file for the workout importer. */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const me = await requireUser(["OWNER", "COACH"]);
  void me;
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES) throw new HttpError(413, "That file is too large (4 MB max).");
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0) throw new HttpError(400, "That file is empty.");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new HttpError(413, "That file is too large (4 MB max).");
  let name = "";
  try {
    name = decodeURIComponent(req.headers.get("x-file-name") ?? "");
  } catch {
    name = "";
  }
  const brand = new URL(req.url).searchParams.get("brand")?.slice(0, 60) ?? "CoachFlow";
  return NextResponse.json(await extractFile(name.slice(0, 200), bytes, brand));
});
