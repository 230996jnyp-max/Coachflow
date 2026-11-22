"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { ProgramsHome } from "@/components/programs/ProgramsHome";
import { useViewer } from "@/lib/hooks";

/** Programs for someone training on their own: part of the AI trainer, built from their health answers, goals and equipment. */
export default function SoloProgramsPage() {
  const { user, isPersonal, isMinor } = useViewer();
  if (!user) return null;
  if (!isPersonal || isMinor) return <EmptyState title="Programs are part of the AI trainer" hint="They are for adults training on their own. If you have a coach, your coach builds your programs." />;
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link href="/ai-trainer" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={16} /> Your AI trainer
      </Link>
      <PageHeader title="Your programs" subtitle="A longer plan, built from your goal and health answers" />
      <ProgramsHome base="/ai-trainer/programs" solo />
    </div>
  );
}
