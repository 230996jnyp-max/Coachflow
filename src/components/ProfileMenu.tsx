"use client";

import { Building2, LogOut, Settings, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { hasPortalAccess } from "@/lib/gymPerms";
import { useViewer } from "@/lib/hooks";
import { logout } from "@/lib/store";
import { cn } from "@/lib/utils";
import { PersonAvatar } from "./ui";

/** The profile picture in the corner. Tapping it opens a small menu: Profile, Settings, Admin (owner only) and Log out. */
export function ProfileMenu({ side = "bottom", showName = false }: { side?: "bottom" | "top"; showName?: boolean }) {
  const { user, isTrainer, isPersonal } = useViewer();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent | TouchEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("touchstart", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("touchstart", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!user) return null;
  const role = user.isOwner ? "App Owner" : isTrainer ? "Coach" : isPersonal ? "Training solo" : "Client";
  const item = "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold text-ink hover:bg-field";

  return (
    <div ref={box} className="relative" data-tour="profile-menu">
      <button
        type="button"
        aria-label="Profile menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn("flex items-center gap-3 rounded-full", showName && "w-full rounded-xl p-2 text-left hover:bg-field")}
      >
        <PersonAvatar user={user} size={showName ? 36 : 34} />
        {showName && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{user.prefs?.nick || user.name}</span>
            <span className="block text-xs text-muted">{role}</span>
          </span>
        )}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute z-50 w-60 rounded-2xl border border-line bg-surface p-2 shadow-2xl",
            side === "top" ? "bottom-full left-0 mb-2" : "right-0 top-full mt-2",
          )}
        >
          <div className="flex items-center gap-3 border-b border-line px-3 pb-3 pt-2">
            <PersonAvatar user={user} size={40} />
            <div className="min-w-0">
              <div className="truncate text-sm font-bold">{user.name}</div>
              <div className="text-xs text-muted">{role}</div>
            </div>
          </div>
          <div className="pt-2">
            <Link href="/settings/profile" role="menuitem" onClick={() => setOpen(false)} className={item}>
              <UserRound size={18} className="text-muted" /> Profile
            </Link>
            <Link href="/settings" role="menuitem" onClick={() => setOpen(false)} className={item}>
              <Settings size={18} className="text-muted" /> Settings
            </Link>
            {hasPortalAccess(user.gym) && (
              <Link href="/gym-admin" role="menuitem" onClick={() => setOpen(false)} className={item}>
                <Building2 size={18} className="text-accent" /> Gym admin
              </Link>
            )}
            {user.isOwner && (
              <Link href="/admin" role="menuitem" onClick={() => setOpen(false)} className={item}>
                <ShieldCheck size={18} className="text-pr" /> Admin
              </Link>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                setOpen(false);
                await logout();
                router.replace("/login");
              }}
              className={cn(item, "text-danger hover:bg-danger/10")}
            >
              <LogOut size={18} /> Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
