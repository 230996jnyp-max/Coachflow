"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AuthShell } from "@/components/signup/AuthShell";
import { adoptSession, api } from "@/lib/store";

type State = { kind: "working" } | { kind: "ok"; joinedCoach: boolean; signedIn: boolean } | { kind: "bad"; message: string };

/** Public: the link in the confirmation email lands here. */
export default function VerifyPage() {
  const [state, setState] = useState<State>({ kind: "working" });
  const started = useRef(false);
  const router = useRouter();

  useEffect(() => {
    // A link can only be used once, so the check must run exactly once even when the page is mounted twice (dev mode).
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    if (!token) {
      Promise.resolve().then(() => setState({ kind: "bad", message: "This link isn't valid. Open the link from your email." }));
      return;
    }
    void (async () => {
      const r = await api<{ joinedCoach: boolean; signedIn: boolean; role: string }>("/api/auth/verify", { body: { token } });
      if (!r.ok) return setState({ kind: "bad", message: r.error ?? "This link isn't valid." });
      // The link signs this device in, so there is no second sign-in: load the account and go straight into the app.
      const signedIn = !!r.data?.signedIn && (await adoptSession());
      setState({ kind: "ok", joinedCoach: !!r.data?.joinedCoach, signedIn });
      if (signedIn) setTimeout(() => router.replace(r.data?.role === "COACH" ? "/trainer" : "/home"), 1400);
    })();
  }, [router]);

  return (
    <AuthShell title="Confirming your email">
      <div className="space-y-4 text-center">
        {state.kind === "working" && (
          <>
            <Loader2 size={40} className="mx-auto animate-spin text-accent" />
            <p className="text-sm text-muted">One moment…</p>
          </>
        )}
        {state.kind === "ok" && (
          <>
            <CheckCircle2 size={44} className="mx-auto rounded-full bg-success/15 p-2.5 text-success" />
            <h2 className="text-lg font-bold">Email confirmed</h2>
            <p className="text-sm text-muted">Your 30-day free trial has started.{state.joinedCoach ? " Your coach has been sent your request." : ""}</p>
            {state.signedIn ? (
              <p className="flex items-center justify-center gap-2 text-sm font-semibold text-accent">
                <Loader2 size={16} className="animate-spin" /> Taking you in…
              </p>
            ) : (
              <Link href="/login" className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:brightness-110">
                Sign in to get going
              </Link>
            )}
          </>
        )}
        {state.kind === "bad" && (
          <>
            <XCircle size={44} className="mx-auto rounded-full bg-danger/15 p-2.5 text-danger" />
            <h2 className="text-lg font-bold">This link didn&apos;t work</h2>
            <p className="text-sm text-muted">{state.message}</p>
            <Link href="/login" className="inline-flex min-h-11 items-center justify-center text-sm font-semibold text-accent">
              Go to sign in
            </Link>
          </>
        )}
      </div>
    </AuthShell>
  );
}
