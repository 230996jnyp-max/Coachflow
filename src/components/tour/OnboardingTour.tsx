"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTourWho } from "@/components/tour/useTourWho";
import { Button } from "@/components/ui";
import { completeOnboarding, deviceOnboarded, markToursSeen } from "@/lib/store";
import { closeTour, findTarget, goToStep, startTour, useTour } from "@/lib/tour";
import { autoSectionForPath, chainForNewAccount, resolveRoute, stepsFor } from "@/lib/tourSteps";
import { cn } from "@/lib/utils";

interface Geo {
  rect: { x: number; y: number; w: number; h: number } | null;
  vw: number;
  vh: number;
  /** The step card's real height (its text is longer on some steps), so it can be kept fully on screen. */
  ch: number;
}

const sameGeo = (a: Geo, b: Geo) => a.vw === b.vw && a.vh === b.vh && a.ch === b.ch && (a.rect === b.rect || (!!a.rect && !!b.rect && a.rect.x === b.rect.x && a.rect.y === b.rect.y && a.rect.w === b.rect.w && a.rect.h === b.rect.h));
const triedAuto = new Set<string>();
const triedVisit = new Set<string>();
const PAD = 8;
const CARD_H = 236;

/**
 * Interactive spotlight tour: dims the page, rings the target with an animated accent border and shows a step card.
 * It is made of parts (the basics, clients and forms, the gym portal, Admin). A new account gets the basics and the parts that go with
 * them after its first sign-in; the gym and Admin parts start the first time those pages are opened; any part can be replayed from
 * Settings. Someone who finished the tour before a part existed is offered it once (see WhatsNew).
 */
export function OnboardingTour() {
  const { user, who, firstClientId, seen } = useTourWho();
  const tour = useTour();
  const router = useRouter();
  const pathname = usePathname();
  const ctx = useMemo(() => ({ firstClientId }), [firstClientId]);
  const steps = useMemo(() => stepsFor(tour.ids, who, ctx), [tour.ids, who, ctx]);
  const index = Math.min(tour.step, Math.max(0, steps.length - 1));
  const step = steps[index];
  const route = step ? resolveRoute(step.route, ctx) : "";
  const [geo, setGeo] = useState<Geo>({ rect: null, vw: 0, vh: 0, ch: CARD_H });
  const clicked = useRef("");
  const cardRef = useRef<HTMLDivElement>(null);

  // First login: start once, only for accounts that haven't finished or skipped it (on the account or on this device).
  useEffect(() => {
    if (!user || user.mustChangePassword || user.hasCompletedOnboarding !== false) return;
    const t = setTimeout(() => {
      if (triedAuto.has(user.id) || deviceOnboarded(user.id)) return;
      triedAuto.add(user.id);
      startTour(chainForNewAccount(who));
    }, 1200);
    return () => clearTimeout(t);
  }, [user, who]);

  // The gym portal and Admin have their own part: it starts the first time the person opens that page (after they finished the basics).
  const seenKey = seen.join(",");
  useEffect(() => {
    if (!user || tour.active || user.mustChangePassword || user.hasCompletedOnboarding !== true) return;
    const sec = autoSectionForPath(who, seenKey ? seenKey.split(",") : [], pathname);
    if (!sec || triedVisit.has(`${user.id}:${sec.id}`)) return;
    const t = setTimeout(() => {
      triedVisit.add(`${user.id}:${sec.id}`);
      startTour([sec.id]);
    }, 900);
    return () => clearTimeout(t);
  }, [user, who, tour.active, pathname, seenKey]);

  // A tour with nothing to show (for example no step applies to this person) closes instead of freezing the page.
  useEffect(() => {
    if (tour.active && steps.length === 0) closeTour();
  }, [tour.active, steps.length]);

  // Each step belongs to a page: go there.
  useEffect(() => {
    if (tour.active && step && pathname !== route) router.push(route);
  }, [tour.active, step, route, pathname, router]);

  // Follow the target every frame (it can move while the page loads, scrolls or resizes).
  useEffect(() => {
    if (!tour.active || !step) {
      clicked.current = "";
      return;
    }
    const key = `${tour.ids.join(",")}:${index}`;
    let raf = 0;
    let scrolls = 0;
    let lastDocTop = Number.NaN;
    const loop = () => {
      const el = window.location.pathname === route ? findTarget(step.targets) : null;
      let rect: Geo["rect"] = null;
      if (el) {
        // A step about a tab presses it once, so the page underneath shows what the step is about.
        if (step.click && clicked.current !== key) {
          clicked.current = key;
          el.click();
        }
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
      const next: Geo = { rect, vw: window.innerWidth, vh: window.innerHeight, ch: cardRef.current?.offsetHeight || CARD_H };
      setGeo((prev) => (sameGeo(prev, next) ? prev : next));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tour.active, tour.ids, step, route, index]);

  const finish = () => {
    const ids = tour.ids;
    closeTour();
    completeOnboarding();
    markToursSeen(ids);
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
    // finish / next / back only depend on the step and the parts being played
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour.active, index, tour.ids]);

  if (!tour.active || !user || !step) return null;

  const { rect, vw, vh } = geo;
  const CH = Math.min(geo.ch, Math.max(120, vh - 24));
  const W = Math.min(380, Math.max(260, vw - 24));
  const spot = rect && {
    left: Math.max(4, rect.x - PAD),
    top: Math.max(4, rect.y - PAD),
    width: Math.min(vw - 8, rect.w + PAD * 2),
    height: Math.min(vh - 8, rect.h + PAD * 2),
  };

  // Card position: next to the target (below, else above); on a phone at the top or bottom edge, away from the target.
  let left = (vw - W) / 2;
  let top = (vh - CH) / 2;
  if (rect) {
    const bottom = rect.y + rect.h;
    if (vw < 640) top = rect.y + rect.h / 2 > vh / 2 ? 12 : vh - CH - 12;
    else {
      left = Math.min(Math.max(rect.x, 12), vw - W - 12);
      if (vh - bottom >= CH + 28) top = bottom + PAD + 12;
      else if (rect.y >= CH + 28) top = rect.y - PAD - CH - 12;
      else {
        top = vh - CH - 16;
        left = vw - W - 16;
      }
    }
  }
  top = Math.max(8, top);

  return (
    <div className="fixed inset-0 z-[200]" role="dialog" aria-modal="true" aria-label="Guided tour">
      {/* Blocks clicks on the page while the tour is open; dims everything when there is nothing to point at yet */}
      <div className={cn("absolute inset-0", !spot && "bg-black/75")} />
      {spot && <div className="tour-spot pointer-events-none absolute" style={spot} />}
      <div ref={cardRef} className="absolute overflow-y-auto rounded-2xl border border-accent/40 bg-surface p-4 shadow-2xl" style={{ left, top, width: W, minHeight: CARD_H - 40, maxHeight: vh - 16 }}>
        <div className="flex items-start justify-between gap-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-accent">
            Step {index + 1} of {steps.length}
            <span className="ml-1.5 font-semibold normal-case tracking-normal text-muted">· {step.sectionLabel}</span>
          </div>
          <button type="button" onClick={finish} aria-label="Skip tour" className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-field hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <h3 className="mt-1 text-lg font-bold leading-tight">{step.title}</h3>
        <p className="mt-1.5 text-sm text-muted">{step.text}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1" aria-hidden>
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
