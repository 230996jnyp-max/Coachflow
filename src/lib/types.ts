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
  focus: SessionFocus;
  notes: string;
  status: BookingStatus;
  createdBy: Role;
  createdAt: string;
  /** Bumped on reschedule/cancel so calendar apps treat updates to the same event correctly. */
  rev?: number;
}

export interface AppSettings {
  brandName: string;
  sessionMinutes: number;
  /** Minimum hours before a session that a client may book or cancel. */
  noticeHours: number;
  autoConfirm: boolean;
  allowCustomGym: boolean;
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
  settings: AppSettings;
}
