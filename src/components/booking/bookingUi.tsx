"use client";

import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui";
import { STATUS_LABEL, STATUS_STYLES } from "@/lib/scheduling";
import type { Booking, GymLocation } from "@/lib/types";

export function gymName(b: Pick<Booking, "gymId" | "customGym">, gyms: GymLocation[]): string {
  if (b.customGym) return b.customGym;
  return gyms.find((g) => g.id === b.gymId)?.name ?? "Location TBC";
}

export function timeRange(b: Pick<Booking, "start" | "end">): string {
  return `${format(parseISO(b.start), "h:mm a")} – ${format(parseISO(b.end), "h:mm a")}`;
}

export function StatusBadge({ status }: { status: Booking["status"] }) {
  return <Badge className={STATUS_STYLES[status]}>{STATUS_LABEL[status]}</Badge>;
}
