"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Splash } from "@/components/Providers";
import { Welcome } from "@/components/welcome/Welcome";
import { useViewer } from "@/lib/hooks";
import { useIosApp } from "@/lib/nativeApp";

/** Signed-in people go straight to their home; everyone else sees the welcome page (the iPhone app skips it: it has prices, which Apple's rules keep out of the app). */
export default function Index() {
  const { ready, user, isTrainer } = useViewer();
  const router = useRouter();
  const ios = useIosApp();
  useEffect(() => {
    if (!ready) return;
    if (user) router.replace(isTrainer ? "/trainer" : "/home");
    else if (ios) router.replace("/login");
  }, [ready, user, isTrainer, ios, router]);
  if (!ready || user || ios) return <Splash />;
  return <Welcome />;
}
