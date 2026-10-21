"use client";

import { useState } from "react";
import { Avatar, Field, PageHeader, Select } from "@/components/ui";
import { WorkoutHub } from "@/components/workout/WorkoutHub";
import { useViewer } from "@/lib/hooks";

export default function WorkoutPage() {
  const { user, isTrainer, clients } = useViewer();
  const [picked, setPicked] = useState<string>("");

  if (!user) return null;

  if (!isTrainer) {
    return (
      <div>
        <PageHeader title="Workout" subtitle="Log a session, load a routine or review your history" />
        <WorkoutHub clientId={user.id} />
      </div>
    );
  }

  const active = clients.filter((c) => !c.profile.archived);
  const clientId = picked || active[0]?.user.id || "";
  const chosen = clients.find((c) => c.user.id === clientId);

  return (
    <div>
      <PageHeader title="Workout" subtitle="Log workouts on behalf of any client" />
      {active.length === 0 ? (
        <p className="text-sm text-muted">Add a client first to log workouts.</p>
      ) : (
        <>
          <div className="mb-6 flex items-end gap-3">
            {chosen && <Avatar name={chosen.user.name} size={44} className="mb-0.5" />}
            <div className="flex-1 sm:max-w-xs">
              <Field label="Logging for client">
                <Select value={clientId} onChange={(e) => setPicked(e.target.value)}>
                  {active.map((c) => (
                    <option key={c.user.id} value={c.user.id}>
                      {c.user.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
          <WorkoutHub key={clientId} clientId={clientId} />
        </>
      )}
    </div>
  );
}
