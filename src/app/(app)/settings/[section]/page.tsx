"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, useRouter } from "next/navigation";
import { use, useEffect } from "react";
import { categoriesFor } from "@/components/settings/categories";
import { AppearanceSection, CoachingSection, HelpSection, MyCoachSection, NotificationsSection, ProfileSection } from "@/components/settings/Sections";
import { useViewer } from "@/lib/hooks";

/** One settings category on its own page (Profile, Notifications, Appearance, Coaching, My coach, Legal & help). */
export default function SettingsSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = use(params);
  const { user, isTrainer } = useViewer();
  const router = useRouter();
  const cat = user ? categoriesFor({ isTrainer, isOwner: !!user.isOwner }).find((c) => c.slug === section) : undefined;

  // A category this account doesn't have (for example Coaching for a client) goes back to the list.
  useEffect(() => {
    if (user && (!cat || section === "administration")) router.replace(section === "administration" && user.isOwner ? "/admin" : "/settings");
  }, [user, cat, section, router]);

  if (!user) return null;
  if (!["profile", "notifications", "appearance", "coaching", "my-coach", "administration", "help"].includes(section)) notFound();
  if (!cat) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <Link href="/settings" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
          <ArrowLeft size={16} /> Settings
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{cat.title}</h1>
        <p className="mt-1 text-sm text-muted">{cat.blurb}</p>
      </div>
      {section === "profile" && <ProfileSection />}
      {section === "notifications" && <NotificationsSection />}
      {section === "appearance" && <AppearanceSection />}
      {section === "coaching" && <CoachingSection />}
      {section === "my-coach" && <MyCoachSection />}
      {section === "help" && <HelpSection />}
    </div>
  );
}
