"use client";

import { Activity, Camera, Dumbbell, HeartPulse, Scale } from "lucide-react";
import { useState } from "react";
import { Tabs } from "@/components/ui";
import { BodyTab } from "./BodyTab";
import { CardioTab } from "./CardioTab";
import { FeelTab } from "./FeelTab";
import { PhotosTab } from "./PhotosTab";
import { StrengthTab } from "./StrengthTab";

type Tab = "strength" | "cardio" | "body" | "feel" | "photos";

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
          { value: "feel", label: "Recovery", icon: <HeartPulse size={16} /> },
          { value: "photos", label: "Photos", icon: <Camera size={16} /> },
        ]}
      />
      {tab === "strength" && <StrengthTab clientId={clientId} />}
      {tab === "cardio" && <CardioTab clientId={clientId} />}
      {tab === "body" && <BodyTab clientId={clientId} />}
      {tab === "feel" && <FeelTab clientId={clientId} />}
      {tab === "photos" && <PhotosTab clientId={clientId} />}
    </div>
  );
}
