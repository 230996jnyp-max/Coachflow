"use client";

import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui";
import { STATUS_LABEL, STATUS_STYLES } from "@/lib/scheduling";
import { directionsUrl, isPostalCode } from "@/lib/gyms";
import type { Booking, GymLocation } from "@/lib/types";

export function gymName(b: Pick<Booking, "gymId" | "customGym">, gyms: GymLocation[]): string {
  // A location typed as just a postal code reads better with the country: "Singapore 544656".
  if (b.customGym) return isPostalCode(b.customGym) ? `Singapore ${b.customGym.trim()}` : b.customGym;
  return gyms.find((g) => g.id === b.gymId)?.name ?? "Location TBC";
}

/** Label and Google Maps directions link for a booking's location (the link is null until a location is known). */
export function bookingLocation(b: Pick<Booking, "gymId" | "customGym" | "place">, gyms: GymLocation[]): { label: string; href: string | null } {
  const label = gymName(b, gyms);
  if (b.place) return { label, href: directionsUrl({ place: b.place }) };
  const saved = !b.customGym ? gyms.find((g) => g.id === b.gymId) : undefined;
  if (saved) return { label, href: directionsUrl({ label: saved.address || saved.name }) };
  return { label, href: b.customGym ? directionsUrl({ label: b.customGym }) : null };
}

export function timeRange(b: Pick<Booking, "start" | "end">): string {
  return `${format(parseISO(b.start), "h:mm a")} – ${format(parseISO(b.end), "h:mm a")}`;
}

export function StatusBadge({ status }: { status: Booking["status"] }) {
  return <Badge className={STATUS_STYLES[status]}>{STATUS_LABEL[status]}</Badge>;
}
