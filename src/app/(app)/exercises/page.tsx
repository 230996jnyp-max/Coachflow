"use client";

import { Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { CreateExerciseModal, ExerciseBrowser } from "@/components/ExerciseLibrary";
import { ExerciseDetailModal } from "@/components/exercise/ExerciseDetail";
import { AiSportModal } from "@/components/sports/AiSportModal";
import { Button, Card, PageHeader } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import type { Exercise } from "@/lib/types";

export default function ExercisesPage() {
  const { exercises, isTrainer } = useViewer();
  const [creating, setCreating] = useState(false);
  const [ai, setAi] = useState<{ sport: string } | null>(null);
  const [open, setOpen] = useState<Exercise | null>(null);

  return (
    <div>
      <PageHeader
        title="Exercise Library"
        subtitle={`${isTrainer ? `${exercises.length} exercises · ` : ""}search, filter by sport, muscle, joint or equipment`}
        actions={
          <div className="flex flex-wrap gap-2">
            {isTrainer && (
              <Button variant="secondary" onClick={() => setAi({ sport: "" })}>
                <Sparkles size={16} /> Add a Sport with AI
              </Button>
            )}
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} /> Create Custom Exercise
            </Button>
          </div>
        }
      />
      <Card className="p-4">
        <ExerciseBrowser exercises={exercises} onOpen={setOpen} onAiSport={(sport) => setAi({ sport: sport ?? "" })} stickyOffset="top-[calc(3.5rem+env(safe-area-inset-top))] md:top-0" />
      </Card>
      <CreateExerciseModal open={creating} onClose={() => setCreating(false)} />
      <AiSportModal open={!!ai} onClose={() => setAi(null)} initialSport={ai?.sport ?? ""} />
      <ExerciseDetailModal exercise={open} onClose={() => setOpen(null)} />
    </div>
  );
}
