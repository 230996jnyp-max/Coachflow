"use client";

import { AutopilotPage } from "@/components/autopilot/AutopilotPage";
import { EmptyState, PageHeader } from "@/components/ui";
import { useViewer } from "@/lib/hooks";

export default function AutopilotRoute() {
  const { user, isTrainer } = useViewer();
  if (!user) return null;
  if (!isTrainer) return <EmptyState title="Autopilot is for coaches" />;
  return (
    <div className="space-y-5">
      <PageHeader title="Autopilot" subtitle="Welcome messages, forms, nudges and replies that go out by themselves, within limits that never spam a client" />
      <AutopilotPage />
    </div>
  );
}
