"use client";

import {
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  Dumbbell,
  Home,
  LayoutDashboard,
  LineChart,
  ListChecks,
  LogOut,
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
import { useViewer } from "@/lib/hooks";
import { logout } from "@/lib/store";
import { cn } from "@/lib/utils";
import { NotificationBell } from "./groups/NotificationBell";
import { OnboardingTour } from "./tour/OnboardingTour";
import { InstallButton } from "./InstallButton";
import { Splash } from "./Providers";
import { Avatar } from "./ui";

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
  { href: "/messages", label: "Messages", icon: <MessageCircle size={22} /> },
  { href: "/exercises", label: "Exercises", icon: <ListChecks size={22} /> },
  { href: "/settings", label: "Settings", icon: <Settings size={22} />, mobile: true },
];

const CLIENT_NAV: NavItem[] = [
  { href: "/home", label: "Home", icon: <Home size={22} />, mobile: true },
  { href: "/workout", label: "Workout", icon: <Dumbbell size={22} />, mobile: true },
  { href: "/progress", label: "Progress", icon: <LineChart size={22} />, mobile: true },
  { href: "/book", label: "Book", icon: <CalendarDays size={22} />, mobile: true },
  { href: "/messages", label: "Messages", icon: <MessageCircle size={22} /> },
  { href: "/exercises", label: "Exercises", icon: <ListChecks size={22} /> },
  { href: "/settings", label: "Profile", icon: <UserRound size={22} />, mobile: true },
];

const TRAINER_ONLY = ["/trainer", "/clients", "/schedule"];
const OWNER_ONLY = ["/admin"];
const ADMIN_NAV: NavItem = { href: "/admin", label: "Admin", icon: <ShieldCheck size={22} /> };
const CLIENT_ONLY = ["/home", "/progress", "/book"];

export function AppShell({ children }: { children: ReactNode }) {
  const { ready, user, isTrainer, db } = useViewer();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const chat = useChat();
  const threads = useMemo(() => {
    if (!user) return [];
    if (!isTrainer) return [clientThread(user.id)];
    const t = db.clients.map((c) => clientThread(c.id));
    if (user.isOwner) {
      for (const u of db.users) if (u.role === "TRAINER" && !u.isOwner) t.push(coachThread(u.id));
    } else {
      t.push(coachThread(user.id));
    }
    return t;
  }, [user, isTrainer, db.clients, db.users]);
  const unread = user ? threads.reduce((n, t) => n + unreadFor(chat, user.id, t), 0) : 0;

  const forbidden =
    !!user &&
    ((isTrainer && CLIENT_ONLY.some((p) => pathname.startsWith(p))) ||
      (!isTrainer && TRAINER_ONLY.some((p) => pathname.startsWith(p))) ||
      (!user.isOwner && OWNER_ONLY.some((p) => pathname.startsWith(p))));
  // Accounts using a temporary password must choose their own before doing anything else.
  const mustChange = !!user?.mustChangePassword && !pathname.startsWith("/settings/password");

  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace("/login");
    else if (mustChange) router.replace("/settings/password");
    else if (forbidden) router.replace(isTrainer ? "/trainer" : "/home");
  }, [ready, user, forbidden, mustChange, isTrainer, router]);

  if (!ready || !user || forbidden || mustChange) return <Splash />;

  const nav = isTrainer ? (user.isOwner ? [...TRAINER_NAV.slice(0, 5), ADMIN_NAV, ...TRAINER_NAV.slice(5)] : TRAINER_NAV) : CLIENT_NAV;
  const active = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const activeWorkout = db.workouts.find((w) => w.status === "ACTIVE" && w.loggedById === user.id);
  const showBanner = activeWorkout && !pathname.startsWith(`/workout/${activeWorkout.id}`);

  return (
    <div className="min-h-dvh bg-bg">
      {/* Desktop / tablet sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface md:flex",
          collapsed ? "w-[72px]" : "w-64",
        )}
      >
        <div className={cn("flex h-16 items-center gap-3 border-b border-line px-4", collapsed && "justify-center px-0")}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-white">
            <Dumbbell size={20} />
          </div>
          {!collapsed && <span className="text-lg font-bold tracking-tight">{db.settings.brandName}</span>}
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
                collapsed && "justify-center px-0",
                active(n.href) ? "bg-accent/15 text-accent" : "text-muted hover:bg-field hover:text-ink",
              )}
            >
              <span className="relative">
                {n.icon}
                {n.href === "/messages" && unread > 0 && <Badge count={unread} />}
              </span>
              {!collapsed && n.label}
            </Link>
          ))}
        </nav>
        <div className="space-y-2 border-t border-line p-3">
          <div className={cn("flex items-center gap-2", collapsed && "justify-center")}>
            <NotificationBell />
            {!collapsed && <span className="text-xs font-semibold text-muted">Notifications</span>}
          </div>
          {!collapsed && <InstallButton className="w-full" />}
          <div className={cn("flex items-center gap-3 rounded-xl p-2", collapsed && "justify-center")}>
            <Avatar name={user.name} size={36} />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{user.name}</div>
                <div className="text-xs text-muted">{user.isOwner ? "App Owner" : isTrainer ? "Coach" : "Client"}</div>
              </div>
            )}
            {!collapsed && (
              <button
                aria-label="Log out"
                title="Log out"
                onClick={async () => {
                  await logout();
                  router.replace("/login");
                }}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-field hover:text-danger"
              >
                <LogOut size={18} />
              </button>
            )}
          </div>
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex min-h-9 w-full items-center justify-center rounded-lg text-muted hover:bg-field hover:text-ink"
          >
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="pt-safe sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur md:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
              <Dumbbell size={18} />
            </div>
            <span className="truncate font-bold tracking-tight">{db.settings.brandName}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {user.isOwner && (
              <Link href="/admin" aria-label="Admin" className="flex h-10 w-10 items-center justify-center rounded-xl border border-pr/40 bg-pr/10 text-pr">
                <ShieldCheck size={20} />
              </Link>
            )}
            <Link
              href="/messages"
              data-tour="nav-messages"
              aria-label={unread ? `Messages, ${unread} unread` : "Messages"}
              className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-field text-ink"
            >
              <MessageCircle size={20} />
              {unread > 0 && <Badge count={unread} />}
            </Link>
            <NotificationBell />
            <InstallButton compact />
            <Link href="/settings" aria-label="Profile">
              <Avatar name={user.name} size={32} />
            </Link>
          </div>
        </div>
      </header>

      <main className={cn("pb-28 md:pb-10", collapsed ? "md:pl-[72px]" : "md:pl-64")}>
        <div className="mx-auto w-full max-w-5xl px-4 py-5 md:px-8 md:py-8">{children}</div>
      </main>

      <ChatSync userId={user.id} threads={threads} />
      <OnboardingTour />
      <ToastHost toasts={chat.toasts} onOpen={(thread) => { dismissToast(thread); router.push("/messages"); }} />

      {showBanner && activeWorkout && (
        <Link
          href={`/workout/${activeWorkout.id}`}
          className={cn(
            "fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex items-center justify-between gap-3 rounded-2xl border border-accent/40 bg-accent-dim px-4 py-3 shadow-xl md:bottom-4 md:left-auto md:right-4 md:w-80",
          )}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Timer size={18} className="text-accent" /> Workout in progress
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
                className={cn(
                  "flex min-h-[60px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors",
                  active(n.href) ? "text-accent" : "text-muted",
                )}
              >
                {n.icon}
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
    <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
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
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white">
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
