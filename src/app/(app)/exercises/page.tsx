"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { CreateExerciseModal, ExerciseBrowser } from "@/components/ExerciseLibrary";
import { ExerciseDetailModal } from "@/components/exercise/ExerciseDetail";
import { Button, Card, PageHeader } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import type { Exercise } from "@/lib/types";

export default function ExercisesPage() {
  const { db } = useViewer();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Exercise | null>(null);

  return (
    <div>
      <PageHeader
        title="Exercise Library"
        subtitle={`${db.exercises.length} exercises · search, filter by muscle or equipment`}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} /> Create Custom Exercise
          </Button>
        }
      />
      <Card className="p-4">
        <ExerciseBrowser exercises={db.exercises} onOpen={setOpen} stickyOffset="top-[calc(3.5rem+env(safe-area-inset-top))] md:top-0" />
      </Card>
      <CreateExerciseModal open={creating} onClose={() => setCreating(false)} />
      <ExerciseDetailModal exercise={open} onClose={() => setOpen(null)} />
    </div>
  );
}
