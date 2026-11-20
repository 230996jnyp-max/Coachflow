"use client";

import { Bell, ChevronRight, HelpCircle, Handshake, LogOut, Palette, ShieldCheck, Sparkles, UserRound, Dumbbell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { BillingCard } from "@/components/billing/BillingCard";
import { PasswordBanner } from "@/components/PasswordBanner";
import { categoriesFor } from "@/components/settings/categories";
import { Card, PageHeader, PersonAvatar } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { logout } from "@/lib/store";

const ICONS: Record<string, ReactNode> = {
  profile: <UserRound size={20} />,
  notifications: <Bell size={20} />,
  appearance: <Palette size={20} />,
  coaching: <Dumbbell size={20} />,
  "ai-review": <Sparkles size={20} />,
  "my-coach": <Handshake size={20} />,
  administration: <ShieldCheck size={20} />,
  help: <HelpCircle size={20} />,
};

/** Settings home: a short list of categories. Each opens its own page, so nothing is a wall of options. */
export default function SettingsPage() {
  const { user, isTrainer } = useViewer();
  const router = useRouter();
  if (!user) return null;
  const cats = categoriesFor({ isTrainer, isOwner: !!user.isOwner });
  const row = "flex min-h-16 w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-field";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Settings" />
      <PasswordBanner />

      <Link href="/settings/profile">
        <Card className="flex items-center gap-4 p-4 hover:border-accent/50">
          <PersonAvatar user={user} size={56} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-bold">{user.name}</div>
            <div className="truncate text-sm text-muted">@{user.username}</div>
          </div>
          <ChevronRight size={18} className="text-muted" />
        </Card>
      </Link>

      {isTrainer && (
        <section className="space-y-2">
          <h2 className="px-1 text-sm font-semibold text-muted">Subscription &amp; billing</h2>
          <BillingCard />
        </section>
      )}

      <Card className="divide-y divide-line overflow-hidden p-0" data-tour="settings-list">
        {cats.map((c) => (
          <Link key={c.slug} href={c.slug === "administration" ? "/admin" : `/settings/${c.slug}`} className={row} data-tour={`settings-${c.slug}`}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-field text-accent">{ICONS[c.slug]}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{c.title}</span>
              <span className="block truncate text-xs text-muted">{c.blurb}</span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-muted" />
          </Link>
        ))}
        <button
          type="button"
          className={row}
          onClick={async () => {
            await logout();
            router.replace("/login");
          }}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger/15 text-danger">
            <LogOut size={20} />
          </span>
          <span className="flex-1 font-semibold text-danger">Log out</span>
        </button>
      </Card>
    </div>
  );
}
