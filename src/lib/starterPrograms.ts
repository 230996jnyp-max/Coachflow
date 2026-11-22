import { expandWeeks, type ProgramSlot, type ProgressionMode } from "./programs";
import type { Exercise, TemplateExercise } from "./types";

/*
 * Six ready-made programs, written by hand from the exercise library (no AI, so they cost nothing and are the same every time).
 * Each is week 1 only; expandWeeks() grows it into the whole block with the usual progression and deload weeks.
 * Exercises are named exactly as in the library; a name that is not found (a coach removed it, say) is left out.
 */

/** name, sets, repMin, repMax, [seconds for timed work] */
type Line = [string, number, number, number, number?];
interface Day {
  day: number;
  title: string;
  lines: Line[];
}
export interface StarterDef {
  id: string;
  name: string;
  blurb: string;
  goal: string;
  level: string;
  weeks: number;
  progression: ProgressionMode;
  gentle: boolean;
  days: Day[];
}

export const STARTERS: StarterDef[] = [
  {
    id: "starter-beginner-full-body",
    name: "Beginner full body",
    blurb: "3 days a week, simple machines and dumbbells, 6 weeks.",
    goal: "General Fitness",
    level: "Beginner",
    weeks: 6,
    progression: "reps_then_weight",
    gentle: false,
    days: [
      { day: 1, title: "Full body A", lines: [["Goblet Squat (Dumbbell)", 3, 8, 12], ["Bench Press (Dumbbell)", 3, 8, 12], ["Seated Cable Row", 3, 10, 12], ["Romanian Deadlift (Dumbbell)", 3, 8, 12], ["Shoulder Press (Dumbbell)", 2, 10, 12], ["Plank", 2, 0, 0, 30]] },
      { day: 3, title: "Full body B", lines: [["Leg Press (Machine)", 3, 10, 12], ["Incline Push Up", 3, 8, 12], ["Lat Pulldown (Cable)", 3, 10, 12], ["Glute Bridge", 3, 10, 15], ["Lateral Raise (Dumbbell)", 2, 12, 15], ["Dead Bug", 2, 8, 10]] },
      { day: 5, title: "Full body C", lines: [["Reverse Lunge (Dumbbell)", 3, 8, 12], ["Push Up", 3, 6, 12], ["Bent Over Row (Dumbbell)", 3, 8, 12], ["Hip Thrust (Machine)", 3, 10, 12], ["Bicep Curl (Dumbbell)", 2, 10, 12], ["Triceps Pushdown (Cable)", 2, 10, 12]] },
    ],
  },
  {
    id: "starter-upper-lower",
    name: "Upper / lower split",
    blurb: "4 days a week, two upper and two lower sessions, 8 weeks.",
    goal: "Hypertrophy",
    level: "Intermediate",
    weeks: 8,
    progression: "reps_then_weight",
    gentle: false,
    days: [
      { day: 1, title: "Upper A", lines: [["Bench Press (Barbell)", 4, 6, 10], ["Bent Over Row (Barbell)", 4, 6, 10], ["Shoulder Press (Dumbbell)", 3, 8, 12], ["Lat Pulldown (Cable)", 3, 8, 12], ["Bicep Curl (Dumbbell)", 3, 10, 12], ["Triceps Pushdown (Cable)", 3, 10, 12]] },
      { day: 2, title: "Lower A", lines: [["Squat (Barbell)", 4, 6, 10], ["Romanian Deadlift (Barbell)", 3, 8, 10], ["Leg Press (Machine)", 3, 10, 12], ["Lying Leg Curl (Machine)", 3, 10, 12], ["Standing Calf Raise (Machine)", 3, 12, 15], ["Plank", 3, 0, 0, 45]] },
      { day: 4, title: "Upper B", lines: [["Incline Bench Press (Dumbbell)", 4, 8, 12], ["Seated Cable Row", 4, 8, 12], ["Lateral Raise (Dumbbell)", 3, 12, 15], ["Face Pull (Cable)", 3, 12, 15], ["Hammer Curl (Dumbbell)", 3, 10, 12], ["Triceps Rope Pushdown", 3, 10, 12]] },
      { day: 5, title: "Lower B", lines: [["Deadlift (Barbell)", 3, 5, 8], ["Lunge (Dumbbell)", 3, 8, 12], ["Leg Extension (Machine)", 3, 10, 15], ["Seated Leg Curl (Machine)", 3, 10, 15], ["Hip Thrust (Barbell)", 3, 8, 12], ["Hanging Knee Raise", 3, 8, 12]] },
    ],
  },
  {
    id: "starter-push-pull-legs",
    name: "Push / pull / legs",
    blurb: "6 days a week, the classic bodybuilding split, 8 weeks.",
    goal: "Hypertrophy",
    level: "Advanced",
    weeks: 8,
    progression: "reps_then_weight",
    gentle: false,
    days: [
      { day: 1, title: "Push", lines: [["Bench Press (Barbell)", 4, 6, 10], ["Incline Bench Press (Dumbbell)", 3, 8, 12], ["Shoulder Press (Dumbbell)", 3, 8, 12], ["Lateral Raise (Dumbbell)", 3, 12, 15], ["Triceps Pushdown (Cable)", 3, 10, 12]] },
      { day: 2, title: "Pull", lines: [["Bent Over Row (Barbell)", 4, 6, 10], ["Lat Pulldown (Cable)", 3, 8, 12], ["Seated Cable Row", 3, 8, 12], ["Face Pull (Cable)", 3, 12, 15], ["Bicep Curl (Dumbbell)", 3, 10, 12]] },
      { day: 3, title: "Legs", lines: [["Squat (Barbell)", 4, 6, 10], ["Romanian Deadlift (Barbell)", 3, 8, 10], ["Leg Press (Machine)", 3, 10, 12], ["Lying Leg Curl (Machine)", 3, 10, 12], ["Standing Calf Raise (Machine)", 4, 12, 15]] },
      { day: 4, title: "Push 2", lines: [["Overhead Press (Barbell)", 4, 6, 10], ["Chest Fly (Dumbbell)", 3, 10, 12], ["Incline Push Up", 3, 10, 15], ["Lateral Raise (Cable)", 3, 12, 15], ["Triceps Dip", 3, 8, 12]] },
      { day: 5, title: "Pull 2", lines: [["Pull Up", 4, 5, 10], ["Single Arm Dumbbell Row", 3, 8, 12], ["Straight Arm Pulldown (Cable)", 3, 10, 12], ["Rear Delt Fly (Dumbbell)", 3, 12, 15], ["Hammer Curl (Dumbbell)", 3, 10, 12]] },
      { day: 6, title: "Legs 2", lines: [["Front Squat (Barbell)", 3, 6, 10], ["Hip Thrust (Barbell)", 3, 8, 12], ["Lunge (Dumbbell)", 3, 8, 12], ["Leg Extension (Machine)", 3, 12, 15], ["Seated Calf Raise (Machine)", 4, 12, 15]] },
    ],
  },
  {
    id: "starter-fat-loss",
    name: "Fat loss circuits",
    blurb: "4 days a week, full-body circuits plus easy cardio, 6 weeks.",
    goal: "Fat Loss",
    level: "Beginner",
    weeks: 6,
    progression: "reps_then_weight",
    gentle: false,
    days: [
      { day: 1, title: "Circuit A + walk", lines: [["Goblet Squat (Dumbbell)", 3, 12, 15], ["Push Up", 3, 8, 12], ["Bent Over Row (Dumbbell)", 3, 12, 15], ["Kettlebell Swing", 3, 12, 15], ["Treadmill Incline Walk", 1, 0, 0, 900]] },
      { day: 2, title: "Circuit B + bike", lines: [["Walking Lunge (Dumbbell)", 3, 10, 12], ["Shoulder Press (Dumbbell)", 3, 12, 15], ["Lat Pulldown (Cable)", 3, 12, 15], ["Glute Bridge", 3, 15, 20], ["Stationary Bike", 1, 0, 0, 900]] },
      { day: 4, title: "Circuit C + rower", lines: [["Leg Press (Machine)", 3, 12, 15], ["Incline Push Up", 3, 12, 15], ["Seated Cable Row", 3, 12, 15], ["Dead Bug", 3, 10, 12], ["Rowing Machine (Concept2)", 1, 0, 0, 600]] },
      { day: 6, title: "Easy cardio", lines: [["Treadmill Walk", 1, 0, 0, 1800], ["Plank", 2, 0, 0, 30], ["Bird Dog", 2, 10, 12], ["Glute Bridge", 2, 15, 20]] },
    ],
  },
  {
    id: "starter-5x5-strength",
    name: "5 x 5 strength",
    blurb: "3 days a week, heavy barbell basics, 8 weeks. Add the starting weights yourself.",
    goal: "Strength",
    level: "Intermediate",
    weeks: 8,
    progression: "linear",
    gentle: false,
    days: [
      { day: 1, title: "Workout A", lines: [["Squat (Barbell)", 5, 5, 5], ["Bench Press (Barbell)", 5, 5, 5], ["Bent Over Row (Barbell)", 5, 5, 5], ["Plank", 3, 0, 0, 45]] },
      { day: 3, title: "Workout B", lines: [["Squat (Barbell)", 5, 5, 5], ["Overhead Press (Barbell)", 5, 5, 5], ["Deadlift (Barbell)", 1, 5, 5], ["Hanging Knee Raise", 3, 8, 12]] },
      { day: 5, title: "Workout A", lines: [["Squat (Barbell)", 5, 5, 5], ["Bench Press (Barbell)", 5, 5, 5], ["Bent Over Row (Barbell)", 5, 5, 5], ["Side Plank", 3, 0, 0, 30]] },
    ],
  },
  {
    id: "starter-mobility",
    name: "Mobility and movement",
    blurb: "3 short days a week of gentle mobility and core, 4 weeks. No jumping, no heavy lifting.",
    goal: "General Fitness",
    level: "Beginner",
    weeks: 4,
    progression: "reps_then_weight",
    gentle: true,
    days: [
      { day: 1, title: "Hips and spine", lines: [["Cat-Cow Flow", 2, 10, 12], ["World's Greatest Stretch", 2, 6, 8], ["90/90 Hip Switches", 2, 8, 10], ["Half-Kneeling Hip Flexor Stretch", 2, 0, 0, 40], ["Glute Bridge", 2, 12, 15], ["Dead Bug", 2, 8, 10]] },
      { day: 3, title: "Shoulders and upper back", lines: [["Shoulder Dislocates (Band)", 2, 10, 12], ["Scapular Wall Slides", 2, 10, 12], ["Thoracic Spine Windmills", 2, 8, 10], ["Thoracic Extension Over Foam Roller", 2, 0, 0, 45], ["Band Pull Apart", 2, 12, 15], ["Bird Dog", 2, 8, 10]] },
      { day: 5, title: "Whole body flow", lines: [["Cat-Cow Flow", 2, 10, 12], ["Thoracic Spine Windmills", 2, 8, 10], ["Glute Bridge", 3, 12, 15], ["Plank", 2, 0, 0, 30], ["Child's Pose", 1, 0, 0, 60], ["PNF Hamstring Stretch", 1, 0, 0, 45]] },
    ],
  },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Turns a starter into week 1 slots (names resolved against `library`), plus the names that were not found. */
export function starterWeekOne(def: StarterDef, library: Pick<Exercise, "id" | "name">[]): { slots: ProgramSlot[]; missing: string[] } {
  const byName = new Map(library.map((e) => [norm(e.name), e.id]));
  const missing: string[] = [];
  const slots: ProgramSlot[] = def.days.map((d, i) => {
    const exercises: TemplateExercise[] = [];
    for (const [name, sets, repMin, repMax, secs] of d.lines) {
      const id = byName.get(norm(name));
      if (!id) {
        missing.push(name);
        continue;
      }
      exercises.push(secs ? { exerciseId: id, sets, repMin: 0, repMax: 0, durationSec: secs } : { exerciseId: id, sets, repMin, repMax });
    }
    return { id: `starter_${def.id}_${i}`, week: 1, day: d.day, title: d.title, exercises };
  });
  return { slots: slots.filter((s) => s.exercises.length >= 3), missing };
}

/** The whole block: week 1 grown into `def.weeks` weeks. */
export function starterSlots(def: StarterDef, library: Pick<Exercise, "id" | "name">[]): { slots: ProgramSlot[]; missing: string[] } {
  const { slots, missing } = starterWeekOne(def, library);
  return { slots: expandWeeks(slots, def.weeks, def.progression), missing };
}
