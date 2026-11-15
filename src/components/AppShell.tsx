"use client";

import { NicheSeeder, NicheStep } from "@/components/sports/NicheStep";
import { refreshPendingCount, usePendingCoachRequests } from "@/lib/adminPending";
import { useNicheStepPending } from "@/lib/nicheGate";
import {
  Apple,
  Building2,
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  Dumbbell,
  Home,
  LayoutDashboard,
  LineChart,
  ListChecks,
  MessageCircle,
  Settings,
  ShieldCheck,
  Timer,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { clientThread, coachThread, dismissToast, startChatSync, unreadFor, useChat } from "@/lib/chat";
import { hasPortalAccess } from "@/lib/gymPerms";
import { useViewer } from "@/lib/hooks";
import { refreshAccounts, refreshGroups, refreshSchedule } from "@/lib/store";
import { cn } from "@/lib/utils";
import { FloorBanner } from "./floor/FloorBanner";
import { NotificationBell } from "./groups/NotificationBell";
import { Personalize, hasBackground } from "./Personalize";
import { ProfileMenu } from "./ProfileMenu";
import { OnboardingTour } from "./tour/OnboardingTour";
import { WhatsNew } from "./tour/WhatsNew";
import { InstallPrompt } from "./InstallPrompt";
import { Splash } from "./Providers";
import { TrialBar, TrialGate } from "./TrialBar";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  mobile?: boolean;
}

const TRAINER_NAV: NavItem[] = [
  { href: "/trainer", label: "Dashboard", icon: <LayoutDashboard size={22} />, mobile: true },
  { href: "/clients", label: "Clients", icon: <Users size={22} />, mobile: true },
  { href: "/schedule", label: "Schedule", icon: <CalendarDays size={22} />, mobile: true },
  { href: "/workout", label: "Workout", icon: <Dumbbell size={22} />, mobile: true },
  { href: "/messages", label: "Messages", icon: <MessageCircle size={22} />, mobile: true },
  { href: "/exercises", label: "Exercises", icon: <ListChecks size={22} /> },
  { href: "/settings", label: "Settings", icon: <Settings size={22} /> },
];

const CLIENT_NAV: NavItem[] = [
  { href: "/home", label: "Home", icon: <Home size={22} />, mobile: true },
  { href: "/workout", label: "Workout", icon: <Dumbbell size={22} />, mobile: true },
  { href: "/progress", label: "Progress", icon: <LineChart size={22} />, mobile: true },
  { href: "/nutrition", label: "Nutrition", icon: <Apple size={22} />, mobile: true },
  { href: "/book", label: "Book", icon: <CalendarDays size={22} />, mobile: true },
  { href: "/messages", label: "Messages", icon: <MessageCircle size={22} />, mobile: true },
  { href: "/exercises", label: "Exercises", icon: <ListChecks size={22} /> },
  { href: "/settings", label: "Profile", icon: <UserRound size={22} /> },
];

const TRAINER_ONLY = ["/trainer", "/clients", "/schedule", "/floor"];
const OWNER_ONLY = ["/admin"];
const ADMIN_NAV: NavItem = { href: "/admin", label: "Admin", icon: <ShieldCheck size={22} /> };
const GYM_NAV: NavItem = { href: "/gym-admin", label: "Gym", icon: <Building2 size={22} /> };
const CLIENT_ONLY = ["/home", "/progress", "/book", "/nutrition", "/intake"];

export function AppShell({ children }: { children: ReactNode }) {
  const { ready, user, isTrainer, db, isPersonal, isMinor } = useViewer();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const chat = useChat();
  const threads = useMemo(() => {
    if (!user) return [];
    if (isPersonal) return []; // nobody to chat with until a coach accepts them
    if (!isTrainer) return [clientThread(user.id)];
    const t = db.clients.map((c) => clientThread(c.id));
    if (user.isOwner) {
      for (const u of db.users) if (u.role === "TRAINER" && !u.isOwner) t.push(coachThread(u.id));
    } else {
      t.push(coachThread(user.id));
    }
    return t;
  }, [user, isTrainer, isPersonal, db.clients, db.users]);
  const unread = user ? threads.reduce((n, t) => n + unreadFor(chat, user.id, t), 0) : 0;

  const forbidden =
    !!user &&
    ((isTrainer && CLIENT_ONLY.some((p) => pathname.startsWith(p))) ||
      (!isTrainer && TRAINER_ONLY.some((p) => pathname.startsWith(p))) ||
      (!user.isOwner && OWNER_ONLY.some((p) => pathname.startsWith(p))) ||
      (pathname.startsWith("/gym-admin") && !hasPortalAccess(user.gym)) ||
      (isPersonal && ["/book", "/messages", "/classes", "/intake"].some((p) => pathname.startsWith(p))) ||
      (isMinor && pathname.startsWith("/nutrition")));
  // Accounts using a temporary password must choose their own before doing anything else.
  const mustChange = !!user?.mustChangePassword && !pathname.startsWith("/settings/password");
  const nicheStep = useNicheStepPending();
  // A coach accepted this person: switch them from "training on my own" to a coach's client without making them reload.
  const acceptedUnread = isPersonal && db.notifications.some((n) => n.kind === "coach_accepted" && !n.read);
  useEffect(() => {
    if (!acceptedUnread) return;
    void Promise.all([refreshAccounts(), refreshSchedule(), refreshGroups()]);
  }, [acceptedUnread]);
  const pendingCoaches = usePendingCoachRequests();
  const isOwner = !!user?.isOwner;
  // The owner sees how many coach sign-up requests are waiting (a badge on Admin), refreshed every minute.
  useEffect(() => {
    if (!isOwner) return;
    void refreshPendingCount();
    const t = setInterval(() => void refreshPendingCount(), 60_000);
    return () => clearInterval(t);
  }, [isOwner]);

  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace("/login");
    else if (mustChange) router.replace("/settings/password");
    else if (forbidden) router.replace(isTrainer ? "/trainer" : "/home");
  }, [ready, user, forbidden, mustChange, isTrainer, router]);

  if (!ready || !user || forbidden || mustChange) return <Splash />;
  if (user.trial?.enforced && user.trial.expired && !user.isOwner) return <TrialGate />;
  // A coach who has not chosen a niche yet picks one (after the set-your-password screen) before reaching the dashboard. It is saved to the
  // account, so signing in again does not ask; Settings → Coaching can reopen it to change it.
  if (isTrainer && (nicheStep || (db.settings.specialties ?? []).length === 0) && !user.mustChangePassword) return <NicheStep />;

  // Someone training on their own has no booking, credits or coach chat; under-18s have no calorie tracking.
  const clientNav = CLIENT_NAV.filter((n) => !(isPersonal && (n.href === "/book" || n.href === "/messages")) && !(isMinor && n.href === "/nutrition"));
  // A coach whose gym role opens the gym portal gets a Gym entry (on phones it is in the profile menu).
  const withGym = hasPortalAccess(user.gym) ? [...TRAINER_NAV.slice(0, 4), GYM_NAV, ...TRAINER_NAV.slice(4)] : TRAINER_NAV;
  const nav = isTrainer ? (user.isOwner ? [...withGym.slice(0, withGym.length - 2), ADMIN_NAV, ...withGym.slice(withGym.length - 2)] : withGym) : clientNav;
  const active = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const activeWorkout = db.workouts.find((w) => w.status === "ACTIVE" && w.loggedById === user.id);
  // A workout the coach is logging for a session on the gym floor leads back to that session, not to one person's workout.
  const floorKey = activeWorkout?.groupId ?? activeWorkout?.bookingId;
  const resumeHref = activeWorkout ? (floorKey ? `/floor/${floorKey}` : `/workout/${activeWorkout.id}`) : "";
  const onFloor = pathname.startsWith("/floor/");
  const showBanner = activeWorkout && !onFloor && !pathname.startsWith(`/workout/${activeWorkout.id}`);
  // The gym floor needs the width: the sidebar shrinks to icons there.
  const slim = collapsed || onFloor;

  return (
    <div className={cn("animate-fade-in min-h-dvh", !hasBackground(user.prefs) && "bg-bg")}>
      <Personalize userId={user.id} prefs={user.prefs} />
      {/* Desktop / tablet sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface md:flex",
          slim ? "w-[72px]" : "w-64",
        )}
      >
        <div className={cn("flex h-16 items-center gap-3 border-b border-line px-4", slim && "justify-center px-0")}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-on-accent">
            <Dumbbell size={20} />
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              data-tour={`nav-${n.href.slice(1)}`}
              title={n.label}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors",
                slim && "justify-center px-0",
                active(n.href) ? "bg-accent/15 text-accent" : "text-muted hover:bg-field hover:text-ink",
              )}
            >
              <span className="relative">
                {n.icon}
                {n.href === "/messages" && unread > 0 && <Badge count={unread} />}
                {n.href === "/admin" && pendingCoaches > 0 && <Badge count={pendingCoaches} />}
              </span>
              {!slim && n.label}
            </Link>
          ))}
        </nav>
        <div className="space-y-2 border-t border-line p-3">
          <div className={cn("flex items-center gap-2", slim && "flex-col")}>
            <NotificationBell />
            {!slim && <span className="text-xs font-semibold text-muted">Notifications</span>}
          </div>
          <ProfileMenu side="top" showName={!slim} />
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label={slim ? "Expand sidebar" : "Collapse sidebar"}
            className="flex min-h-9 w-full items-center justify-center rounded-lg text-muted hover:bg-field hover:text-ink"
          >
            {slim ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="pt-safe sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur md:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Link href={isTrainer ? "/trainer" : "/home"} aria-label="CoachFlow home" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-on-accent">
            <Dumbbell size={20} />
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <NotificationBell />
            <ProfileMenu />
          </div>
        </div>
      </header>

      <main className={cn("pb-28 md:pb-10", slim ? "md:pl-[72px]" : "md:pl-64")}>
        <div className={cn("mx-auto w-full px-4 py-5 md:px-8 md:py-8", pathname.startsWith("/floor/") ? "max-w-7xl" : "max-w-5xl")}>
          {user.trial && <TrialBar trial={user.trial} />}
          {isTrainer && !pathname.startsWith("/floor/") && <FloorBanner />}
          {children}
        </div>
        <NicheSeeder />
      </main>

      <ChatSync userId={user.id} threads={threads} />
      <OnboardingTour />
      <WhatsNew />
      {user.hasCompletedOnboarding && <InstallPrompt />}
      <ToastHost toasts={chat.toasts} onOpen={(thread) => { dismissToast(thread); router.push("/messages"); }} />

      {showBanner && activeWorkout && (
        <Link
          href={resumeHref}
          className={cn(
            "fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex items-center justify-between gap-3 rounded-2xl border border-accent/40 bg-accent-dim px-4 py-3 shadow-xl md:bottom-4 md:left-auto md:right-4 md:w-80",
          )}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Timer size={18} className="text-accent" /> {floorKey ? "Session in progress" : "Workout in progress"}
          </span>
          <span className="text-xs font-bold text-accent">Resume →</span>
        </Link>
      )}

      {/* Mobile bottom tab bar */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur md:hidden">
        <div className="flex">
          {nav
            .filter((n) => n.mobile)
            .map((n) => (
              <Link
                key={n.href}
                href={n.href}
                data-tour={`nav-${n.href.slice(1)}`}
                className={cn(
                  "flex min-h-[60px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors",
                  active(n.href) ? "text-accent" : "text-muted",
                )}
              >
                <span className="relative">
                  {n.icon}
                  {n.href === "/messages" && unread > 0 && <Badge count={unread} />}
                </span>
                {n.label}
              </Link>
            ))}
        </div>
      </nav>
    </div>
  );
}

function Badge({ count }: { count: number }) {
  return (
    <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-on-danger">
      {count > 9 ? "9+" : count}
    </span>
  );
}

function ChatSync({ userId, threads }: { userId: string; threads: string[] }) {
  const key = threads.join(",");
  useEffect(() => startChatSync(userId, key ? key.split(",") : []), [userId, key]);
  return null;
}

function ToastHost({ toasts, onOpen }: { toasts: { id: string; thread: string; title: string; body: string }[]; onOpen: (id: string) => void }) {
  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setTimeout(() => dismissToast(toasts[0].id), 7000);
    return () => clearTimeout(t);
  }, [toasts]);
  if (toasts.length === 0) return null;
  return (
    <div className="pt-safe pointer-events-none fixed inset-x-0 top-2 z-[70] flex flex-col items-center gap-2 px-3 md:items-end md:px-6">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => onOpen(t.id)}
          className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-accent/40 bg-surface p-3 text-left shadow-2xl"
        >
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent">
            <MessageCircle size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">{t.title}</span>
            <span className="block text-xs text-muted">{t.body}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
