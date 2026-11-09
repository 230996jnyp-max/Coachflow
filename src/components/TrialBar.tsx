"use client";

import { Clock, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/ui";
import { SUPPORT_EMAIL } from "@/lib/support";
import { logout } from "@/lib/store";
import type { User } from "@/lib/types";

/** A slim reminder of the free month: shown for the last two weeks, and after it ends (until payments are switched on, nothing is blocked). */
export function TrialBar({ trial }: { trial: NonNullable<User["trial"]> }) {
  if (!trial.expired && trial.daysLeft > 14) return null;
  const text = trial.expired
    ? "Your free month has ended. Paid plans are opening soon, and you can keep using CoachFlow for now."
    : trial.daysLeft <= 1
      ? "Your free trial ends today."
      : `${trial.daysLeft} days left of your free trial.`;
  return (
    <div className="mb-4 flex items-center gap-2 rounded-xl border border-pr/30 bg-pr/10 px-3 py-2 text-sm">
      <Clock size={16} className="shrink-0 text-pr" />
      <span className="min-w-0 flex-1">{text}</span>
    </div>
  );
}

/** Shown instead of the app once the free month is over and enforcement is on (TRIAL_ENFORCED=1). Nothing is deleted. */
export function TrialGate() {
  const router = useRouter();
  return (
    <div className="pt-safe pb-safe flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-sm space-y-4 p-6 text-center">
        <Clock size={40} className="mx-auto rounded-full bg-pr/15 p-2.5 text-pr" />
        <h1 className="text-xl font-bold">Your free month has ended</h1>
        <p className="text-sm text-muted">
          Thanks for trying CoachFlow. Your account and everything in it is safe and will be here when paid plans open. Questions? {SUPPORT_EMAIL}
        </p>
        <Button variant="secondary" className="w-full" onClick={() => void logout().then(() => router.replace("/login"))}>
          <LogOut size={16} /> Sign out
        </Button>
      </Card>
    </div>
  );
}
