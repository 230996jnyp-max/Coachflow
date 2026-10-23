// Domain models. All weights are stored in kg and all lengths in cm;
// the UI converts to the viewer's preferred unit system.

export type Role = "TRAINER" | "CLIENT";
export type UnitSystem = "metric" | "imperial";

export interface User {
  id: string;
  role: Role;
  username: string;
  name: string;
  mustChangePassword: boolean;
  unit: UnitSystem;
  createdAt: string;
  /** The app owner (a coach with admin rights). Both owner and coaches have role "TRAINER" on the client. */
  isOwner?: boolean;
  /** Contact email (only sent for yourself, or for coaches when you are the owner). */
  email?: string;
  /** Staff accounts can be deactivated by the owner. */
  active?: boolean;
  /** The first-login guided tour has been finished or skipped. */
  hasCompletedOnboarding?: boolean;
  /** Saved colour theme (the Settings picker and header menu keep it in sync with the device). */
  themePreference?: "black" | "white" | "navy";
}

export type ClientGoal =
  | "Hypertrophy"
  | "Fat Loss"
  | "Strength"
  | "Conditioning"
  | "General Fitness";

export interface ClientProfile {
  /** Same as the owning User.id */
  id: string;
  phone: string;
  email: string;
  goal: ClientGoal;
  /** Remaining paid sessions in the package (decremented when a session is completed). */
  credits: number;
  /** Size of the last package purchased (display only). */
  packageSize: number;
  defaultGymId: string | null;
  medicalNotes: string;
  archived: boolean;
  startDate: string;
  /** The coach this client belongs to. */
  coachId: string;
  /** Remaining group-class credits (separate from the 1-on-1 package). Used when a class is completed. */
  groupClassCredits: number;
}

export type MuscleGroup =
  | "Chest"
  | "Upper Back"
  | "Lats"
  | "Lower Back"
  | "Traps"
  | "Front Delts"
  | "Side Delts"
  | "Rear Delts"
  | "Quadriceps"
  | "Hamstrings"
  | "Glutes"
  | "Calves"
  | "Biceps"
  | "Triceps"
  | "Forearms"
  | "Abdominals"
  | "Obliques"
  | "Full Body"
  | "Cardio";

export type Equipment =
  | "Barbell"
  | "Dumbbell"
  | "Machine"
  | "Cable"
  | "Bodyweight"
  | "Smith Machine"
  | "EZ-Bar"
  | "Kettlebell"
  | "Trap Bar"
  | "Resistance Band"
  | "Cardio Machine"
  | "Other";

export type MeasureType =
  | "WEIGHT_REPS"
  | "BODYWEIGHT_REPS"
  | "WEIGHTED_BODYWEIGHT"
  | "DURATION_DISTANCE"
  | "DURATION_ONLY";

export interface Exercise {
  id: string;
  name: string;
  primary: MuscleGroup;
  secondary: MuscleGroup[];
  equipment: Equipment;
  type: MeasureType;
  custom?: boolean;
  createdBy?: string;
}

export type SetType = "N" | "W" | "D" | "F";
export type PRKind = "WEIGHT" | "E1RM" | "VOLUME" | "REPS" | "TIME" | "DISTANCE";

export interface WorkoutSet {
  id: string;
  type: SetType;
  weight?: number; // kg (or added kg for weighted bodyweight)
  reps?: number;
  rpe?: number;
  durationSec?: number;
  distanceKm?: number;
  level?: number;
  calories?: number;
  done: boolean;
  /** Persisted when the workout is saved so history can show badges. */
  pr?: PRKind[];
  /** Set when the coach changed this set from the group live grid (see CoachEdit). */
  coachEdit?: CoachEdit;
}

export type CoachEditKey = "weight" | "reps" | "durationSec" | "distanceKm" | "done";

/**
 * A coach's change to one set of a client's live group workout. `prev` holds the values before the edit so the server
 * can tell whether the client changed the same set at the same time (the client's value then wins).
 */
export interface CoachEdit {
  at: string;
  keys: CoachEditKey[];
  prev: Partial<Record<CoachEditKey, number | boolean>>;
  /** The client changed the set after the coach did (the "Edited by coach" tag goes away). */
  superseded?: boolean;
  /** Client and coach changed the same set at the same time; the client's value was kept. */
  conflict?: boolean;
}

export interface WorkoutExercise {
  id: string;
  exerciseId: string;
  notes?: string;
  sets: WorkoutSet[];
}

export interface Workout {
  id: string;
  clientId: string;
  title: string;
  /** Workout date/time (editable for back-dated logs). */
  startedAt: string;
  /** Set only while a workout is being timed live. */
  liveStartedAt?: string;
  durationSec: number;
  status: "ACTIVE" | "DONE";
  gymId: string | null;
  notes: string;
  loggedBy: Role;
  loggedById: string;
  templateId?: string;
  /** Group class / shared session this workout belongs to (every attendee gets their own copy). */
  groupId?: string;
  exercises: WorkoutExercise[];
}

export interface TemplateExercise {
  exerciseId: string;
  sets: number;
  repMin: number;
  repMax: number;
  /** Target load in kg (optional; set by imports and by the editor). */
  weight?: number;
  /** Coach notes for this exercise (tempo, rest, cues…). */
  notes?: string;
  /** Cardio / timed exercises: target duration and distance. */
  durationSec?: number;
  distanceKm?: number;
}

export interface RoutineTemplate {
  id: string;
  ownerId: string;
  name: string;
  /** Trainer templates are shared with every client. */
  shared: boolean;
  /** One of the built-in starter routines (never edited). Editing a starter turns it into the coach's own routine. */
  starter?: boolean;
  exercises: TemplateExercise[];
}

export interface BodyMetricLog {
  id: string;
  clientId: string;
  date: string; // yyyy-MM-dd
  weightKg?: number;
  bodyFat?: number;
  muscleMassKg?: number;
  chest?: number;
  waist?: number;
  hips?: number;
  armL?: number;
  armR?: number;
  thighL?: number;
  thighR?: number;
  calves?: number;
  loggedBy: Role;
}

export type PhotoPose = "Front" | "Side" | "Back" | "Other";

export interface ProgressPhoto {
  id: string;
  clientId: string;
  date: string; // yyyy-MM-dd
  weightKg?: number;
  pose: PhotoPose;
  notes: string;
  dataUrl: string;
}

export interface GymLocation {
  id: string;
  name: string;
  address: string;
  active: boolean;
}

export interface AvailabilitySlot {
  id: string;
  /** RECURRING: weekly window. ONE_OFF: a single dated window. BLOCK: personal time off. */
  kind: "RECURRING" | "ONE_OFF" | "BLOCK";
  weekday?: number; // 0 = Sunday .. 6 = Saturday (RECURRING)
  date?: string; // yyyy-MM-dd (ONE_OFF / BLOCK)
  start: string; // HH:mm
  end: string; // HH:mm
  label?: string;
}

export type BookingStatus =
  | "PENDING"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELLED"
  | "DECLINED"
  | "NO_SHOW";

export type SessionFocus =
  | "Upper Body"
  | "Lower Body"
  | "Full Body"
  | "Cardio / HIIT"
  | "Mobility & Form Check";

export interface Booking {
  id: string;
  clientId: string;
  start: string; // ISO
  end: string; // ISO
  gymId: string | null;
  customGym?: string;
  /** Exact Google Maps place (name, address, coordinates) when one was picked. */
  place?: PlaceInfo;
  focus: SessionFocus;
  notes: string;
  status: BookingStatus;
  createdBy: Role;
  createdAt: string;
  /** Bumped on reschedule/cancel so calendar apps treat updates to the same event correctly. */
  rev?: number;
  /** The 1-on-1 client's (or session owner's) attendance mark, once the coach has set one. */
  attendance?: AttendanceInfo;
  /** Set while this session is opened to partners: the owner then uses a group credit. */
  sharedGroupId?: string;
}

export type AttendanceMark = "PRESENT" | "NO_SHOW";

export interface AttendanceInfo {
  mark: AttendanceMark;
  /** NO_SHOW only: the coach chose to take the credit anyway. */
  deduct: boolean;
}

export interface AttendanceStats {
  present: number;
  noShow: number;
  /** Present / (Present + No-Show) as a whole percent; null before any session has been marked. */
  rate: number | null;
}

export interface CreditLogEntry {
  id: string;
  at: string;
  pool: "SESSION" | "GROUP";
  kind: string;
  sessionType: string;
  label: string;
  /** Change to the balance: -1 credit taken, +1 credit given back, 0 for a reservation. */
  delta: number;
  /** Balance after this event. */
  balance: number;
  note?: string;
}

/** A place chosen from Google Maps search (Singapore). */
export interface PlaceInfo {
  placeId: string;
  name: string;
  address: string;
  lat?: number;
  lng?: number;
}

export interface AppSettings {
  brandName: string;
  sessionMinutes: number;
  /** Minimum hours before a session that a client may book or cancel. */
  noticeHours: number;
  autoConfirm: boolean;
  allowCustomGym: boolean;
  /** Travel buffer between sessions at different locations (see lib/travel.ts). */
  travelEnabled: boolean;
  travelDefaultMin: number;
  travelParkingMin: number;
  travelMaxMin: number;
  restSeconds: number;
  /** Email a calendar invite (.ics) whenever a session is booked, moved or cancelled. */
  emailInvites?: boolean;
  /** Email a notification when a chat message is sent. */
  emailChat?: boolean;
}

export type ChatRole = "OWNER" | "COACH" | "CLIENT";

export interface ChatMessage {
  id: string;
  /** Thread id = the client's user id (one trainer ↔ client conversation each). */
  thread: string;
  fromId: string;
  fromRole: ChatRole;
  fromName: string;
  text: string;
  createdAt: string;
  broadcast?: boolean;
  email?: { status: "sent" | "preview" | "failed" | "off"; to?: string; error?: string };
}

/* ---------------- Group classes & shared sessions ---------------- */
export type GroupKind = "CLASS" | "SHARED";
export type GroupStatus = "OPEN" | "CANCELLED" | "COMPLETED";
export type MemberStatus = "CONFIRMED" | "WAITLIST" | "CANCELLED" | "ATTENDED" | "ABSENT";

export interface GroupMember {
  clientId: string;
  status: MemberStatus;
  role: "OWNER" | "MEMBER";
  joinedAt: string;
  /** Waitlist position (1 = next in line). */
  position?: number;
  attendance?: AttendanceInfo;
}

export interface GroupSession {
  id: string;
  /** CLASS = scheduled by the coach; SHARED = a client's session opened to partners. */
  kind: GroupKind;
  title: string;
  start: string;
  end: string;
  capacity: number;
  status: GroupStatus;
  gymId: string | null;
  customGym?: string;
  place?: PlaceInfo;
  notes: string;
  templateId?: string;
  templateName?: string;
  bookingId?: string;
  seriesId?: string;
  /** How many spots are taken / left (the only attendee information clients get). */
  confirmed: number;
  spotsLeft: number;
  waitlist: number;
  /** Set once the coach has pushed the group workout. */
  workoutStartedAt?: string;
  workoutTitle?: string;
  /** The viewer's own place in the class (clients). */
  mine?: { status: "CONFIRMED" | "WAITLIST"; position?: number; role: "OWNER" | "MEMBER"; attendance?: AttendanceInfo };
  /** The viewer's own join request, while one is pending (shared sessions). */
  myRequest?: string;
  /** The full roster: coaches only. */
  members?: GroupMember[];
}

export interface GroupRequest {
  id: string;
  groupId: string;
  status: "PENDING" | "APPROVED" | "DECLINED" | "EXPIRED" | "CANCELLED";
  createdAt: string;
  expiresAt: string;
  /** Who is asking: a first name for current attendees, the full name for the coach. Empty for the requester themself. */
  requesterName: string;
  mine: boolean;
  /** This viewer still has to approve or decline it. */
  needsMe: boolean;
  approved: number;
  required: number;
}

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  link?: string;
  createdAt: string;
  read: boolean;
}

export interface DB {
  version: number;
  users: User[];
  clients: ClientProfile[];
  exercises: Exercise[];
  workouts: Workout[];
  templates: RoutineTemplate[];
  metrics: BodyMetricLog[];
  photos: ProgressPhoto[];
  gyms: GymLocation[];
  slots: AvailabilitySlot[];
  bookings: Booking[];
  groups: GroupSession[];
  groupRequests: GroupRequest[];
  notifications: AppNotification[];
  settings: AppSettings;
}
