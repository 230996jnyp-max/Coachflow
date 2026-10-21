"use client";

import { PageHeader } from "@/components/ui";
import { ProgressHub } from "@/components/progress/ProgressHub";
import { useViewer } from "@/lib/hooks";

export default function ProgressPage() {
  const { user } = useViewer();
  if (!user) return null;
  return (
    <div>
      <PageHeader title="Progress" subtitle="Strength, cardio, body metrics and photos" />
      <ProgressHub clientId={user.id} />
    </div>
  );
}
