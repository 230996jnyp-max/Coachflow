"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, useRouter } from "next/navigation";
import { use, useEffect } from "react";
import { PaymentsSection } from "@/components/payments/CoachPayments";
import { AiReviewSection } from "@/components/settings/AiReview";
import { ReferralsSection } from "@/components/settings/Referrals";
import { categoriesFor } from "@/components/settings/categories";
import { PublicPageSection } from "@/components/settings/PublicPage";
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
  if (!["profile", "notifications", "appearance", "coaching", "public-page", "payments", "referrals", "ai-review", "my-coach", "administration", "help"].includes(section)) notFound();
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
      {section === "public-page" && <PublicPageSection />}
      {section === "payments" && <PaymentsSection />}
      {section === "referrals" && <ReferralsSection />}
      {section === "ai-review" && <AiReviewSection />}
      {section === "my-coach" && <MyCoachSection />}
      {section === "help" && <HelpSection />}
    </div>
  );
}
