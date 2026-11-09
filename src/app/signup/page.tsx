"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Splash } from "@/components/Providers";
import { SignupWizard } from "@/components/signup/SignupWizard";
import { useViewer } from "@/lib/hooks";

/** Public: make a Coach, Client or Personal account. */
export default function SignupPage() {
  const { ready, user, isTrainer } = useViewer();
  const router = useRouter();

  // Someone who is already signed in has no need for this page.
  useEffect(() => {
    if (ready && user) router.replace(isTrainer ? "/trainer" : "/home");
  }, [ready, user, isTrainer, router]);

  if (!ready || user) return <Splash />;
  return <SignupWizard />;
}
