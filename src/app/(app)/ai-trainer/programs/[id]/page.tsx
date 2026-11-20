"use client";

import { useParams } from "next/navigation";
import { EmptyState } from "@/components/ui";
import { ProgramPlanner } from "@/components/programs/ProgramPlanner";
import { useViewer } from "@/lib/hooks";

export default function SoloProgramPage() {
  const { id } = useParams<{ id: string }>();
  const { user, isPersonal, isMinor } = useViewer();
  if (!user) return null;
  if (!isPersonal || isMinor) return <EmptyState title="Programs are part of the AI trainer" />;
  return <ProgramPlanner key={id} id={id} base="/ai-trainer/programs" solo />;
}
