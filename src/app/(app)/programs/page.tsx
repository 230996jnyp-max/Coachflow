"use client";

import { EmptyState, PageHeader } from "@/components/ui";
import { ProgramsHome } from "@/components/programs/ProgramsHome";
import { ProgramSuggestions } from "@/components/programs/ProgramSuggestions";
import { useViewer } from "@/lib/hooks";

export default function ProgramsPage() {
  const { user, isTrainer } = useViewer();
  if (!user) return null;
  if (!isTrainer) return <EmptyState title="Programs are made by your coach" hint="Your coach's programs show up on your Home and Workout pages once they are assigned." />;
  return (
    <div className="space-y-6">
      <PageHeader title="Programs" subtitle="Build a multi-week plan once, then give it to as many clients as you like" />
      <ProgramSuggestions showCheck />
      <ProgramsHome base="/programs" solo={false} />
    </div>
  );
}
