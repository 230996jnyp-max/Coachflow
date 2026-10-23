"use client";

import { Activity, Camera, Dumbbell, Scale } from "lucide-react";
import { useState } from "react";
import { Tabs } from "@/components/ui";
import { BodyTab } from "./BodyTab";
import { CardioTab } from "./CardioTab";
import { PhotosTab } from "./PhotosTab";
import { StrengthTab } from "./StrengthTab";

type Tab = "strength" | "cardio" | "body" | "photos";

export function ProgressHub({ clientId }: { clientId: string }) {
  const [tab, setTab] = useState<Tab>("strength");
  return (
    <div data-tour="progress-hub">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "strength", label: "Strength", icon: <Dumbbell size={16} /> },
          { value: "cardio", label: "Cardio", icon: <Activity size={16} /> },
          { value: "body", label: "Body", icon: <Scale size={16} /> },
          { value: "photos", label: "Photos", icon: <Camera size={16} /> },
        ]}
      />
      {tab === "strength" && <StrengthTab clientId={clientId} />}
      {tab === "cardio" && <CardioTab clientId={clientId} />}
      {tab === "body" && <BodyTab clientId={clientId} />}
      {tab === "photos" && <PhotosTab clientId={clientId} />}
    </div>
  );
}
