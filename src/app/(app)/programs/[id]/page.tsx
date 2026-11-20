"use client";

import { useParams } from "next/navigation";
import { EmptyState } from "@/components/ui";
import { ProgramPlanner } from "@/components/programs/ProgramPlanner";
import { useViewer } from "@/lib/hooks";

export default function ProgramPage() {
  const { id } = useParams<{ id: string }>();
  const { user, isTrainer } = useViewer();
  if (!user) return null;
  if (!isTrainer) return <EmptyState title="Programs are made by your coach" />;
  return <ProgramPlanner key={id} id={id} base="/programs" solo={false} />;
}
