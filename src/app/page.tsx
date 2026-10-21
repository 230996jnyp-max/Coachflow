"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Splash } from "@/components/Providers";
import { useViewer } from "@/lib/hooks";

export default function Index() {
  const { ready, user, isTrainer } = useViewer();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    router.replace(!user ? "/login" : isTrainer ? "/trainer" : "/home");
  }, [ready, user, isTrainer, router]);
  return <Splash />;
}
