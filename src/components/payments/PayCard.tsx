"use client";

import { ChevronRight, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import type { BuyOptionsRec } from "@/lib/paymentsApi";
import { api } from "@/lib/store";

/** On a client's home: a way to top up, shown only when their coach has packages for sale. Louder when credits are running low. */
export function PayCard() {
  const { user, db } = useViewer();
  const [options, setOptions] = useState<BuyOptionsRec | null>(null);
  const isClient = user?.role === "CLIENT" && !user.personal;
  useEffect(() => {
    if (!isClient) return;
    let live = true;
    void (async () => {
      const r = await api<{ options: BuyOptionsRec | null }>("/api/payments");
      if (live && r.ok && r.data) setOptions(r.data.options);
    })();
    return () => {
      live = false;
    };
  }, [isClient]);
  if (!isClient || !options) return null;
  const credits = db.clients.find((c) => c.id === user?.id)?.credits ?? 0;
  const low = credits <= 2;
  return (
    <Link href="/pay" className="block">
      <Card className={low ? "flex items-center gap-3 border-accent/40 bg-accent-dim/40 p-4" : "flex items-center gap-3 p-4"}>
        <ShoppingBag size={22} className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{low ? "Running low on sessions" : "Buy sessions"}</div>
          <div className="text-sm text-muted">
            {credits} left. See {options.coachName.split(" ")[0]}’s packages and pay in the app.
          </div>
        </div>
        <ChevronRight size={18} className="text-muted" />
      </Card>
    </Link>
  );
}
