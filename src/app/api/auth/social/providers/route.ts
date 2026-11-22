import { NextResponse } from "next/server";
import { route } from "@/lib/server/http";
import { enabledProviders } from "@/lib/server/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — public: which "Continue with…" buttons to show (only the providers whose keys are set, so nothing shows until they are). */
export const GET = route(async () => NextResponse.json({ providers: enabledProviders() }));
