"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { WorkoutLogger } from "@/components/workout/WorkoutLogger";
import { WorkoutResult } from "@/components/workout/WorkoutResult";
import { useViewer } from "@/lib/hooks";

/**
 * A workout that was already finished when you opened it shows the read-only result (with comments); "Edit" opens the logger.
 * A workout that is still being logged, or one you finish from here, stays in the logger so its finish and recap screens work.
 */
export default function WorkoutDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { db } = useViewer();
  const w = db.workouts.find((x) => x.id === id);
  // Keyed by id: the choice is made once, the first time the workout is available.
  return <Detail key={id} workoutId={id} wasDone={w?.status === "DONE"} found={!!w} />;
}

function Detail({ workoutId, wasDone, found }: { workoutId: string; wasDone: boolean; found: boolean }) {
  // Remember how the workout was when this screen opened; finishing it here must not swap the logger away.
  const [openedDone, setOpenedDone] = useState<boolean | null>(found ? wasDone : null);
  const [editing, setEditing] = useState(false);
  if (openedDone === null && found) setOpenedDone(wasDone);

  return (
    <div>
      <Link href="/workout" className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={16} /> Workouts
      </Link>
      {openedDone && !editing ? <WorkoutResult workoutId={workoutId} onEdit={() => setEditing(true)} /> : <WorkoutLogger workoutId={workoutId} />}
    </div>
  );
}
