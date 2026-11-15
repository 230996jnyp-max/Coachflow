"use client";

import { Sparkles, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useTourWho } from "@/components/tour/useTourWho";
import { Button } from "@/components/ui";
import { markToursSeen } from "@/lib/store";
import { startTour, useTour } from "@/lib/tour";
import { whatsNewFor } from "@/lib/tourSteps";

/**
 * Someone who finished the guided tour before a part of it existed (the clients and forms part for a coach, the forms part for a client)
 * is offered it once: "Show me" plays just that part, "Not now" and the close button both remember the answer so it isn't offered again.
 * It can always be replayed from Settings, Legal & help.
 */
export function WhatsNew() {
  const { user, who, seen } = useTourWho();
  const tour = useTour();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  const seenKey = seen.join(",");
  const parts = useMemo(() => whatsNewFor(who, seenKey ? seenKey.split(",") : [], user?.hasCompletedOnboarding === true), [who, seenKey, user?.hasCompletedOnboarding]);

  // Not the moment someone signs in, and never on screens where they are busy.
  const show = !!user && !user.mustChangePassword && parts.length > 0 && !tour.active && !pathname.startsWith("/floor") && !pathname.startsWith("/workout/") && !pathname.startsWith("/settings/password");
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setReady(true), 2500);
    return () => clearTimeout(t);
  }, [show]);

  if (!show || !ready) return null;
  const ids = parts.map((p) => p.id);
  const dismiss = () => markToursSeen(ids);

  return (
    <div role="region" aria-label="What's new" className="fixed inset-x-3 top-16 z-[70] rounded-2xl border border-accent/40 bg-surface p-4 shadow-2xl md:left-auto md:right-4 md:top-4 md:w-96">
      <div className="flex items-start gap-3">
        <Sparkles size={20} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="font-bold">New in CoachFlow</div>
          <ul className="mt-1 space-y-1 text-sm text-muted">
            {parts.map((p) => (
              <li key={p.id}>
                <span className="font-semibold text-ink">{p.label}.</span> {p.blurb}.
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                startTour(ids);
              }}
            >
              Show me (1 minute)
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Not now
            </Button>
          </div>
        </div>
        <button type="button" aria-label="Close" onClick={dismiss} className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-field hover:text-ink">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
