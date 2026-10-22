"use client";

import { format, parseISO } from "date-fns";
import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar, Card, EmptyState, Segmented } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { useNow } from "@/lib/store";
import { BookingDetail } from "./BookingDetail";
import { CalendarQuickLinks } from "./CalendarActions";
import { LocationPill } from "@/components/LocationPill";
import { bookingLocation, StatusBadge, timeRange } from "./bookingUi";

type Filter = "upcoming" | "pending" | "past" | "cancelled";

/** Bookings list. Pass clientId to scope it to one client; the trainer sees everyone when omitted. */
export function BookingList({ clientId, filters = ["upcoming", "pending", "past", "cancelled"] }: { clientId?: string; filters?: Filter[] }) {
  const { db, isTrainer } = useViewer();
  const now = useNow(60_000);
  const [filter, setFilter] = useState<Filter>(filters[0]);
  const [detail, setDetail] = useState<string | null>(null);

  const rows = useMemo(() => {
    const mine = db.bookings.filter((b) => !clientId || b.clientId === clientId);
    const isUpcoming = (s: string) => parseISO(s).getTime() >= now.getTime();
    switch (filter) {
      case "upcoming":
        return mine.filter((b) => (b.status === "CONFIRMED" || b.status === "PENDING") && isUpcoming(b.end)).sort((a, b) => a.start.localeCompare(b.start));
      case "pending":
        return mine.filter((b) => b.status === "PENDING").sort((a, b) => a.start.localeCompare(b.start));
      case "past":
        return mine.filter((b) => b.status === "COMPLETED" || b.status === "NO_SHOW" || (b.status === "CONFIRMED" && !isUpcoming(b.end))).sort((a, b) => b.start.localeCompare(a.start));
      case "cancelled":
        return mine.filter((b) => b.status === "CANCELLED" || b.status === "DECLINED").sort((a, b) => b.start.localeCompare(a.start));
    }
  }, [db.bookings, clientId, filter, now]);

  const labels: Record<Filter, string> = { upcoming: "Upcoming", pending: "Pending", past: "Past", cancelled: "Cancelled" };

  return (
    <div className="space-y-4">
      {filters.length > 1 && <Segmented value={filter} onChange={setFilter} options={filters.map((f) => ({ value: f, label: labels[f] }))} className="w-full sm:w-auto" />}
      {rows.length === 0 ? (
        <EmptyState title={`No ${labels[filter].toLowerCase()} sessions`} />
      ) : (
        <div className="space-y-2">
          {rows.map((b) => {
            const client = db.users.find((u) => u.id === b.clientId);
            return (
              <div key={b.id}>
              <button onClick={() => setDetail(b.id)} className="block w-full text-left">
                <Card className="flex items-center gap-3 p-3 transition-colors hover:border-accent/50">
                  <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-field">
                    <div className="text-[10px] font-bold uppercase text-muted">{format(parseISO(b.start), "EEE")}</div>
                    <div className="text-lg font-bold leading-none">{format(parseISO(b.start), "d")}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {isTrainer && client && <Avatar name={client.name} size={20} />}
                      <span className="truncate text-sm font-semibold">{isTrainer ? client?.name : b.focus}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {format(parseISO(b.start), "MMM yyyy")} · {timeRange(b)}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                      <LocationPill nested small label={bookingLocation(b, db.gyms).label} href={bookingLocation(b, db.gyms).href} className="font-medium" />
                      {isTrainer && <span className="shrink-0 truncate">· {b.focus}</span>}
                    </div>
                  </div>
                  <StatusBadge status={b.status} />
                  <ChevronRight size={16} className="shrink-0 text-muted" />
                </Card>
              </button>
              {filter === "upcoming" && (
                <div className="px-1 pt-1.5">
                  <CalendarQuickLinks booking={b} />
                </div>
              )}
              </div>
            );
          })}
        </div>
      )}
      <BookingDetail bookingId={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
