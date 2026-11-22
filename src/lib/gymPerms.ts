/*
 * What a person can do inside a gym. A gym owner makes roles (a name and a set of these permissions) and gives one to each member.
 * The owner's own role has every permission and can't be changed. Shared by the server (to check) and the screens (to list).
 */

export const GYM_PERMS = [
  { id: "schedule.view", label: "See the master schedule", hint: "Every coach's sessions and classes, first names and workouts." },
  { id: "schedule.manage", label: "Run the schedule", hint: "Create classes, arrange cover, move clients between coaches." },
  { id: "hours.view", label: "See hours, payroll and coach performance", hint: "Completed hours per coach and the CSV download, plus each coach's attendance, client retention and activity (counts only)." },
  { id: "coaches.manage", label: "Manage the team", hint: "Approve join requests, invite and remove people, set rates, regenerate the gym code." },
  { id: "branding.manage", label: "Change branding and defaults", hint: "Name, logo, banner, theme, niches, locations and halls." },
  { id: "roles.manage", label: "Manage roles", hint: "Create roles and choose who has which." },
  { id: "activity.view", label: "See the activity log", hint: "Who linked, removed or moved whom." },
] as const;

export type GymPerm = (typeof GYM_PERMS)[number]["id"];
export const ALL_PERMS: GymPerm[] = GYM_PERMS.map((p) => p.id);
export const isPerm = (v: unknown): v is GymPerm => typeof v === "string" && (ALL_PERMS as string[]).includes(v);

/** Roles every new gym starts with. Only Owner is locked; the rest can be edited or deleted. */
export const STARTER_ROLES: { name: string; perms: GymPerm[]; locked?: boolean }[] = [
  { name: "Owner", perms: ALL_PERMS, locked: true },
  { name: "Manager", perms: ["schedule.view", "schedule.manage", "hours.view", "coaches.manage", "branding.manage", "activity.view"] },
  { name: "Receptionist", perms: ["schedule.view"] },
  { name: "Coach", perms: [] },
];

/** Keeps only known permissions, once each. */
export const cleanPerms = (v: unknown): GymPerm[] => (Array.isArray(v) ? [...new Set(v.filter(isPerm))] : []);

export const GYM_CODE_RE = /^\d{6}$/;
export const cleanGymCode = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.replace(/\s+/g, "") : "";
  return GYM_CODE_RE.test(s) ? s : null;
};

/** What the person sees of their own gym on the viewer record (never sent for other people). */
export interface GymInfo {
  id: string;
  name: string;
  status: "ACTIVE" | "PENDING" | "DISABLED";
  roleName: string;
  perms: GymPerm[];
  isOwner: boolean;
  logoV: number;
  bannerV: number;
  theme: string | null;
  trial?: { endsAt: string; daysLeft: number; expired: boolean; enforced: boolean };
}

/** The part of a coach's gym that their clients see. */
export interface PublicGym {
  id: string;
  name: string;
  logoV: number;
  bannerV: number;
}

/** Any permission at all means the gym portal is worth opening. */
export const hasPortalAccess = (g: Pick<GymInfo, "perms" | "status"> | undefined | null): boolean => !!g && g.status === "ACTIVE" && g.perms.length > 0;
