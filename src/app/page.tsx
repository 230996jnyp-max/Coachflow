"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Splash } from "@/components/Providers";
import { Welcome } from "@/components/welcome/Welcome";
import { useViewer } from "@/lib/hooks";

/** Signed-in people go straight to their home; everyone else sees the welcome page. */
export default function Index() {
  const { ready, user, isTrainer } = useViewer();
  const router = useRouter();
  useEffect(() => {
    if (!ready || !user) return;
    router.replace(isTrainer ? "/trainer" : "/home");
  }, [ready, user, isTrainer, router]);
  if (!ready || user) return <Splash />;
  return <Welcome />;
}
