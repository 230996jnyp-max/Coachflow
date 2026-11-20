/** The settings categories, in the order people see them. `who` decides which accounts get a category. */
export type SettingsWho = "everyone" | "coach" | "client" | "owner";

export interface SettingsCategory {
  slug: string;
  title: string;
  blurb: string;
  who: SettingsWho;
}

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { slug: "profile", title: "Profile", blurb: "Photo, name, bio and sign-in", who: "everyone" },
  { slug: "notifications", title: "Notifications", blurb: "Alerts, quiet hours and email", who: "everyone" },
  { slug: "appearance", title: "Appearance", blurb: "Theme, colours, background and units", who: "everyone" },
  { slug: "coaching", title: "Coaching", blurb: "Niche, gym locations and booking rules", who: "coach" },
  { slug: "payments", title: "Payments", blurb: "Packages, Stripe, PayNow and your records", who: "coach" },
  { slug: "referrals", title: "Invite & earn", blurb: "Invite friends and earn rewards", who: "everyone" },
  { slug: "ai-review", title: "Monthly AI review", blurb: "Help train the AI trainer and get 10% off", who: "coach" },
  { slug: "my-coach", title: "My coach", blurb: "Your coach and your sessions", who: "client" },
  { slug: "administration", title: "Administration", blurb: "Users, gyms and the platform", who: "owner" },
  { slug: "help", title: "Legal & help", blurb: "Tour, install, support, terms and privacy", who: "everyone" },
];

export function categoriesFor(opts: { isTrainer: boolean; isOwner: boolean }): SettingsCategory[] {
  return SETTINGS_CATEGORIES.filter((c) => c.who === "everyone" || (c.who === "coach" && opts.isTrainer) || (c.who === "client" && !opts.isTrainer) || (c.who === "owner" && opts.isOwner));
}
