"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { completeOnboarding, deviceOnboarded } from "@/lib/store";
import { CLIENT_STEPS, closeTour, COACH_STEPS, findTarget, goToStep, PERSONAL_STEPS, startTour, useTour } from "@/lib/tour";
import { cn } from "@/lib/utils";

interface Geo {
  rect: { x: number; y: number; w: number; h: number } | null;
  vw: number;
  vh: number;
}

const sameGeo = (a: Geo, b: Geo) => a.vw === b.vw && a.vh === b.vh && (a.rect === b.rect || (!!a.rect && !!b.rect && a.rect.x === b.rect.x && a.rect.y === b.rect.y && a.rect.w === b.rect.w && a.rect.h === b.rect.h));
const triedAuto = new Set<string>();
const PAD = 8;
const CARD_H = 236;

/**
 * Interactive spotlight tour: dims the page, rings the target with an animated accent border and shows a step card.
 * Starts by itself on a person's first login (after they set their own password) and can be replayed from Settings.
 */
export function OnboardingTour() {
  const { user, isTrainer, isPersonal } = useViewer();
  const tour = useTour();
  const router = useRouter();
  const pathname = usePathname();
  const steps = isTrainer ? COACH_STEPS : isPersonal ? PERSONAL_STEPS : CLIENT_STEPS;
  const index = Math.min(tour.step, steps.length - 1);
  const step = steps[index];
  const [geo, setGeo] = useState<Geo>({ rect: null, vw: 0, vh: 0 });

  // First login: start once, only for accounts that haven't finished or skipped it (on the account or on this device).
  useEffect(() => {
    if (!user || user.mustChangePassword || user.hasCompletedOnboarding !== false) return;
    const t = setTimeout(() => {
      if (triedAuto.has(user.id) || deviceOnboarded(user.id)) return;
      triedAuto.add(user.id);
      startTour();
    }, 1200);
    return () => clearTimeout(t);
  }, [user]);

  // Each step belongs to a page: go there.
  useEffect(() => {
    if (tour.active && step && pathname !== step.route) router.push(step.route);
  }, [tour.active, step, pathname, router]);

  // Follow the target every frame (it can move while the page loads, scrolls or resizes).
  useEffect(() => {
    if (!tour.active || !step) return;
    let raf = 0;
    let scrolls = 0;
    let lastDocTop = Number.NaN;
    const loop = () => {
      const el = window.location.pathname === step.route ? findTarget(step.targets) : null;
      let rect: Geo["rect"] = null;
      if (el) {
        const r = el.getBoundingClientRect();
        // A target taller than the screen (e.g. the week calendar): bring its top into view and light up just that part.
        const tall = r.height > window.innerHeight * 0.55;
        // Scroll to it once, and again if the page layout shifts under it while content loads.
        const docTop = r.top + window.scrollY;
        if (scrolls < 10 && (Number.isNaN(lastDocTop) || Math.abs(docTop - lastDocTop) > 40)) {
          scrolls++;
          lastDocTop = docTop;
          if (tall) window.scrollTo({ top: Math.max(0, docTop - 90), behavior: "instant" });
          else el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        rect = { x: r.left, y: r.top, w: r.width, h: tall ? Math.round(window.innerHeight * 0.42) : r.height };
      }
      const next: Geo = { rect, vw: window.innerWidth, vh: window.innerHeight };
      setGeo((prev) => (sameGeo(prev, next) ? prev : next));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tour.active, step]);

  const finish = () => {
    closeTour();
    completeOnboarding();
  };
  const next = () => (index >= steps.length - 1 ? finish() : goToStep(index + 1));
  const back = () => index > 0 && goToStep(index - 1);

  // The page is frozen while the tour is open: the tour itself scrolls to each target, the person can't.
  useEffect(() => {
    if (!tour.active) return;
    const html = document.documentElement;
    const body = document.body;
    const prev = { overflow: html.style.overflow, pad: body.style.paddingRight };
    const bar = window.innerWidth - html.clientWidth;
    html.style.overflow = "hidden";
    if (bar > 0) body.style.paddingRight = `${bar}px`; // keep the layout from jumping when the scrollbar disappears
    const stop = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };
    const SCROLL_KEYS = new Set([" ", "PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"]);
    const onScrollKey = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.has(e.key) && !(e.target instanceof HTMLElement && e.target.closest("button, a, input, textarea, select") && e.key === " ")) stop(e);
    };
    const opts = { passive: false, capture: true } as const;
    window.addEventListener("wheel", stop, opts);
    window.addEventListener("touchmove", stop, opts);
    window.addEventListener("keydown", onScrollKey, true);
    return () => {
      html.style.overflow = prev.overflow;
      body.style.paddingRight = prev.pad;
      window.removeEventListener("wheel", stop, opts);
      window.removeEventListener("touchmove", stop, opts);
      window.removeEventListener("keydown", onScrollKey, true);
    };
  }, [tour.active]);

  useEffect(() => {
    if (!tour.active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // finish / next / back only depend on the step
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour.active, index]);

  if (!tour.active || !user || !step) return null;

  const { rect, vw, vh } = geo;
  const W = Math.min(380, Math.max(260, vw - 24));
  const spot = rect && {
    left: Math.max(4, rect.x - PAD),
    top: Math.max(4, rect.y - PAD),
    width: Math.min(vw - 8, rect.w + PAD * 2),
    height: Math.min(vh - 8, rect.h + PAD * 2),
  };

  // Card position: next to the target (below, else above); on a phone at the top or bottom edge, away from the target.
  let left = (vw - W) / 2;
  let top = (vh - CARD_H) / 2;
  if (rect) {
    const bottom = rect.y + rect.h;
    if (vw < 640) top = rect.y + rect.h / 2 > vh / 2 ? 12 : vh - CARD_H - 12;
    else {
      left = Math.min(Math.max(rect.x, 12), vw - W - 12);
      if (vh - bottom >= CARD_H + 28) top = bottom + PAD + 12;
      else if (rect.y >= CARD_H + 28) top = rect.y - PAD - CARD_H - 12;
      else {
        top = vh - CARD_H - 16;
        left = vw - W - 16;
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[200]" role="dialog" aria-modal="true" aria-label="Guided tour">
      {/* Blocks clicks on the page while the tour is open; dims everything when there is nothing to point at yet */}
      <div className={cn("absolute inset-0", !spot && "bg-black/75")} />
      {spot && <div className="tour-spot pointer-events-none absolute" style={spot} />}
      <div className="absolute rounded-2xl border border-accent/40 bg-surface p-4 shadow-2xl" style={{ left, top, width: W, minHeight: CARD_H - 40 }}>
        <div className="flex items-start justify-between gap-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-accent">
            Step {index + 1} of {steps.length}
          </div>
          <button type="button" onClick={finish} aria-label="Skip tour" className="-mr-1 -mt-1 flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-field hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <h3 className="mt-1 text-lg font-bold leading-tight">{step.title}</h3>
        <p className="mt-1.5 text-sm text-muted">{step.text}</p>
        <div className="mt-3 flex items-center gap-1" aria-hidden>
          {steps.map((_, i) => (
            <span key={i} className={cn("h-1.5 rounded-full transition-all", i === index ? "w-5 bg-accent" : "w-1.5 bg-line")} />
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={finish}>
            Skip Tour
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={back} disabled={index === 0}>
              <ChevronLeft size={14} /> Back
            </Button>
            <Button size="sm" onClick={next}>
              {index >= steps.length - 1 ? "Finish" : "Next"} {index < steps.length - 1 && <ChevronRight size={14} />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
