import type { GymPerm } from "./gymPerms";

/*
 * What the guided tours say and who gets which. The tour is made of sections; a person gets the sections that fit them, and can
 * replay any one from Settings. Pure: no React and no browser, so it is unit-tested.
 *
 *   basics   everyone: the main screens (differs for a coach, a client and someone training alone)
 *   clients  coaches:  adding and importing clients, the "Before we meet" forms, assessments, and making the app yours
 *   forms    clients:  their forms, and making the app yours
 *   gym      anyone with gym access: the gym portal, shown by the permissions they have. Starts the first time they open the Gym page
 *   admin    the platform owner: Coaches, Sign-ups, Gyms and AI usage. Starts the first time they open Admin
 */

export type TourId = "basics" | "clients" | "forms" | "gym" | "admin";

export interface TourStep {
  /** The page it belongs to. ":firstClient" stands for the first active client of the coach (such a step is skipped when there is none). */
  route: string;
  /** `data-tour="…"` names; the first one that is visible is highlighted. */
  targets: string[];
  title: string;
  text: string;
  /** Press the target when the step opens (a tab, for example) so the page shows what the step is about. */
  click?: boolean;
  /** Skipped unless the coach has at least one client to open. */
  needsClient?: boolean;
  /** Skipped unless the person has at least one of these gym permissions. */
  perms?: GymPerm[];
}

export interface TourSection {
  id: TourId;
  label: string;
  blurb: string;
  steps: TourStep[];
  /** Offered once to people who finished the tour before this existed ("What's new"). */
  whatsNew?: boolean;
  /** Starts by itself the first time the person opens a page under this path (once they have finished the basics). */
  autoOnVisit?: string;
}

export interface TourWho {
  isTrainer: boolean;
  isPersonal: boolean;
  isOwner: boolean;
  /** The person's gym permissions when they have gym access (an active gym and at least one permission), else null. */
  gymPerms: GymPerm[] | null;
}

/* ---------------- Basics ---------------- */
const COACH_BASICS: TourStep[] = [
  {
    route: "/schedule",
    targets: ["schedule-board"],
    title: "Your master schedule",
    text: "Manage your schedule, book 1-on-1 sessions and group classes, and mark attendance at the start and end of class. Credits settle automatically — Present takes one, a No-Show gives it back.",
  },
  {
    route: "/schedule",
    targets: ["book-client", "schedule-board"],
    title: "Gyms, Google Maps & travel buffers",
    text: "Pick a preset gym or search any Singapore address on Google Maps when you book. Back-to-back sessions at the same gym need no travel time, while different gyms automatically protect your transit time.",
  },
  {
    route: "/clients",
    targets: ["clients-list", "clients-search"],
    title: "Clients & credits",
    text: "Add clients, copy their login details in one tap, and manage both 1-on-1 and Group Class credits. Open a client to see their training score, attendance rate and full credit log.",
  },
  {
    route: "/clients",
    targets: ["clients-groups"],
    title: "Who needs you",
    text: "Tap a group to see who is behind their weekly target, has gone quiet, missed a session or is low on credits. A health form with yes answers also shows here. Nudge clients messages several people privately in one go.",
  },
  {
    route: "/trainer",
    targets: ["coach-code"],
    title: "Your coach code",
    text: "Share this 6-digit code with a client. They type it when they sign up (or in their Profile) and you accept them here with one tap. Requests show up on your dashboard and Clients page.",
  },
  {
    route: "/workout",
    targets: ["workout-start"],
    title: "Workout logger",
    text: "Log sets with automatic PR detection and previous-set references. For group classes, push one workout to everyone and follow every client live from the class page.",
  },
  {
    route: "/workout",
    targets: ["workout-import"],
    title: "Import from your notes",
    text: "Paste messy notes from Notepad or WhatsApp, or upload a PDF, Word, Excel file or photo. AI reads the exercises, sets and reps and turns them into reusable routines.",
  },
  {
    route: "/schedule",
    targets: ["bell"],
    title: "Notifications",
    text: "Partner-session requests, waitlist changes, class updates, workout comments, finished forms and new client requests land here. Open See all to find everything sorted into tabs, or approve a request in one tap.",
  },
];

const CLIENT_BASICS: TourStep[] = [
  {
    route: "/home",
    targets: ["home-credits"],
    title: "Your home base",
    text: "See your remaining 1-on-1 and group class credits and your next session at a glance. When your coach starts a group workout, a banner takes you straight into it.",
  },
  {
    route: "/book",
    targets: ["schedule-board", "book-tabs"],
    title: "Tap to book",
    text: "Tap any open slot to book a 1-on-1 session at your gym, or switch to Group classes to grab a spot before they fill up. The times you can pick already respect your coach's travel time.",
  },
  {
    route: "/workout",
    targets: ["workout-start"],
    title: "Log your workouts",
    text: "Log your solo workouts or follow your coach's group workout. The app shows your previous weights, starts your rest timer automatically, and celebrates new PRs.",
  },
  {
    route: "/progress",
    targets: ["progress-hub"],
    title: "See your progress",
    text: "Track strength curves, volume and body measurements. Add check-in photos to your Photo vault for side-by-side before-and-after comparisons.",
  },
  {
    route: "/messages",
    targets: ["nav-messages"],
    title: "Chat with your coach",
    text: "Message your coach about form checks, training questions or schedule changes — all in one place.",
  },
];

/** Someone training on their own: no coach, so nothing about booking, credits or chat. */
const PERSONAL_BASICS: TourStep[] = [
  {
    route: "/home",
    targets: ["home-goal"],
    title: "Your home base",
    text: "See this week's goal, your streak, your latest personal records and your starter routines at a glance. Change the goal's days in your profile any time.",
  },
  {
    route: "/workout",
    targets: ["workout-start"],
    title: "Log your workouts",
    text: "Start an empty workout or a routine. The app shows your previous weights, starts your rest timer automatically, suggests what to aim for today and celebrates new PRs.",
  },
  {
    route: "/workout",
    targets: ["workout-import"],
    title: "Bring in your plan",
    text: "Paste a plan from your notes or WhatsApp, or upload a file or photo, and turn it into a routine or a logged workout.",
  },
  {
    route: "/progress",
    targets: ["progress-hub"],
    title: "See your progress",
    text: "Track strength curves, volume and body measurements. Add check-in photos to your Photo vault for side-by-side before-and-after comparisons.",
  },
];

/* ---------------- Clients, forms and assessments (coach) ---------------- */
const COACH_CLIENTS: TourStep[] = [
  {
    route: "/clients",
    targets: ["clients-add"],
    title: "Add a client, with the forms",
    text: "Add client makes the login in seconds. In the highlighted box you can preview the health questionnaire, health declaration and goals form exactly as your client will see them, then tick the box to send them with the login.",
  },
  {
    route: "/clients",
    targets: ["clients-import"],
    title: "Import your clients",
    text: "Paste a list, upload a spreadsheet, PDF or Word file, or snap a photo. You check everyone before anything is saved: new clients get logins, people you already have show old and new side by side, and anyone under 18 needs a guardian tick.",
  },
  {
    route: "/clients/:firstClient",
    targets: ["client-tab-intake"],
    click: true,
    needsClient: true,
    title: "Intake: forms and assessments",
    text: "Each client's Intake tab holds their forms (every version kept, yes answers flagged) and lets you give them a copy to read and acknowledge. It also runs a posture and fitness assessment: repeat it every 8 to 12 weeks and Compare shows what changed, including anything you noted under Others.",
  },
  {
    route: "/settings/coaching",
    targets: ["forms-preview"],
    title: "See the forms yourself",
    text: "Client forms lists all three forms. Preview shows each one the way your client sees it. You can click through, but nothing is saved or sent.",
  },
  {
    route: "/settings",
    targets: ["settings-list"],
    title: "Make CoachFlow yours",
    text: "Settings is in categories: Profile (photo and bio), Appearance (theme, accent colour, background, text size), Notifications (quiet hours) and Coaching (niche, gyms, booking rules). You can also hide or reorder what shows on your Home.",
  },
];

/* ---------------- Forms and settings (client) ---------------- */
const CLIENT_FORMS: TourStep[] = [
  {
    route: "/intake",
    targets: ["intake-forms"],
    title: "Before we meet",
    text: "Your coach may ask for a few short forms before your first session: a health questionnaire, a declaration and your goals. Your answers are private to you and your coach. Your coach gives you a copy of what was recorded and you tap “I have read this”.",
  },
  {
    route: "/settings",
    targets: ["settings-list"],
    title: "Make it yours",
    text: "Pick a theme, accent colour and background, set quiet hours for notifications and choose what shows on your Home.",
  },
];

/* ---------------- Gym portal ---------------- */
const gym = (tab: string, title: string, text: string, perms?: GymPerm[]): TourStep => ({ route: "/gym-admin", targets: [`gym-tab-${tab}`], click: true, title, text, ...(perms ? { perms } : {}) });
const GYM_STEPS: TourStep[] = [
  gym("overview", "Your gym at a glance", "Your gym code is here. Coaches enter it when they sign up (or in Settings, Coaching) and you approve each one. You also see coaches, this week's sessions, hours and cover."),
  gym("schedule", "Master schedule", "Every coach's sessions and classes in one week view. Filter by coach or hall, spot clashes (two coaches in the same place at the same time), create a class for any coach and arrange cover.", ["schedule.view"]),
  gym("hours", "Hours and payroll", "Completed sessions and classes per coach for any month or range, with optional hourly rates and a CSV download for payroll.", ["hours.view"]),
  gym("team", "Your team", "Approve coaches who join with your code, invite people by email and give each one a role. Coaches only see their own clients, and you never see client names or counts."),
  gym("roles", "Roles", "Make roles with exactly the permissions you want, like Manager or Receptionist, and give one to each person. The Owner role can't be changed.", ["roles.manage"]),
  gym("settings", "Gym settings", "Name, logo, theme, niches, halls and the defaults handed to coaches when they join. Apply to everyone now updates the whole team.", ["branding.manage", "coaches.manage"]),
  gym("activity", "Activity log", "Who linked, removed or moved whom, so you always know what changed and when.", ["activity.view"]),
];

/* ---------------- Platform owner ---------------- */
const admin = (tab: string, title: string, text: string): TourStep => ({ route: "/admin", targets: [`admin-tab-${tab}`], click: true, title, text });
const ADMIN_STEPS: TourStep[] = [
  admin("coaches", "Coaches", "Add coaches, reset passwords, deactivate and announce to everyone. Only counts are shown for clients: client details stay private to each coach."),
  admin("signups", "Who signed up", "New accounts per day, who is verified and who is not, and every account with filters. Open one to resend the email, disable or delete it."),
  admin("gyms", "Gyms", "Every gym with its code, coach count and AI use. Switch one off or on, or delete it. The gym's admin is emailed."),
  admin("ai", "AI usage", "How much AI is used today, this week and this month, by gym, by coach and by feature, so you can see what it costs before it surprises you."),
];

/* ---------------- Who gets what ---------------- */
/** The tour sections that fit this person, in the order they are played. */
export function sectionsFor(who: TourWho): TourSection[] {
  if (who.isTrainer) {
    const out: TourSection[] = [
      { id: "basics", label: "The basics", blurb: "Schedule, clients, workouts and notifications", steps: COACH_BASICS },
      { id: "clients", label: "Clients, forms and assessments", blurb: "Add and import clients, preview the forms, assessments, and making CoachFlow yours", steps: COACH_CLIENTS, whatsNew: true },
    ];
    if (who.gymPerms && who.gymPerms.length) out.push({ id: "gym", label: "Gym portal", blurb: "Your gym's schedule, hours, team, roles and settings", steps: GYM_STEPS, autoOnVisit: "/gym-admin" });
    if (who.isOwner) out.push({ id: "admin", label: "Admin", blurb: "Coaches, sign-ups, gyms and AI usage", steps: ADMIN_STEPS, autoOnVisit: "/admin" });
    return out;
  }
  if (who.isPersonal) return [{ id: "basics", label: "The basics", blurb: "Your home, workouts and progress", steps: PERSONAL_BASICS }];
  return [
    { id: "basics", label: "The basics", blurb: "Home, booking, workouts, progress and chat", steps: CLIENT_BASICS },
    { id: "forms", label: "Your forms and settings", blurb: "The forms your coach asks for, and making the app yours", steps: CLIENT_FORMS, whatsNew: true },
  ];
}

export type PlayedStep = TourStep & { sectionId: TourId; sectionLabel: string };

export interface TourCtx {
  firstClientId: string | null;
}

/** The steps to play for these sections, with the ones that don't apply to this person left out. */
export function stepsFor(ids: TourId[], who: TourWho, ctx: TourCtx): PlayedStep[] {
  const sections = sectionsFor(who);
  const out: PlayedStep[] = [];
  for (const id of ids) {
    const s = sections.find((x) => x.id === id);
    if (!s) continue;
    for (const st of s.steps) {
      if (st.needsClient && !ctx.firstClientId) continue;
      if (st.perms && !st.perms.some((p) => who.gymPerms?.includes(p))) continue;
      out.push({ ...st, sectionId: s.id, sectionLabel: s.label });
    }
  }
  return out;
}

/** The real page for a step ("/clients/:firstClient" becomes the first client's page). */
export const resolveRoute = (route: string, ctx: TourCtx): string => (ctx.firstClientId ? route.replace(":firstClient", ctx.firstClientId) : route);

/** What a brand-new account is shown straight after its first sign-in: the basics and the sections that go with them. The gym and Admin tours wait until those pages are opened. */
export const chainForNewAccount = (who: TourWho): TourId[] => sectionsFor(who).filter((s) => !s.autoOnVisit).map((s) => s.id);

/** Sections to offer once to someone who finished the tour before they existed. */
export function whatsNewFor(who: TourWho, seen: Iterable<string>, finishedBefore: boolean): TourSection[] {
  if (!finishedBefore) return [];
  const have = new Set(seen);
  return sectionsFor(who).filter((s) => s.whatsNew && !have.has(s.id));
}

/** The section that should start by itself because the person just opened this page (and has not seen it). */
export function autoSectionForPath(who: TourWho, seen: Iterable<string>, pathname: string): TourSection | null {
  const have = new Set(seen);
  return sectionsFor(who).find((s) => s.autoOnVisit && (pathname === s.autoOnVisit || pathname.startsWith(`${s.autoOnVisit}/`)) && !have.has(s.id)) ?? null;
}
