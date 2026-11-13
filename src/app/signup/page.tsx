"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { Splash } from "@/components/Providers";
import { SignupWizard } from "@/components/signup/SignupWizard";
import { useViewer } from "@/lib/hooks";
import type { SignupRole } from "@/lib/signupRules";

/** The welcome page can pre-pick a role: ?role=coach, ?role=personal or ?role=client. */
function roleFrom(v: string | null): SignupRole | null {
  return v === "coach" ? "COACH" : v === "personal" ? "PERSONAL" : v === "client" ? "CLIENT" : null;
}

function Inner() {
  const { ready, user, isTrainer } = useViewer();
  const router = useRouter();
  const params = useSearchParams();
  const gymCode = params.get("gym") ?? "";
  // An invitation link (?role=coach&gym=123456) opens the coach sign-up with the gym code already in.
  const role = roleFrom(params.get("role")) ?? (gymCode ? "COACH" : null);

  // Someone who is already signed in has no need for this page.
  useEffect(() => {
    if (ready && user) router.replace(isTrainer ? "/trainer" : "/home");
  }, [ready, user, isTrainer, router]);

  if (!ready || user) return <Splash />;
  return <SignupWizard initialRole={role} initialGymCode={gymCode} />;
}

/** Public: make a Coach, Client or Personal account. */
export default function SignupPage() {
  return (
    <Suspense fallback={<Splash />}>
      <Inner />
    </Suspense>
  );
}
