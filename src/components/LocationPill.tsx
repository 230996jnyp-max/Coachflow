"use client";

import { MapPin } from "lucide-react";
import { MAPS_KEY } from "@/lib/places";
import type { PlaceInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * A location with a map pin. Tapping it opens Google Maps with directions to that exact place
 * (the Google Maps app on a phone). Use `nested` when the pill sits inside a button or clickable card.
 */
export function LocationPill({
  label,
  href,
  nested,
  small,
  className,
}: {
  label: string;
  /** Google Maps directions link; without one the pill is just a labelled pin. */
  href: string | null;
  nested?: boolean;
  small?: boolean;
  className?: string;
}) {
  const body = (
    <>
      <MapPin size={small ? 12 : 15} className="shrink-0" />
      <span className="truncate">{label}</span>
    </>
  );
  if (!href) return <span className={cn("inline-flex min-w-0 max-w-full items-center gap-1", className)}>{body}</span>;

  const style = cn("inline-flex min-w-0 max-w-full items-center gap-1 rounded-md font-semibold text-accent underline-offset-2 hover:underline focus-visible:underline", className);
  if (nested) {
    const open = () => window.open(href, "_blank", "noopener,noreferrer");
    return (
      <span
        role="link"
        tabIndex={0}
        title="Open directions in Google Maps"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          open();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            open();
          }
        }}
        className={cn(style, "cursor-pointer")}
      >
        {body}
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title="Open directions in Google Maps" className={style}>
      {body}
    </a>
  );
}

/**
 * Small map preview of a picked place. A free OpenStreetMap preview is used by default; once the Maps Embed API is
 * enabled for the key, set NEXT_PUBLIC_MAPS_EMBED=google to show Google's map instead. Tapping it opens directions.
 */
export function MiniMap({ place, href }: { place: PlaceInfo; href: string }) {
  if (place.lat === undefined || place.lng === undefined) return null;
  const google = process.env.NEXT_PUBLIC_MAPS_EMBED === "google" && MAPS_KEY;
  const dLng = 0.0045;
  const dLat = 0.003;
  const src = google
    ? `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(MAPS_KEY)}&q=place_id:${encodeURIComponent(place.placeId)}&zoom=16`
    : `https://www.openstreetmap.org/export/embed.html?bbox=${place.lng - dLng}%2C${place.lat - dLat}%2C${place.lng + dLng}%2C${place.lat + dLat}&layer=mapnik&marker=${place.lat}%2C${place.lng}`;
  return (
    <div className="relative overflow-hidden rounded-xl border border-line">
      <iframe src={src} title={`Map of ${place.name}`} loading="lazy" tabIndex={-1} referrerPolicy="no-referrer-when-downgrade" className="pointer-events-none block h-40 w-full bg-field" />
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open directions to ${place.name} in Google Maps`}
        className="absolute inset-0 flex items-start justify-end p-2 text-xs font-semibold text-white"
      >
        <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-3 py-1 backdrop-blur-sm">
          <MapPin size={12} /> Open in Google Maps
        </span>
      </a>
    </div>
  );
}
