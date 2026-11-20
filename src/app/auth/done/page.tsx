"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { AuthShell } from "@/components/signup/AuthShell";
import { adoptSession } from "@/lib/store";

/** Where "Continue with Google / Facebook / Microsoft" lands once the server has signed this browser in: load the account, then go in. */
export default function SignedInPage() {
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // The login page sends someone who is signed in on to their own home screen.
    void adoptSession().then((ok) => router.replace(ok ? "/login" : "/login?social=error"));
  }, [router]);

  return (
    <AuthShell title="Signing you in">
      <div className="space-y-4 text-center">
        <Loader2 size={40} className="mx-auto animate-spin text-accent" />
        <p className="text-sm text-muted">One moment…</p>
      </div>
    </AuthShell>
  );
}
