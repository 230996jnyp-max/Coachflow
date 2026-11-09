"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AuthShell } from "@/components/signup/AuthShell";
import { api } from "@/lib/store";

type State = { kind: "working" } | { kind: "ok"; joinedCoach: boolean } | { kind: "bad"; message: string };

/** Public: the link in the confirmation email lands here. */
export default function VerifyPage() {
  const [state, setState] = useState<State>({ kind: "working" });
  const started = useRef(false);

  useEffect(() => {
    // A link can only be used once, so the check must run exactly once even when the page is mounted twice (dev mode).
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    if (!token) {
      Promise.resolve().then(() => setState({ kind: "bad", message: "This link isn't valid. Open the link from your email." }));
      return;
    }
    void api<{ joinedCoach: boolean }>("/api/auth/verify", { body: { token } }).then((r) =>
      setState(r.ok ? { kind: "ok", joinedCoach: !!r.data?.joinedCoach } : { kind: "bad", message: r.error ?? "This link isn't valid." }),
    );
  }, []);

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
            <p className="text-sm text-muted">Your 30-day free trial has started. Sign in to get going.{state.joinedCoach ? " Your coach has been sent your request." : ""}</p>
            <Link href="/login" className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:brightness-110">
              Sign in
            </Link>
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
