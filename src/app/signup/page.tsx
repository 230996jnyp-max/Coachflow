"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { Splash } from "@/components/Providers";
import { SignupWizard } from "@/components/signup/SignupWizard";
import { useViewer } from "@/lib/hooks";
import type { SignupRole } from "@/lib/signupRules";

/** The welcome page can pre-pick a role: ?role=coach, ?role=personal, ?role=client or ?role=gym. */
function roleFrom(v: string | null): SignupRole | null {
  return v === "coach" ? "COACH" : v === "personal" ? "PERSONAL" : v === "client" ? "CLIENT" : v === "gym" ? "GYM" : null;
}

function Inner() {
  const { ready, user, isTrainer } = useViewer();
  const router = useRouter();
  const params = useSearchParams();
  const gymCode = params.get("gym") ?? "";
  const refCode = params.get("ref") ?? "";
  // A coach's public page sends people here with ?coach=<their code>.
  const coachCode = params.get("coach") ?? "";
  // An invitation link (?role=coach&gym=123456) opens the coach sign-up with the gym code already in.
  const role = roleFrom(params.get("role")) ?? (coachCode ? "CLIENT" : gymCode || refCode ? "COACH" : null);

  // Someone who is already signed in has no need for this page.
  useEffect(() => {
    if (ready && user) router.replace(isTrainer ? "/trainer" : "/home");
  }, [ready, user, isTrainer, router]);

  if (!ready || user) return <Splash />;
  return <SignupWizard initialRole={role} initialGymCode={gymCode} initialRef={refCode} initialCoachCode={coachCode} />;
}

/** Public: make a Coach, Client or Personal account. */
export default function SignupPage() {
  return (
    <Suspense fallback={<Splash />}>
      <Inner />
    </Suspense>
  );
}
