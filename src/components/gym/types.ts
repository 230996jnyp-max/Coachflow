import type { GymInfo, GymPerm } from "@/lib/gymPerms";

/** What /api/gym returns for someone with portal access. */
export interface GymState {
  gym: GymInfo | null;
  settings?: GymSettingsData;
  overview?: { coaches: number; pending: number; sessionsThisWeek: number; hoursThisMonth: number; coversThisWeek: number };
}

export interface GymSettingsData {
  id: string;
  name: string;
  code: string;
  theme: string | null;
  niches: string[];
  countNoShows: boolean;
  logoV: number;
  bannerV: number;
  status: string;
  trial?: GymInfo["trial"];
  branches: { id: string; name: string; address: string }[];
}

export interface TeamPerson {
  userId: string;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
  status: "ACTIVE" | "PENDING";
  isOwner: boolean;
  niches: string[];
  branchId: string | null;
  rateCents: number | null;
  joinedAt: string | null;
  requestedAt: string;
  lastLoginAt: string | null;
}

export interface RoleData {
  id: string;
  name: string;
  perms: GymPerm[];
  locked: boolean;
  members: number;
}

export interface ScheduleItem {
  kind: "session" | "class";
  id: string;
  coachId: string;
  coachName: string;
  originalCoachName?: string;
  start: string;
  end: string;
  status: string;
  location: string;
  branchId: string | null;
  title: string;
  clientId?: string;
  clients: string[];
  spotsTaken?: number;
  capacity?: number;
  workout?: { title: string; source: string; exercises: { name: string; sets: number }[] };
  clash: boolean;
}

export interface ScheduleData {
  items: ScheduleItem[];
  coaches: { id: string; name: string }[];
  branches: { id: string; name: string }[];
}

export interface HoursData {
  rows: { userId: string; name: string; roleName: string; sessions: number; classes: number; minutes: number; rateCents: number | null; amountCents: number | null }[];
  totals: { sessions: number; classes: number; minutes: number; amountCents: number | null };
  countNoShows: boolean;
}

export const can = (g: GymInfo | null | undefined, p: GymPerm): boolean => !!g && g.status === "ACTIVE" && g.perms.includes(p);
export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export const hoursText = (minutes: number) => `${(minutes / 60).toFixed(1)} h`;
