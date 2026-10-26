"use client";

import { useRef, useState } from "react";
import { PlaceField } from "@/components/PlaceField";
import { Notice } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { saveHomeAddress } from "@/lib/store";

/**
 * Where a client trains at home. Saved straight to their profile (a picked map place, or typed text when maps can't be
 * used) and offered as "Home" when a session is booked. Only the client and their coach can see it.
 */
export function HomeAddressField({ clientId, label = "Home address", hint }: { clientId: string; label?: string; hint?: string }) {
  const { db } = useViewer();
  const profile = db.clients.find((c) => c.id === clientId);
  const [draft, setDraft] = useState(profile?.homeText ?? "");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  if (!profile) return null;
  const place = profile.homePlace;
  const save = async (home: Parameters<typeof saveHomeAddress>[1]) => setError(await saveHomeAddress(clientId, home));

  return (
    <div className="space-y-2">
      <PlaceField
        key={place ? place.placeId : "typed"}
        label={label}
        hint={hint ?? "Used when a session is at home. Only you and your coach can see it."}
        placeholder="Street, building or 6-digit postal code"
        text={draft}
        selected={place ? { name: place.name, address: place.address } : null}
        onText={(t) => {
          setDraft(t);
          clearTimeout(timer.current);
          if (t.trim().length >= 6) timer.current = setTimeout(() => void save({ text: t.trim() }), 900);
        }}
        onPick={(p) => {
          clearTimeout(timer.current);
          setDraft("");
          void save({ place: p });
        }}
        onClear={() => {
          clearTimeout(timer.current);
          setDraft("");
          void save(null);
        }}
      />
      {!place && profile.homeText && <p className="text-xs text-success">Saved: {profile.homeText}</p>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
