"use client";

import { Video } from "lucide-react";
import Link from "next/link";
import { CONSULT_MINUTES, CONSULT_PRICE_CENTS, money } from "@/lib/consults";

/** On the AI trainer page: the way to a real trainer for an hour. */
export function ConsultCard() {
  return (
    <Link href="/consult" className="flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent/10 p-4 transition-colors hover:border-accent/60">
      <Video size={22} className="shrink-0 text-accent" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold">Talk it through with a real trainer</div>
        <div className="text-xs text-muted">
          {CONSULT_MINUTES}-minute video consult about your plan, form or progress, {money(CONSULT_PRICE_CENTS)} one-off. Only charged when a trainer accepts.
        </div>
      </div>
      <span className="shrink-0 text-xs font-bold text-accent">Book →</span>
    </Link>
  );
}
