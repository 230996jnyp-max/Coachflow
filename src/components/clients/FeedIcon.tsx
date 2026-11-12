import { Activity, CalendarCheck, CalendarX2, Camera, Dumbbell, Users } from "lucide-react";
import type { FeedKind } from "@/lib/clientFeed";

const ICONS = { workout: Dumbbell, metrics: Activity, photo: Camera, session: CalendarCheck, missed: CalendarX2, class: Users } as const;

/** The little round icon for an activity line. */
export function FeedIcon({ kind, size = 14 }: { kind: FeedKind; size?: number }) {
  const Icon = ICONS[kind];
  return <Icon size={size} />;
}
