"use client";

import { LoaderCircle, MapPin, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { isPostalCode } from "@/lib/gyms";
import { mapsConfigured, newSession, placeDetails, searchBranches, searchPlaces, type Suggestion } from "@/lib/places";
import type { PlaceInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Field, Input } from "./ui";

/**
 * "Where is the location?" — Singapore-only Google Maps search.
 *  - With `brand` (a gym chain was picked) it lists that chain's branches and narrows as you type.
 *  - Without it, it searches any gym, condo, street or 6-digit postal code.
 * If Google Maps can't be used on this page, it quietly becomes a normal text box.
 */
export function PlaceField({
  label,
  hint,
  placeholder,
  brand,
  text,
  selected,
  onText,
  onPick,
  onClear,
}: {
  label: string;
  hint?: string;
  placeholder: string;
  brand?: string;
  /** Text typed when no place was picked (manual entry). */
  text: string;
  /** The place currently chosen, if any. */
  selected: { name: string; address?: string } | null;
  onText: (t: string) => void;
  onPick: (p: PlaceInfo) => void;
  onClear: () => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState(text);
  const [focused, setFocused] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<{ denied: boolean; message: string } | null>(null);
  const [active, setActive] = useState(-1);
  const wrap = useRef<HTMLDivElement>(null);

  const manual = !mapsConfigured || problem?.denied === true;
  const wantsList = focused && !selected && !manual && (brand ? true : query.trim().length >= 2);

  // Debounced search while the box is focused.
  useEffect(() => {
    if (!wantsList) return;
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = brand ? await searchBranches(brand, query.trim(), ctl.signal) : await searchPlaces(query, ctl.signal);
        if (res.ok) {
          setItems(res.items);
          setProblem(null);
          setActive(-1);
        } else setProblem({ denied: res.denied, message: res.message });
      } catch {
        /* aborted: a newer search replaced this one */
      }
      setLoading(false);
    }, 250);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [wantsList, brand, query]);

  // Close the list when tapping elsewhere.
  useEffect(() => {
    if (!focused) return;
    const away = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setFocused(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [focused]);

  const choose = async (s: Suggestion) => {
    setFocused(false);
    if (s.place) {
      newSession();
      onPick(s.place);
      return;
    }
    setLoading(true);
    const d = await placeDetails(s.placeId);
    setLoading(false);
    if (d.ok) onPick(d.place);
    else setProblem({ denied: false, message: d.message });
  };

  const showList = wantsList && !manual;
  const typed = query.trim();
  const noBranch = brand && !loading && items.length === 0 && !problem;

  if (selected) {
    return (
      <Field label={label}>
        <div className="flex items-start gap-3 rounded-xl border border-accent/40 bg-accent/10 p-3">
          <MapPin size={18} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{selected.name}</div>
            {selected.address && <div className="text-xs text-muted">{selected.address}</div>}
          </div>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setItems([]);
              onClear();
            }}
            className="flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-accent hover:bg-accent/15"
          >
            <X size={14} /> Change
          </button>
        </div>
      </Field>
    );
  }

  return (
    <div ref={wrap} className="space-y-1.5">
      <Field label={label} hint={manual ? "Map search isn't available here — type the full address." : (hint ?? "Search Singapore addresses, gyms and postal codes")}>
        <div className="relative">
          <Input
            value={manual ? text : query}
            onChange={(e) => {
              setQuery(e.target.value);
              onText(e.target.value);
              setFocused(true);
            }}
            onFocus={() => setFocused(true)}
            onKeyDown={(e) => {
              if (!showList) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(items.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter" && active >= 0 && items[active]) {
                e.preventDefault();
                void choose(items[active]);
              } else if (e.key === "Escape") setFocused(false);
            }}
            placeholder={placeholder}
            maxLength={120}
            autoComplete="off"
            role={manual ? undefined : "combobox"}
            aria-expanded={showList}
            aria-controls={showList ? listId : undefined}
            className={cn(!manual && "pl-10")}
          />
          {!manual && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
              {loading ? <LoaderCircle size={16} className="animate-spin" /> : <Search size={16} />}
            </span>
          )}
        </div>
      </Field>

      {showList && (
        <ul id={listId} role="listbox" className="max-h-60 overflow-y-auto rounded-xl border border-line bg-field shadow-lg">
          {items.map((s, i) => (
            <li key={`${s.placeId}-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => void choose(s)}
                className={cn("flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors", i === active ? "bg-accent/15" : "hover:bg-surface")}
              >
                <MapPin size={16} className="mt-0.5 shrink-0 text-muted" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{s.title}</span>
                  {s.subtitle && <span className="block text-xs text-muted">{s.subtitle}</span>}
                </span>
              </button>
            </li>
          ))}
          {noBranch && <li className="px-3 py-3 text-sm text-muted">No {brand} branch found for “{typed}”. Try another area or word.</li>}
          {problem && !problem.denied && <li className="px-3 py-3 text-sm text-danger">{problem.message}</li>}
          {typed.length >= 2 && (
            <li>
              <button
                type="button"
                onClick={async () => {
                  // A bare postal code: look up the real address instead of keeping six digits.
                  if (isPostalCode(typed) && !manual) {
                    setLoading(true);
                    const res = await searchPlaces(typed).catch(() => null);
                    setLoading(false);
                    const first = res && res.ok ? res.items[0] : undefined;
                    if (first) return void choose(first);
                  }
                  onText(typed);
                  setFocused(false);
                }}
                className="w-full border-t border-line px-3 py-2.5 text-left text-xs font-semibold text-accent hover:bg-surface"
              >
                Use “{typed}” as typed
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
