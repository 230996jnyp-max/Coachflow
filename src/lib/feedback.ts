/** How a workout felt: pain and energy on a 0–10 scale, and where it hurt. Shared by the app and the server. */

export interface WorkoutFeedback {
  /** 0 (none) – 10 (worst). */
  pain?: number;
  /** 0 (drained) – 10 (full of energy). */
  energy?: number;
  /** Where it hurt (only meaningful when pain > 0). */
  areas?: string[];
}

export const PAIN_AREAS = [
  "Neck",
  "Shoulder",
  "Upper back",
  "Lower back",
  "Chest",
  "Elbow",
  "Wrist / hand",
  "Core",
  "Hip",
  "Glute",
  "Knee",
  "Quad",
  "Hamstring",
  "Calf",
  "Ankle / foot",
  "Other",
] as const;

/** A pain score at or above this tells the coach straight away. */
export const PAIN_ALERT = 6;

export type PainLevel = "none" | "mild" | "moderate" | "high";

export const painLevel = (pain: number): PainLevel => (pain <= 0 ? "none" : pain <= 2 ? "mild" : pain < PAIN_ALERT ? "moderate" : "high");

/** Is there anything to show? */
export const hasFeedback = (f: WorkoutFeedback | undefined): f is WorkoutFeedback => !!f && (f.pain !== undefined || f.energy !== undefined);
