"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { WorkoutLogger } from "@/components/workout/WorkoutLogger";

export default function WorkoutDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div>
      <Link href="/workout" className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={16} /> Workouts
      </Link>
      <WorkoutLogger workoutId={id} />
    </div>
  );
}
